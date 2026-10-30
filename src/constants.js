// Constantes de domínio e catálogo de permissões (RBAC).
const RESOURCES = ['churches', 'members', 'cells', 'events', 'attendance', 'finance', 'registrations', 'reports', 'users', 'messages'];
const ACTIONS = ['read', 'write', 'delete'];
const ALL_PERMISSIONS = RESOURCES.flatMap((r) => ACTIONS.map((a) => `${r}:${a}`));

const FINANCE_IN = ['DIZIMO', 'OFERTA', 'DOACAO', 'MANTENEDOR', 'OFERTA_ALCADA', 'CONSTRUCAO', 'EVENTO', 'INSCRICAO', 'OUTRA_ENTRADA'];
const FINANCE_OUT = ['DESPESA_FIXA', 'DESPESA_EVENTO', 'DESPESA_CONSTRUCAO', 'ACAO_SOCIAL', 'MISSOES', 'SALARIOS', 'OUTRA_SAIDA'];

const EVENT_KINDS = ['CULTO', 'RETIRO', 'SEMINARIO', 'CONGRESSO', 'EVANGELISMO', 'ACAO_SOCIAL', 'MISSAO', 'REUNIAO', 'OUTRO'];

// Cargos padrão criados no seed. level = hierarquia; perms = "recurso:ação", "recurso:*" ou "*".
const DEFAULT_ROLES = [
  { name: 'Apóstolo', level: 100, allChurches: true, perms: ['*'] },
  { name: 'Pastor', level: 80, perms: ['churches:read', 'members:*', 'cells:*', 'events:*', 'attendance:*', 'finance:read', 'registrations:read', 'reports:read', 'messages:read', 'users:read'] },
  { name: 'Missionário', level: 60, perms: ['churches:read', 'churches:write', 'members:read', 'members:write', 'cells:*', 'events:*', 'attendance:*', 'reports:read'] },
  { name: 'Diácono', level: 50, perms: ['members:read', 'cells:read', 'events:read', 'attendance:*', 'finance:read', 'finance:write', 'registrations:read', 'registrations:write'] },
  { name: 'Obreiro', level: 40, perms: ['members:read', 'members:write', 'cells:read', 'events:read', 'attendance:*'] },
  { name: 'Tesoureiro', level: 45, isMinistry: false, perms: ['members:read', 'events:read', 'finance:*', 'registrations:*', 'reports:read'] },
  { name: 'Secretário', level: 45, isMinistry: false, perms: ['members:*', 'cells:*', 'events:*', 'attendance:*', 'registrations:read', 'reports:read'] },
  { name: 'Líder de Célula', level: 30, perms: ['members:read', 'cells:read', 'cells:write', 'events:read'] },
  { name: 'Membro', level: 10, perms: ['events:read'] },
];

function expandPerms(perms) {
  const out = new Set();
  for (const p of perms) {
    if (p === '*') ALL_PERMISSIONS.forEach((x) => out.add(x));
    else if (p.endsWith(':*')) ACTIONS.forEach((a) => out.add(`${p.slice(0, -2)}:${a}`));
    else out.add(p);
  }
  return [...out];
}

module.exports = { RESOURCES, ACTIONS, ALL_PERMISSIONS, FINANCE_IN, FINANCE_OUT, EVENT_KINDS, DEFAULT_ROLES, expandPerms };
