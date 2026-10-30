const express = require('express');
const { z } = require('zod');
const prisma = require('./prisma');
const { HttpError, wrap } = require('./http');
const { audit } = require('./audit');
const { requirePermission, churchScope } = require('../middleware/auth');

// Helpers de validação reutilizáveis pelos módulos.
const dateOpt = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const dateReq = z.coerce.date();
const strOpt = z.preprocess((v) => (v === '' ? null : v), z.string().trim().nullable().optional());
const intOpt = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().nullable().optional());
const phoneOpt = z.preprocess(
  (v) => (v === '' || v == null ? null : String(v).replace(/\D/g, '')),
  z.string().min(10).max(15).nullable().optional(),
);

/**
 * Gera CRUD REST com RBAC, escopo por igreja, paginação, busca e auditoria.
 * opts: model, resource, create (zod), update (zod, opcional), scopeField ('churchId'|'id'|null),
 *       search[], filters {campo:'int'|'str'}, include, orderBy, beforeSave(data, req)
 */
function crud(opts) {
  const { model, resource, scopeField = 'churchId', search = [], filters = {}, include, orderBy = { id: 'desc' } } = opts;
  const createSchema = opts.create;
  const updateSchema = opts.update || createSchema.partial();
  const db = prisma[model];
  const router = express.Router();

  async function scoped(req, where = {}) {
    if (!scopeField) return where;
    const ids = await churchScope(req);
    return ids === null ? where : { ...where, [scopeField]: { in: ids } };
  }

  async function loadOwned(req, id) {
    const rec = await db.findFirst({ where: await scoped(req, { id }), include });
    if (!rec) throw new HttpError(404, 'Registro não encontrado');
    return rec;
  }

  async function assertWritableChurch(req, churchId) {
    if (!scopeField || churchId == null) return;
    const ids = await churchScope(req);
    if (ids !== null && !ids.includes(Number(churchId))) throw new HttpError(403, 'Igreja fora do seu escopo');
  }

  router.get('/', requirePermission(`${resource}:read`), wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const and = [];
    if (req.query.q && search.length) and.push({ OR: search.map((f) => ({ [f]: { contains: String(req.query.q), mode: 'insensitive' } })) });
    for (const [f, kind] of Object.entries(filters)) {
      const v = req.query[f];
      if (v === undefined || v === '') continue;
      and.push({ [f]: kind === 'int' ? Number(v) : String(v) });
    }
    const where = await scoped(req, and.length ? { AND: and } : {});
    const [total, items] = await Promise.all([
      db.count({ where }),
      db.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ items, total, page, pageSize });
  }));

  router.get('/:id', requirePermission(`${resource}:read`), wrap(async (req, res) => {
    res.json(await loadOwned(req, Number(req.params.id)));
  }));

  router.post('/', requirePermission(`${resource}:write`), wrap(async (req, res) => {
    const data = createSchema.parse(req.body);
    if (scopeField === 'churchId') {
      if (data.churchId == null) data.churchId = req.user.churchId;
      if (data.churchId == null) throw new HttpError(400, 'churchId obrigatório');
      await assertWritableChurch(req, data.churchId);
    }
    if (opts.beforeSave) await opts.beforeSave(data, req);
    const rec = await db.create({ data, include });
    await audit(req, 'CREATE', model, rec.id);
    res.status(201).json(rec);
  }));

  router.put('/:id', requirePermission(`${resource}:write`), wrap(async (req, res) => {
    const id = Number(req.params.id);
    await loadOwned(req, id);
    const data = updateSchema.parse(req.body);
    if (scopeField === 'churchId' && data.churchId != null) await assertWritableChurch(req, data.churchId);
    if (opts.beforeSave) await opts.beforeSave(data, req, id);
    const rec = await db.update({ where: { id }, data, include });
    await audit(req, 'UPDATE', model, id, Object.keys(data));
    res.json(rec);
  }));

  router.delete('/:id', requirePermission(`${resource}:delete`), wrap(async (req, res) => {
    const id = Number(req.params.id);
    await loadOwned(req, id);
    await db.delete({ where: { id } });
    await audit(req, 'DELETE', model, id);
    res.status(204).end();
  }));

  return router;
}

module.exports = { crud, dateOpt, dateReq, strOpt, intOpt, phoneOpt };
