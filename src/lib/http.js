const { ZodError } = require('zod');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Permite handlers async sem try/catch em cada rota.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Dados inválidos', details: err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.code === 'P2002') return res.status(409).json({ error: 'Registro duplicado', campos: err.meta?.target });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Registro não encontrado' });
  if (err.code === 'P2003') return res.status(409).json({ error: 'Registro vinculado a outros dados' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
}

module.exports = { HttpError, wrap, errorHandler };
