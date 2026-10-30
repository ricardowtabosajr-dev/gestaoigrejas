const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere, assertChurchAccess } = require('../middleware/auth');
const { crud, dateOpt, dateReq, strOpt, intOpt } = require('../lib/crud');
const { EVENT_KINDS } = require('../constants');
const config = require('../config');

// Cultos, eventos anuais (retiro, seminário, congresso) e agenda externa (evangelismo, ação social, missões).
const eventSchema = z.object({
  churchId: intOpt,
  title: z.string().trim().min(2),
  kind: z.enum(EVENT_KINDS).default('CULTO'),
  scope: z.enum(['INTERNO', 'EXTERNO']).default('INTERNO'),
  description: strOpt,
  location: strOpt,
  startsAt: dateReq,
  endsAt: dateOpt,
  preacher: strOpt,
  theme: strOpt,
  visitorsCount: z.coerce.number().int().min(0).optional(),
  conversionsCount: z.coerce.number().int().min(0).optional(),
  status: z.enum(['AGENDADO', 'REALIZADO', 'CANCELADO']).optional(),
  allowRegistration: z.boolean().optional(),
  priceCents: z.coerce.number().int().min(0).optional(),
  capacity: intOpt,
  registrationDeadline: dateOpt,
});

const base = crud({
  model: 'event',
  resource: 'events',
  create: eventSchema,
  search: ['title', 'theme', 'location'],
  filters: { kind: 'str', scope: 'str', status: 'str', churchId: 'int' },
  include: { _count: { select: { attendances: true, registrations: true } } },
  orderBy: { startsAt: 'desc' },
});

const router = express.Router();

// Agenda por período (calendário geral).
router.get('/agenda/range', requirePermission('events:read'), wrap(async (req, res) => {
  const { from, to } = z.object({ from: dateReq, to: dateReq }).parse(req.query);
  const where = await scopedWhere(req, { startsAt: { gte: from, lte: to } });
  if (req.query.scope) where.scope = String(req.query.scope);
  res.json(await prisma.event.findMany({ where, orderBy: { startsAt: 'asc' }, include: { church: { select: { name: true } } } }));
}));

// Gera cultos semanais recorrentes (ex.: toda quarta e domingo às 19:30) para um período.
router.post('/generate-weekly', requirePermission('events:write'), wrap(async (req, res) => {
  const body = z.object({
    churchId: intOpt,
    title: z.string().trim().min(2),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    from: dateReq,
    to: dateReq,
    durationMinutes: z.number().int().min(15).max(720).default(120),
    preacher: strOpt,
  }).parse(req.body);
  const churchId = body.churchId ?? req.user.churchId;
  if (!churchId) throw new HttpError(400, 'churchId obrigatório');
  await assertChurchAccess(req, churchId);
  if ((body.to - body.from) / 86400000 > 400) throw new HttpError(400, 'Período máximo de 400 dias');
  const rows = [];
  const pad = (n) => String(n).padStart(2, '0');
  // Percorre os dias em UTC (data pura) e monta o horário local da igreja com o offset configurado.
  const first = Date.UTC(body.from.getUTCFullYear(), body.from.getUTCMonth(), body.from.getUTCDate());
  const last = Date.UTC(body.to.getUTCFullYear(), body.to.getUTCMonth(), body.to.getUTCDate());
  for (let t = first; t <= last; t += 86400000) {
    const d = new Date(t);
    if (!body.weekdays.includes(d.getUTCDay())) continue;
    const startsAt = new Date(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${body.time}:00${config.tzOffset}`);
    rows.push({ churchId, title: body.title, kind: 'CULTO', recurrence: 'SEMANAL', startsAt, endsAt: new Date(startsAt.getTime() + body.durationMinutes * 60000), preacher: body.preacher ?? null });
  }
  const existing = await prisma.event.findMany({ where: { churchId, title: body.title, startsAt: { in: rows.map((r) => r.startsAt) } }, select: { startsAt: true } });
  const seen = new Set(existing.map((e) => e.startsAt.getTime()));
  const toCreate = rows.filter((r) => !seen.has(r.startsAt.getTime()));
  if (toCreate.length) await prisma.event.createMany({ data: toCreate });
  await audit(req, 'CREATE', 'Event', null, { generated: toCreate.length });
  res.status(201).json({ created: toCreate.length, skipped: rows.length - toCreate.length });
}));

async function loadEvent(req, id) {
  const ev = await prisma.event.findFirst({ where: await scopedWhere(req, { id }) });
  if (!ev) throw new HttpError(404, 'Evento não encontrado');
  return ev;
}

// ── Frequência (chamada) ──
router.get('/:id/attendance', requirePermission('attendance:read'), wrap(async (req, res) => {
  const ev = await loadEvent(req, Number(req.params.id));
  res.json(await prisma.attendance.findMany({ where: { eventId: ev.id }, include: { member: { select: { id: true, fullName: true } } }, orderBy: { checkedAt: 'asc' } }));
}));

// Marca presença de vários membros de uma vez (idempotente).
router.post('/:id/attendance', requirePermission('attendance:write'), wrap(async (req, res) => {
  const ev = await loadEvent(req, Number(req.params.id));
  const { memberIds } = z.object({ memberIds: z.array(z.coerce.number().int()).min(1).max(2000) }).parse(req.body);
  const valid = await prisma.member.findMany({ where: await scopedWhere(req, { id: { in: memberIds } }), select: { id: true } });
  const existing = await prisma.attendance.findMany({ where: { eventId: ev.id, memberId: { in: valid.map((v) => v.id) } }, select: { memberId: true } });
  const have = new Set(existing.map((e) => e.memberId));
  const data = valid.filter((v) => !have.has(v.id)).map((v) => ({ eventId: ev.id, memberId: v.id }));
  if (data.length) await prisma.attendance.createMany({ data });
  await audit(req, 'CREATE', 'Attendance', ev.id, { added: data.length });
  res.status(201).json({ added: data.length, ignored: memberIds.length - data.length });
}));

router.delete('/:id/attendance/:memberId', requirePermission('attendance:delete'), wrap(async (req, res) => {
  const ev = await loadEvent(req, Number(req.params.id));
  await prisma.attendance.delete({ where: { eventId_memberId: { eventId: ev.id, memberId: Number(req.params.memberId) } } });
  res.status(204).end();
}));

router.use(base);

module.exports = router;
