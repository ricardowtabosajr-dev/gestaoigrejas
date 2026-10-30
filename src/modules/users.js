const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { requirePermission, churchScope } = require('../middleware/auth');
const { passwordSchema } = require('./auth');
const { ALL_PERMISSIONS } = require('../constants');

const router = express.Router();
const publicUser = { id: true, email: true, name: true, active: true, roleId: true, churchId: true, memberId: true, lastLoginAt: true, role: { select: { name: true } } };

// Impede escalonamento de privilégio: só atribui cargos de nível <= ao seu (apóstolo atribui qualquer um).
async function assertCanAssignRole(req, roleId) {
  const [target, mine] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId } }),
    prisma.role.findUnique({ where: { id: req.user.roleId } }),
  ]);
  if (!target) throw new HttpError(400, 'Cargo inexistente');
  if (target.level > mine.level) throw new HttpError(403, 'Você não pode atribuir um cargo acima do seu');
}

router.get('/roles', requirePermission('users:read', 'members:read'), wrap(async (_req, res) => {
  res.json(await prisma.role.findMany({ orderBy: { level: 'desc' }, include: { permissions: true } }));
}));

router.get('/permissions', requirePermission('users:read'), (_req, res) => res.json(ALL_PERMISSIONS));

const roleSchema = z.object({
  name: z.string().trim().min(2),
  level: z.coerce.number().int().min(0).max(99),
  isMinistry: z.boolean().optional(),
  allChurches: z.boolean().optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS)),
});

// Criar/editar cargos é restrito a quem tem todos os poderes de usuários (apóstolo).
router.post('/roles', requirePermission('users:delete'), wrap(async (req, res) => {
  const { permissions, ...data } = roleSchema.parse(req.body);
  const role = await prisma.role.create({ data: { ...data, permissions: { create: permissions.map((permission) => ({ permission })) } }, include: { permissions: true } });
  await audit(req, 'CREATE', 'Role', role.id);
  res.status(201).json(role);
}));

router.put('/roles/:id', requirePermission('users:delete'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { permissions, ...data } = roleSchema.parse(req.body);
  const role = await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    return tx.role.update({ where: { id }, data: { ...data, permissions: { create: permissions.map((permission) => ({ permission })) } }, include: { permissions: true } });
  });
  await audit(req, 'UPDATE', 'Role', id);
  res.json(role);
}));

router.get('/', requirePermission('users:read'), wrap(async (req, res) => {
  const ids = await churchScope(req);
  res.json(await prisma.user.findMany({ where: ids === null ? {} : { churchId: { in: ids } }, select: publicUser, orderBy: { name: 'asc' } }));
}));

const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(2),
  password: passwordSchema,
  roleId: z.coerce.number().int(),
  churchId: z.coerce.number().int().nullable().optional(),
  memberId: z.coerce.number().int().nullable().optional(),
});

router.post('/', requirePermission('users:write'), wrap(async (req, res) => {
  const data = createSchema.parse(req.body);
  await assertCanAssignRole(req, data.roleId);
  const ids = await churchScope(req);
  if (ids !== null && !ids.includes(data.churchId)) throw new HttpError(403, 'Igreja fora do seu escopo');
  const { password, ...rest } = data;
  const user = await prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 12), mustChangePw: true }, select: publicUser });
  await audit(req, 'CREATE', 'User', user.id);
  res.status(201).json(user);
}));

router.put('/:id', requirePermission('users:write'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const body = createSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const ids = await churchScope(req);
  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target || (ids !== null && !ids.includes(target.churchId))) throw new HttpError(404, 'Usuário não encontrado');
  const mine = await prisma.role.findUnique({ where: { id: req.user.roleId } });
  if (target.role.level > mine.level) throw new HttpError(403, 'Você não pode alterar um usuário de cargo superior');
  if (body.roleId) await assertCanAssignRole(req, body.roleId);
  if (id === req.user.id && body.active === false) throw new HttpError(400, 'Você não pode desativar a si mesmo');
  const { password, ...rest } = body;
  const data = { ...rest };
  if (password) { data.passwordHash = await bcrypt.hash(password, 12); data.mustChangePw = true; }
  const user = await prisma.user.update({ where: { id }, data, select: publicUser });
  await audit(req, 'UPDATE', 'User', id, Object.keys(body));
  res.json(user);
}));

module.exports = router;
