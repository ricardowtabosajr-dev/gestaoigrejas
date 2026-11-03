const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { z } = require('zod');
const config = require('../config');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere, assertChurchAccess } = require('../middleware/auth');

const STATUSES = ['NOVO', 'CONTATADO', 'AGENDADO', 'INTEGRADO', 'SEM_RETORNO'];

// ───────────── Público: leitura do QR code pelo visitante ─────────────
const pub = express.Router();
// Limite mais rígido que o das demais rotas públicas: 8 envios/10 min por IP.
const submitLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });

async function churchByToken(token) {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) throw new HttpError(404, 'Link inválido');
  const church = await prisma.church.findUnique({ where: { visitToken: token }, select: { id: true, name: true, status: true } });
  if (!church || church.status === 'INATIVA') throw new HttpError(404, 'Link inválido ou expirado');
  return church;
}

// Culto em andamento (ou mais próximo) numa janela de -4h/+6h em volta de agora.
async function currentEvent(churchId) {
  const now = Date.now();
  const events = await prisma.event.findMany({
    where: { churchId, status: { not: 'CANCELADO' }, startsAt: { gte: new Date(now - 4 * 3600e3), lte: new Date(now + 6 * 3600e3) } },
    select: { id: true, title: true, startsAt: true },
  });
  return events.sort((a, b) => Math.abs(a.startsAt - now) - Math.abs(b.startsAt - now))[0] || null;
}

pub.get('/:token', wrap(async (req, res) => {
  const church = await churchByToken(req.params.token);
  const ev = await currentEvent(church.id);
  res.json({ church: church.name, event: ev?.title ?? null });
}));

const visitSchema = z.object({
  name: z.string().trim().min(3, 'Informe seu nome completo').max(120),
  phone: z.preprocess((v) => String(v ?? '').replace(/\D/g, ''), z.string().min(10, 'Informe o WhatsApp com DDD').max(13)),
  email: z.preprocess((v) => (v ? String(v).trim() : undefined), z.email('E-mail inválido').max(120).optional()),
  birthDate: z.preprocess((v) => (v ? v : undefined), z.coerce.date().min(new Date('1900-01-01')).max(new Date()).optional()),
  howKnew: z.string().trim().max(80).optional().transform((v) => v || undefined),
  prayerRequest: z.string().trim().max(500).optional().transform((v) => v || undefined),
  wantsContact: z.boolean().default(true),
  consent: z.literal(true, { error: 'É necessário autorizar o uso dos dados para continuar' }),
  website: z.string().max(0).optional(), // isca (honeypot): robôs preenchem, pessoas não
});

pub.post('/:token', submitLimiter, wrap(async (req, res) => {
  const church = await churchByToken(req.params.token);
  const data = visitSchema.parse(req.body);
  // Normaliza para comparar com o cadastro: aceita com ou sem DDI 55.
  const local = data.phone.length > 11 ? data.phone.slice(-11) : data.phone;
  const variants = [...new Set([data.phone, local, `55${local}`])];
  const ev = await currentEvent(church.id);

  const result = await prisma.$transaction(async (tx) => {
    let member = await tx.member.findFirst({ where: { churchId: church.id, phone: { in: variants } } });
    let returning = !!member;
    if (!member) {
      member = await tx.member.create({
        data: {
          churchId: church.id, fullName: data.name, phone: data.phone, email: data.email ?? null, birthDate: data.birthDate ?? null,
          status: 'VISITANTE', receiveBirthdayMsg: true, // o consentimento do formulário cobre contato e felicitações
          notes: 'Cadastrado pelo QR code de visitantes',
        },
      });
    }
    const previous = returning ? await tx.visit.count({ where: { memberId: member.id } }) : 0;
    const visit = await tx.visit.create({
      data: { churchId: church.id, memberId: member.id, eventId: ev?.id ?? null, isFirstVisit: previous === 0, howKnew: data.howKnew ?? null, prayerRequest: data.prayerRequest ?? null, wantsContact: data.wantsContact },
    });
    if (ev) {
      await tx.attendance.upsert({ where: { eventId_memberId: { eventId: ev.id, memberId: member.id } }, create: { eventId: ev.id, memberId: member.id }, update: {} });
    }
    return { visit, returning, firstName: member.fullName.split(/\s+/)[0] };
  });
  res.status(201).json({ ok: true, name: result.firstName, returning: result.returning, church: church.name });
}));

// ───────────── Admin: QR code, lista e acompanhamento ─────────────
const admin = express.Router();

function visitUrl(token) {
  return `${config.publicUrl.replace(/\/$/, '')}/visitante.html?c=${token}`;
}

// QR da igreja (SVG pronto para exibir/imprimir) e link.
admin.get('/qr', requirePermission('members:read'), wrap(async (req, res) => {
  const churchId = Number(req.query.churchId || req.user.churchId);
  await assertChurchAccess(req, churchId);
  const church = await prisma.church.findUnique({ where: { id: churchId }, select: { id: true, name: true, visitToken: true } });
  if (!church) throw new HttpError(404, 'Igreja não encontrada');
  const url = visitUrl(church.visitToken);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.json({ church: church.name, url, svg });
}));

// Gera um novo link e invalida o QR impresso anteriormente (use se o link for divulgado/abusado).
admin.post('/qr/rotate', requirePermission('churches:write'), wrap(async (req, res) => {
  const { churchId } = z.object({ churchId: z.coerce.number().int() }).parse(req.body);
  await assertChurchAccess(req, churchId);
  const church = await prisma.church.update({ where: { id: churchId }, data: { visitToken: crypto.randomUUID() }, select: { id: true } });
  await audit(req, 'UPDATE', 'Church', church.id, ['visitToken']);
  res.json({ ok: true });
}));

admin.get('/', requirePermission('members:read'), wrap(async (req, res) => {
  const q = z.object({
    status: z.enum(STATUSES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const extra = {};
  if (q.status) extra.followUpStatus = q.status;
  if (q.from || q.to) extra.createdAt = { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) };
  const where = await scopedWhere(req, extra);
  const [total, items, grouped] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { member: { select: { id: true, fullName: true, phone: true, email: true, status: true } }, event: { select: { title: true } } },
    }),
    prisma.visit.groupBy({ by: ['followUpStatus'], where: await scopedWhere(req), _count: { _all: true } }),
  ]);
  res.json({ items, total, page: q.page, summary: Object.fromEntries(grouped.map((g) => [g.followUpStatus, g._count._all])) });
}));

admin.put('/:id', requirePermission('members:write'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const data = z.object({ followUpStatus: z.enum(STATUSES).optional(), followUpNotes: z.string().trim().max(1000).nullable().optional() }).parse(req.body);
  if (!(await prisma.visit.findFirst({ where: await scopedWhere(req, { id }) }))) throw new HttpError(404, 'Visita não encontrada');
  const visit = await prisma.visit.update({ where: { id }, data });
  await audit(req, 'UPDATE', 'Visit', id, Object.keys(data));
  res.json(visit);
}));

module.exports = { pub, admin };
