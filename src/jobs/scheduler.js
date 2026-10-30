const cron = require('node-cron');
const config = require('../config');
const { sendBirthdayMessages } = require('../services/birthdays');

function startJobs() {
  if (config.birthday.enabled) {
    cron.schedule(config.birthday.cron, async () => {
      try {
        const r = await sendBirthdayMessages();
        console.log(`[aniversariantes] ${r.found} encontrados, ${r.sent} enviadas, ${r.failed} falhas, ${r.skipped} ignoradas`);
      } catch (e) {
        console.error('[aniversariantes] erro', e);
      }
    }, { timezone: process.env.TZ || 'America/Sao_Paulo' });
    console.log(`[jobs] aniversariantes agendado: "${config.birthday.cron}"`);
  }
}

module.exports = { startJobs };
