const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere } = require('../middleware/auth');
const { crud, dateOpt, dateReq, strOpt, intOpt } = require('../lib/crud');

const cellSchema = z.object({
  churchId: intOpt,
  name: z.string().trim().min(2),
  leaderId: intOpt,
  weekday: z.coerce.number().int().min(0).max(6).nullable().optional(),
  time: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()),
  address: strOpt,
  neighborhood: strOpt,
  status: z.enum(['ATIVA', 'PAUSADA', 'MULTIPLICADA', 'ENCERRADA']).optional(),
  startedAt: dateOpt,
  parentCellId: intOpt,
});

const base = crud({
  model: 'cell',
  resource: 'cells',
  create: cellSchema,
  search: ['name', 'neighborhood'],
  filters: { status: 'str', churchId: 'int', leaderId: 'int' },
  include: { leader: { select: { id: true, fullName: true } }, _count: { select: { members: true, meetings: true } } },
  orderBy: { name: 'asc' },
});

const router = express.Router();

async function loadCell(req, id) {
  const cell = await prisma.cell.findFirst({ where: await scopedWhere(req, { id }) });
  if (!cell) throw new HttpError(404, 'Célula não encontrada');
  return cell;
}

router.get('/:id/members', requirePermission('cells:read'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  res.json(await prisma.cellMember.findMany({ where: { cellId: cell.id, leftAt: null }, include: { member: { select: { id: true, fullName: true, phone: true, status: true } } } }));
}));

router.post('/:id/members', requirePermission('cells:write'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  const { memberId } = z.object({ memberId: z.coerce.number().int() }).parse(req.body);
  const member = await prisma.member.findFirst({ where: await scopedWhere(req, { id: memberId }) });
  if (!member) throw new HttpError(404, 'Membro não encontrado');
  const rec = await prisma.cellMember.upsert({
    where: { cellId_memberId: { cellId: cell.id, memberId } },
    create: { cellId: cell.id, memberId },
    update: { leftAt: null, joinedAt: new Date() },
  });
  await audit(req, 'CREATE', 'CellMember', `${cell.id}:${memberId}`);
  res.status(201).json(rec);
}));

router.delete('/:id/members/:memberId', requirePermission('cells:write'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  await prisma.cellMember.update({ where: { cellId_memberId: { cellId: cell.id, memberId: Number(req.params.memberId) } }, data: { leftAt: new Date() } });
  await audit(req, 'DELETE', 'CellMember', `${cell.id}:${req.params.memberId}`);
  res.status(204).end();
}));

const meetingSchema = z.object({
  date: dateReq,
  topic: strOpt,
  visitors: z.coerce.number().int().min(0).default(0),
  conversions: z.coerce.number().int().min(0).default(0),
  offeringCents: z.coerce.number().int().min(0).default(0),
  notes: strOpt,
  attendance: z.array(z.object({ memberId: z.coerce.number().int(), present: z.boolean() })).default([]),
});

// Registra reunião + frequência dos participantes numa única transação.
router.post('/:id/meetings', requirePermission('cells:write'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  const { attendance, ...data } = meetingSchema.parse(req.body);
  const meeting = await prisma.$transaction(async (tx) => {
    const m = await tx.cellMeeting.create({ data: { ...data, cellId: cell.id } });
    if (attendance.length) {
      await tx.cellAttendance.createMany({ data: attendance.map((a) => ({ meetingId: m.id, memberId: a.memberId, present: a.present })) });
    }
    return m;
  });
  await audit(req, 'CREATE', 'CellMeeting', meeting.id);
  res.status(201).json(meeting);
}));

router.get('/:id/meetings', requirePermission('cells:read'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  const meetings = await prisma.cellMeeting.findMany({ where: { cellId: cell.id }, orderBy: { date: 'desc' }, take: 100, include: { attendances: true } });
  res.json(meetings.map(({ attendances, ...m }) => ({ ...m, present: attendances.filter((a) => a.present).length, absent: attendances.filter((a) => !a.present).length })));
}));

// Crescimento e frequência de uma célula.
router.get('/:id/stats', requirePermission('cells:read'), wrap(async (req, res) => {
  const cell = await loadCell(req, Number(req.params.id));
  const [meetings, active] = await Promise.all([
    prisma.cellMeeting.findMany({ where: { cellId: cell.id }, orderBy: { date: 'asc' }, include: { attendances: true } }),
    prisma.cellMember.count({ where: { cellId: cell.id, leftAt: null } }),
  ]);
  const series = meetings.map((m) => {
    const present = m.attendances.filter((a) => a.present).length;
    return { date: m.date, present, visitors: m.visitors, total: present + m.visitors, conversions: m.conversions };
  });
  const avg = series.length ? series.reduce((s, x) => s + x.total, 0) / series.length : 0;
  const perMember = await prisma.cellAttendance.groupBy({ by: ['memberId'], where: { meeting: { cellId: cell.id }, present: true }, _count: { _all: true } });
  res.json({
    activeMembers: active,
    meetings: series.length,
    averageAttendance: Number(avg.toFixed(1)),
    totalConversions: series.reduce((s, x) => s + x.conversions, 0),
    series,
    frequencyByMember: perMember.map((p) => ({ memberId: p.memberId, presences: p._count._all, rate: series.length ? Number(((p._count._all / series.length) * 100).toFixed(0)) : 0 })),
  });
}));

router.use(base);

module.exports = router;
