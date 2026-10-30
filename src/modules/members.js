const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, scopedWhere } = require('../middleware/auth');
const { crud, dateOpt, dateReq, strOpt, intOpt, phoneOpt } = require('../lib/crud');

const memberSchema = z.object({
  churchId: intOpt,
  fullName: z.string().trim().min(2),
  gender: z.enum(['M', 'F']).nullable().optional(),
  birthDate: dateOpt,
  maritalStatus: strOpt,
  cpf: z.preprocess((v) => (v ? String(v).replace(/\D/g, '') : null), z.string().length(11).nullable().optional()),
  email: z.preprocess((v) => (v === '' ? null : v), z.email().nullable().optional()),
  phone: phoneOpt,
  address: strOpt,
  city: strOpt,
  state: strOpt,
  zip: strOpt,
  profession: strOpt,
  employer: strOpt,
  education: strOpt,
  photoUrl: strOpt,
  notes: strOpt,
  status: z.enum(['VISITANTE', 'ATIVO', 'INATIVO', 'AFASTADO', 'TRANSFERIDO', 'FALECIDO']).optional(),
  roleId: intOpt,
  receiveBirthdayMsg: z.boolean().optional(),
  conversionDate: dateOpt,
  baptismDate: dateOpt,
  baptismChurch: strOpt,
  membershipDate: dateOpt,
  leadershipSchoolDate: dateOpt,
  discipleshipStartDate: dateOpt,
  discipulatorId: intOpt,
});

// Evita ciclos na árvore de discipulado (A discipula B que discipula A).
async function checkDiscipleshipCycle(data, _req, selfId) {
  if (data.discipulatorId == null) return;
  if (selfId && data.discipulatorId === selfId) throw new HttpError(400, 'Membro não pode discipular a si mesmo');
  let cur = data.discipulatorId;
  for (let i = 0; cur && i < 100; i++) {
    if (selfId && cur === selfId) throw new HttpError(400, 'Vínculo de discipulado criaria um ciclo');
    const m = await prisma.member.findUnique({ where: { id: cur }, select: { discipulatorId: true } });
    if (!m) throw new HttpError(400, 'Discipulador inexistente');
    cur = m.discipulatorId;
  }
}

const base = crud({
  model: 'member',
  resource: 'members',
  create: memberSchema,
  search: ['fullName', 'email', 'phone', 'profession'],
  filters: { status: 'str', churchId: 'int', roleId: 'int', discipulatorId: 'int' },
  include: { role: { select: { id: true, name: true } }, discipulator: { select: { id: true, fullName: true } } },
  orderBy: { fullName: 'asc' },
  beforeSave: checkDiscipleshipCycle,
});

const router = express.Router();

// Árvore de discipulado (a partir de um membro, ou raízes de toda a igreja).
router.get('/tree/all', requirePermission('members:read'), wrap(async (req, res) => {
  const rows = await prisma.member.findMany({
    where: await scopedWhere(req, { status: { not: 'FALECIDO' } }),
    select: { id: true, fullName: true, discipulatorId: true, status: true, role: { select: { name: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.fullName, role: r.role?.name, status: r.status, disciples: [], parent: r.discipulatorId }]));
  const roots = [];
  for (const n of byId.values()) {
    const parent = byId.get(n.parent);
    (parent ? parent.disciples : roots).push(n);
  }
  const strip = (n) => ({ id: n.id, name: n.name, role: n.role, status: n.status, disciples: n.disciples.map(strip) });
  res.json(roots.map(strip));
}));

// Jornada de fé completa do membro.
router.get('/:id/journey', requirePermission('members:read'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const m = await prisma.member.findFirst({
    where: await scopedWhere(req, { id }),
    include: {
      discipulator: { select: { id: true, fullName: true } },
      disciples: { select: { id: true, fullName: true, conversionDate: true, baptismDate: true } },
      discipleshipRecords: { orderBy: { date: 'desc' }, include: { discipulator: { select: { fullName: true } } } },
      achievements: { orderBy: { date: 'desc' } },
      cellMemberships: { include: { cell: { select: { id: true, name: true } } } },
      _count: { select: { attendances: true } },
    },
  });
  if (!m) throw new HttpError(404, 'Membro não encontrado');
  res.json(m);
}));

const recordSchema = z.object({
  date: dateReq,
  type: z.enum(['ENCONTRO', 'CURSO', 'MENTORIA', 'ACONSELHAMENTO', 'ETAPA']).default('ENCONTRO'),
  title: z.string().trim().min(2),
  notes: strOpt,
  discipulatorId: intOpt,
});

router.post('/:id/discipleship', requirePermission('members:write'), wrap(async (req, res) => {
  const memberId = Number(req.params.id);
  if (!(await prisma.member.findFirst({ where: await scopedWhere(req, { id: memberId }) }))) throw new HttpError(404, 'Membro não encontrado');
  const rec = await prisma.discipleshipRecord.create({ data: { ...recordSchema.parse(req.body), memberId } });
  await audit(req, 'CREATE', 'DiscipleshipRecord', rec.id);
  res.status(201).json(rec);
}));

const achievementSchema = z.object({ title: z.string().trim().min(2), category: z.string().trim().default('ESPIRITUAL'), description: strOpt, date: dateReq });

router.post('/:id/achievements', requirePermission('members:write'), wrap(async (req, res) => {
  const memberId = Number(req.params.id);
  if (!(await prisma.member.findFirst({ where: await scopedWhere(req, { id: memberId }) }))) throw new HttpError(404, 'Membro não encontrado');
  const rec = await prisma.achievement.create({ data: { ...achievementSchema.parse(req.body), memberId } });
  await audit(req, 'CREATE', 'Achievement', rec.id);
  res.status(201).json(rec);
}));

router.use(base);

module.exports = router;
