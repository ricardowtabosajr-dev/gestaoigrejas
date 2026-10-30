const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere } = require('../middleware/auth');
const { sendBirthdayMessages, birthdaysOn, getTemplate } = require('../services/birthdays');

const router = express.Router();

router.get('/birthdays/today', requirePermission('messages:read'), wrap(async (req, res) => {
  const list = await birthdaysOn();
  const ids = new Set((await prisma.member.findMany({ where: await scopedWhere(req, { id: { in: list.map((m) => m.id) } }), select: { id: true } })).map((m) => m.id));
  res.json(list.filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone, church: m.church.name, receiveBirthdayMsg: m.receiveBirthdayMsg })));
}));

router.get('/birthdays/month', requirePermission('messages:read'), wrap(async (req, res) => {
  const month = z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1).parse(req.query.month);
  const members = await prisma.member.findMany({
    where: await scopedWhere(req, { birthDate: { not: null }, status: 'ATIVO' }),
    select: { id: true, fullName: true, birthDate: true, phone: true },
  });
  res.json(members.filter((m) => m.birthDate.getUTCMonth() + 1 === month).sort((a, b) => a.birthDate.getUTCDate() - b.birthDate.getUTCDate()));
}));

router.get('/template', requirePermission('messages:read'), wrap(async (_req, res) => res.json({ template: await getTemplate() })));

router.put('/template', requirePermission('messages:write'), wrap(async (req, res) => {
  const { template } = z.object({ template: z.string().trim().min(10).max(1000) }).parse(req.body);
  await prisma.setting.upsert({ where: { key: 'birthday_template' }, create: { key: 'birthday_template', value: template }, update: { value: template } });
  await audit(req, 'UPDATE', 'Setting', 'birthday_template');
  res.json({ template });
}));

// Execução manual (simulação por padrão: ?dryRun=false para enviar de fato). Afeta todas as igrejas → apenas escopo global.
router.post('/birthdays/run', requirePermission('messages:write'), wrap(async (req, res) => {
  if (!req.user.allChurches) return res.status(403).json({ error: 'Apenas cargos com acesso a todas as igrejas' });
  const dryRun = req.query.dryRun !== 'false';
  const summary = await sendBirthdayMessages({ dryRun });
  await audit(req, 'CREATE', 'MessageLog', null, { dryRun, sent: summary.sent });
  res.json(summary);
}));

router.get('/log', requirePermission('messages:read'), wrap(async (req, res) => {
  const where = { member: await scopedWhere(req) };
  res.json(await prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { member: { select: { fullName: true } } } }));
}));

module.exports = router;
