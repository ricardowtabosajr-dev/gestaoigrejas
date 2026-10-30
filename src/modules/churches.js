const { z } = require('zod');
const { crud, dateOpt, strOpt, intOpt } = require('../lib/crud');

// Matriz, filiais, congregações e igrejas em implantação (expansão).
const schema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(['MATRIZ', 'FILIAL', 'CONGREGACAO', 'PONTO_DE_PREGACAO']).default('FILIAL'),
  status: z.enum(['PLANEJADA', 'EM_IMPLANTACAO', 'ATIVA', 'INATIVA']).default('ATIVA'),
  parentId: intOpt,
  address: strOpt,
  city: strOpt,
  state: strOpt,
  phone: strOpt,
  foundedAt: dateOpt,
  plannedAt: dateOpt,
  notes: strOpt,
  pastorId: intOpt,
});

module.exports = crud({
  model: 'church',
  resource: 'churches',
  scopeField: 'id',
  create: schema,
  update: schema.partial(),
  search: ['name', 'city'],
  filters: { status: 'str', type: 'str', parentId: 'int' },
  include: { pastor: { select: { id: true, fullName: true } }, parent: { select: { id: true, name: true } }, _count: { select: { members: true, cells: true } } },
  orderBy: { name: 'asc' },
});
