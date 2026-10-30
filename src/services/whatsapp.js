const config = require('../config');

// Provedores de WhatsApp. Interface: send(toNumber, text) -> Promise<void> (lança erro em caso de falha).
const providers = {
  // Desenvolvimento: apenas registra no console.
  log: {
    async send(to, text) {
      console.log(`[whatsapp:log] -> ${to}: ${text}`);
    },
  },

  // Evolution API (self-hosted). https://doc.evolution-api.com
  evolution: {
    async send(to, text) {
      const { evolutionUrl, evolutionInstance, evolutionKey } = config.whatsapp;
      if (!evolutionUrl || !evolutionInstance || !evolutionKey) throw new Error('Evolution API não configurada');
      const res = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(evolutionInstance)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify({ number: to, text }),
      });
      if (!res.ok) throw new Error(`Evolution API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  },

  // API oficial (Meta WhatsApp Cloud). Atenção: fora da janela de 24h só é permitido enviar
  // mensagens de template aprovado; para mensagens ativas em massa, use `template` (ver README).
  cloud: {
    async send(to, text) {
      const { cloudToken, cloudPhoneId } = config.whatsapp;
      if (!cloudToken || !cloudPhoneId) throw new Error('WhatsApp Cloud API não configurada');
      const res = await fetch(`https://graph.facebook.com/v20.0/${cloudPhoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cloudToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      });
      if (!res.ok) throw new Error(`WhatsApp Cloud ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  },
};

function getProvider() {
  const p = providers[config.whatsapp.provider];
  if (!p) throw new Error(`WHATSAPP_PROVIDER inválido: ${config.whatsapp.provider}`);
  return p;
}

// Garante DDI do Brasil quando o número foi cadastrado sem ele.
function normalizeNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

module.exports = { getProvider, normalizeNumber };
