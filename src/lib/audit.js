const prisma = require('./prisma');

// Auditoria nunca deve derrubar a requisição principal.
async function audit(req, action, entity, entityId, details) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        details: details ? JSON.stringify(details).slice(0, 2000) : null,
        ip: req.ip,
      },
    });
  } catch (e) {
    console.error('audit falhou', e.message);
  }
}
module.exports = { audit };
