const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');

// Valida o JWT e recarrega usuário/permissões do banco (revogação imediata ao desativar/alterar cargo).
const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Não autenticado');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Sessão inválida ou expirada');
  }
  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    include: { role: { include: { permissions: true } } },
  });
  if (!user || !user.active) throw new HttpError(401, 'Usuário inativo');
  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    churchId: user.churchId,
    roleId: user.roleId,
    roleName: user.role.name,
    allChurches: user.role.allChurches,
    permissions: new Set(user.role.permissions.map((p) => p.permission)),
  };
  next();
});

const requirePermission = (...perms) => (req, _res, next) => {
  if (perms.some((p) => req.user.permissions.has(p))) return next();
  next(new HttpError(403, 'Sem permissão para esta ação'));
};

// Escopo: quem não é "allChurches" só enxerga a própria igreja e suas filiais diretas.
// Retorna null (sem restrição) ou lista de ids.
async function churchScope(req) {
  if (req.user.allChurches) return null;
  if (!req.user.churchId) return [];
  const children = await prisma.church.findMany({ where: { parentId: req.user.churchId }, select: { id: true } });
  return [req.user.churchId, ...children.map((c) => c.id)];
}

async function scopedWhere(req, extra = {}, field = 'churchId') {
  const ids = await churchScope(req);
  return ids === null ? extra : { ...extra, [field]: { in: ids } };
}

async function assertChurchAccess(req, churchId) {
  const ids = await churchScope(req);
  if (ids !== null && !ids.includes(Number(churchId))) throw new HttpError(403, 'Igreja fora do seu escopo');
}

module.exports = { authenticate, requirePermission, churchScope, scopedWhere, assertChurchAccess };
