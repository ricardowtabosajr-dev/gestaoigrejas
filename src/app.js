const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { errorHandler, HttpError, wrap } = require('./lib/http');
const { sendBirthdayMessages } = require('./services/birthdays');
const { authenticate } = require('./middleware/auth');
const registrations = require('./modules/registrations');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'script-src': ["'self'"], 'script-src-attr': ["'none'"] } } }));
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

// Rotas públicas / sem sessão
app.use('/api/auth', require('./modules/auth').router);
app.use('/api/public', registrations.pub);
app.use('/api/webhooks', registrations.webhooks);

// Cron da Vercel: a plataforma envia "Authorization: Bearer $CRON_SECRET".
app.get('/api/cron/birthdays', wrap(async (req, res) => {
  if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) throw new HttpError(401, 'Não autorizado');
  const r = await sendBirthdayMessages();
  res.json({ found: r.found, sent: r.sent, failed: r.failed, skipped: r.skipped, remaining: r.remaining });
}));

// Rotas protegidas (JWT + permissões por recurso dentro de cada módulo)
const api = express.Router();
api.use(authenticate);
api.use('/users', require('./modules/users'));
api.use('/churches', require('./modules/churches'));
api.use('/members', require('./modules/members'));
api.use('/cells', require('./modules/cells'));
api.use('/events', require('./modules/events'));
api.use('/finance', require('./modules/finance'));
api.use('/registrations', registrations.admin);
api.use('/messages', require('./modules/messages'));
api.use('/reports', require('./modules/reports'));
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(errorHandler);

module.exports = app;
