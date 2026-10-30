require('dotenv').config();

const env = process.env;
if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres em produção');
}

module.exports = {
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === 'production',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  corsOrigin: env.CORS_ORIGIN || false,
  tzOffset: env.TZ_OFFSET || '-03:00', // America/Sao_Paulo (sem horário de verão)
  tz: env.APP_TZ || 'America/Sao_Paulo',
  cronSecret: env.CRON_SECRET,
  publicUrl: env.PUBLIC_URL || 'http://localhost:3000',
  whatsapp: {
    provider: env.WHATSAPP_PROVIDER || 'log',
    evolutionUrl: env.EVOLUTION_URL,
    evolutionInstance: env.EVOLUTION_INSTANCE,
    evolutionKey: env.EVOLUTION_API_KEY,
    cloudToken: env.WHATSAPP_CLOUD_TOKEN,
    cloudPhoneId: env.WHATSAPP_CLOUD_PHONE_ID,
  },
  birthday: { cron: env.BIRTHDAY_CRON || '0 8 * * *', enabled: env.BIRTHDAY_JOB_ENABLED !== 'false' },
  payment: { provider: env.PAYMENT_PROVIDER || 'mock', mpToken: env.MERCADOPAGO_ACCESS_TOKEN },
};
