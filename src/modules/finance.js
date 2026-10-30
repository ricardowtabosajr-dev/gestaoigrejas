const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere, assertChurchAccess } = require('../middleware/auth');
const { dateReq, strOpt, intOpt } = require('../lib/crud');
const { FINANCE_IN, FINANCE_OUT } = require('../constants');

const router = express.Router();

// ── Caixas / contas ──
router.get('/accounts', requirePermission('finance:read'), wrap(async (req, res) => {
  const accounts = await prisma.cashAccount.findMany({ where: await scopedWhere(req, { active: true }), include: { church: { select: { name: true } } } });
  const sums = await prisma.transaction.groupBy({ by: ['cashAccountId', 'direction'], where: { cashAccountId: { in: accounts.map((a) => a.id) } }, _sum: { amountCents: true } });
  res.json(accounts.map((a) => {
    const inn = sums.find((s) => s.cashAccountId === a.id && s.direction === 'ENTRADA')?._sum.amountCents ?? 0;
    const out = sums.find((s) => s.cashAccountId === a.id && s.direction === 'SAIDA')?._sum.amountCents ?? 0;
    return { ...a, balanceCents: a.openingCents + inn - out };
  }));
}));

router.post('/accounts', requirePermission('finance:write'), wrap(async (req, res) => {
  const data = z.object({ churchId: intOpt, name: z.string().trim().min(2), openingCents: z.coerce.number().int().default(0) }).parse(req.body);
  data.churchId ??= req.user.churchId;
  await assertChurchAccess(req, data.churchId);
  const acc = await prisma.cashAccount.create({ data });
  await audit(req, 'CREATE', 'CashAccount', acc.id);
  res.status(201).json(acc);
}));

// ── Lançamentos ──
const txSchema = z.object({
  cashAccountId: z.coerce.number().int(),
  direction: z.enum(['ENTRADA', 'SAIDA']),
  category: z.enum([...FINANCE_IN, ...FINANCE_OUT]),
  amountCents: z.coerce.number().int().positive('Valor deve ser maior que zero'),
  date: dateReq,
  method: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'TRANSFERENCIA', 'BOLETO']).default('DINHEIRO'),
  memberId: intOpt,
  donorName: strOpt,
  eventId: intOpt,
  description: strOpt,
}).refine((d) => (d.direction === 'ENTRADA' ? FINANCE_IN : FINANCE_OUT).includes(d.category), { message: 'Categoria incompatível com o tipo de lançamento', path: ['category'] });

const include = { member: { select: { id: true, fullName: true } }, event: { select: { id: true, title: true } }, cashAccount: { select: { name: true } } };

router.get('/categories', requirePermission('finance:read'), (_req, res) => res.json({ entrada: FINANCE_IN, saida: FINANCE_OUT }));

router.get('/transactions', requirePermission('finance:read'), wrap(async (req, res) => {
  const q = z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), category: z.string().optional(), direction: z.string().optional(),
    memberId: z.coerce.number().int().optional(), eventId: z.coerce.number().int().optional(), cashAccountId: z.coerce.number().int().optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const extra = {};
  if (q.from || q.to) extra.date = { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) };
  for (const k of ['category', 'direction', 'memberId', 'eventId', 'cashAccountId']) if (q[k] !== undefined) extra[k] = q[k];
  const where = await scopedWhere(req, extra);
  const [total, items, sums] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({ where, include, orderBy: { date: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.transaction.groupBy({ by: ['direction'], where, _sum: { amountCents: true } }),
  ]);
  const inn = sums.find((s) => s.direction === 'ENTRADA')?._sum.amountCents ?? 0;
  const out = sums.find((s) => s.direction === 'SAIDA')?._sum.amountCents ?? 0;
  res.json({ items, total, page: q.page, totals: { entradaCents: inn, saidaCents: out, saldoCents: inn - out } });
}));

router.post('/transactions', requirePermission('finance:write'), wrap(async (req, res) => {
  const data = txSchema.parse(req.body);
  const account = await prisma.cashAccount.findFirst({ where: await scopedWhere(req, { id: data.cashAccountId, active: true }) });
  if (!account) throw new HttpError(404, 'Caixa não encontrado');
  if (data.memberId) {
    const m = await prisma.member.findFirst({ where: await scopedWhere(req, { id: data.memberId }) });
    if (!m) throw new HttpError(404, 'Membro não encontrado');
  }
  const tx = await prisma.transaction.create({ data: { ...data, churchId: account.churchId, createdById: req.user.id }, include });
  await audit(req, 'CREATE', 'Transaction', tx.id, { category: tx.category, amountCents: tx.amountCents });
  res.status(201).json(tx);
}));

// Lançamentos financeiros não são editados: estorno gera registro de auditoria (rastreabilidade).
router.delete('/transactions/:id', requirePermission('finance:delete'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const tx = await prisma.transaction.findFirst({ where: await scopedWhere(req, { id }) });
  if (!tx) throw new HttpError(404, 'Lançamento não encontrado');
  if (tx.registrationId) throw new HttpError(409, 'Lançamento de inscrição: cancele/estorne a inscrição');
  await prisma.transaction.delete({ where: { id } });
  await audit(req, 'DELETE', 'Transaction', id, { category: tx.category, amountCents: tx.amountCents, date: tx.date });
  res.status(204).end();
}));

// Extrato por membro (dizimista/ofertante).
router.get('/members/:id/giving', requirePermission('finance:read'), wrap(async (req, res) => {
  const memberId = Number(req.params.id);
  const where = await scopedWhere(req, { memberId, direction: 'ENTRADA' });
  const [byCategory, items] = await Promise.all([
    prisma.transaction.groupBy({ by: ['category'], where, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.transaction.findMany({ where, orderBy: { date: 'desc' }, take: 100 }),
  ]);
  res.json({ byCategory, items });
}));

module.exports = router;
