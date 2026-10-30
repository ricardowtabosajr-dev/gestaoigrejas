const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere } = require('../middleware/auth');
const { provider, providers, markPaid } = require('../services/payments');

// ───────────── Rotas administrativas (autenticadas) ─────────────
const admin = express.Router();

async function loadEvent(req, id) {
  const ev = await prisma.event.findFirst({ where: await scopedWhere(req, { id }) });
  if (!ev) throw new HttpError(404, 'Evento não encontrado');
  return ev;
}

// Lista de inscritos com quem pagou / não pagou.
admin.get('/', requirePermission('registrations:read'), wrap(async (req, res) => {
  const ev = await loadEvent(req, Number(z.coerce.number().int().parse(req.query.eventId)));
  const status = req.query.status ? String(req.query.status) : undefined;
  const items = await prisma.registration.findMany({ where: { eventId: ev.id, ...(status && { status }) }, orderBy: { createdAt: 'desc' }, include: { member: { select: { id: true, fullName: true } } } });
  const all = status ? await prisma.registration.findMany({ where: { eventId: ev.id }, select: { status: true, amountCents: true } }) : items;
  const sum = (s) => all.filter((r) => r.status === s);
  res.json({
    event: { id: ev.id, title: ev.title, priceCents: ev.priceCents, capacity: ev.capacity },
    summary: {
      total: all.length,
      paid: sum('PAGO').length,
      pending: sum('PENDENTE').length,
      cancelled: sum('CANCELADO').length,
      exempt: sum('ISENTO').length,
      receivedCents: sum('PAGO').reduce((s, r) => s + r.amountCents, 0),
      pendingCents: sum('PENDENTE').reduce((s, r) => s + r.amountCents, 0),
    },
    items,
  });
}));

// Baixa manual (pagamento em dinheiro/PIX no balcão), cancelamento e check-in.
admin.post('/:id/pay', requirePermission('registrations:write'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const reg = await prisma.registration.findFirst({ where: { id, event: await scopedWhere(req) } });
  if (!reg) throw new HttpError(404, 'Inscrição não encontrada');
  await markPaid({ registrationId: id, providerName: 'MANUAL' });
  await audit(req, 'UPDATE', 'Registration', id, { status: 'PAGO', manual: true });
  res.json({ ok: true });
}));

admin.post('/:id/cancel', requirePermission('registrations:write'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const reg = await prisma.registration.findFirst({ where: { id, event: await scopedWhere(req) } });
  if (!reg) throw new HttpError(404, 'Inscrição não encontrada');
  if (reg.status === 'PAGO') throw new HttpError(409, 'Inscrição paga: faça o estorno financeiro antes de cancelar');
  await prisma.registration.update({ where: { id }, data: { status: 'CANCELADO' } });
  await audit(req, 'UPDATE', 'Registration', id, { status: 'CANCELADO' });
  res.json({ ok: true });
}));

admin.post('/:id/checkin', requirePermission('registrations:write'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const reg = await prisma.registration.findFirst({ where: { id, event: await scopedWhere(req) } });
  if (!reg) throw new HttpError(404, 'Inscrição não encontrada');
  if (!['PAGO', 'ISENTO'].includes(reg.status)) throw new HttpError(409, 'Inscrição sem pagamento confirmado');
  await prisma.registration.update({ where: { id }, data: { checkedIn: true } });
  res.json({ ok: true });
}));

// ───────────── Rotas públicas (sem login) ─────────────
const pub = express.Router();
pub.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

pub.get('/events', wrap(async (_req, res) => {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { allowRegistration: true, status: 'AGENDADO', startsAt: { gte: now }, OR: [{ registrationDeadline: null }, { registrationDeadline: { gte: now } }] },
    orderBy: { startsAt: 'asc' },
    select: { id: true, title: true, kind: true, description: true, location: true, startsAt: true, endsAt: true, priceCents: true, capacity: true, church: { select: { name: true } } },
  });
  res.json(events);
}));

const regSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.email().optional().or(z.literal('').transform(() => undefined)),
  phone: z.preprocess((v) => (v ? String(v).replace(/\D/g, '') : undefined), z.string().min(10).max(15).optional()),
  cpf: z.preprocess((v) => (v ? String(v).replace(/\D/g, '') : undefined), z.string().length(11).optional()),
});

pub.post('/events/:id/registrations', wrap(async (req, res) => {
  const eventId = Number(req.params.id);
  const data = regSchema.parse(req.body);
  const ev = await prisma.event.findUnique({ where: { id: eventId } });
  const now = new Date();
  if (!ev || !ev.allowRegistration || ev.status !== 'AGENDADO') throw new HttpError(404, 'Evento indisponível para inscrição');
  if (ev.registrationDeadline && ev.registrationDeadline < now) throw new HttpError(409, 'Inscrições encerradas');
  if (data.cpf && (await prisma.registration.findFirst({ where: { eventId, cpf: data.cpf, status: { not: 'CANCELADO' } } }))) throw new HttpError(409, 'CPF já inscrito neste evento');

  // Vincula a membro existente (por CPF) quando possível.
  const member = data.cpf ? await prisma.member.findUnique({ where: { cpf: data.cpf }, select: { id: true } }) : null;

  // Capacidade verificada dentro da transação para evitar overbooking.
  const reg = await prisma.$transaction(async (tx) => {
    if (ev.capacity != null) {
      const taken = await tx.registration.count({ where: { eventId, status: { not: 'CANCELADO' } } });
      if (taken >= ev.capacity) throw new HttpError(409, 'Evento lotado');
    }
    return tx.registration.create({ data: { ...data, eventId, memberId: member?.id ?? null, amountCents: ev.priceCents, status: ev.priceCents === 0 ? 'ISENTO' : 'PENDENTE' } });
  });
  if (reg.status === 'ISENTO') return res.status(201).json({ registrationId: reg.id, status: reg.status });

  const { providerRef, checkoutUrl } = await provider().createCheckout({ registration: reg, event: ev });
  await prisma.payment.create({ data: { registrationId: reg.id, provider: provider().name, providerRef: String(providerRef), checkoutUrl, amountCents: reg.amountCents } });
  res.status(201).json({ registrationId: reg.id, status: reg.status, checkoutUrl });
}));

// Simulador de gateway: só habilitado com PAYMENT_PROVIDER=mock e fora de produção.
pub.post('/mock-pay/:registrationId', wrap(async (req, res) => {
  if (config.payment.provider !== 'mock' || config.isProd) throw new HttpError(404, 'Não encontrado');
  await markPaid({ registrationId: Number(req.params.registrationId), providerName: 'MOCK', providerPaymentId: `mock-pay-${req.params.registrationId}` });
  res.json({ ok: true });
}));

pub.get('/registrations/:id/status', wrap(async (req, res) => {
  const reg = await prisma.registration.findUnique({ where: { id: Number(req.params.id) }, select: { status: true } });
  if (!reg) throw new HttpError(404, 'Não encontrado');
  res.json(reg);
}));

// ───────────── Webhook do gateway ─────────────
const webhooks = express.Router();

webhooks.post('/mercadopago', wrap(async (req, res) => {
  const type = req.body?.type || req.query.type || req.query.topic;
  const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id;
  if (type !== 'payment' || !paymentId) return res.sendStatus(200);
  const mp = providers.mercadopago;
  const payment = await mp.fetchPayment(paymentId);
  const registrationId = Number(payment.external_reference);
  if (payment.status === 'approved' && registrationId) {
    await markPaid({ registrationId, providerName: 'MERCADOPAGO', providerPaymentId: payment.id, amountCents: Math.round(payment.transaction_amount * 100), raw: { id: payment.id, status: payment.status } });
  }
  res.sendStatus(200);
}));

module.exports = { admin, pub, webhooks };
