'use strict';
const $ = (s) => document.querySelector(s);
const token = new URLSearchParams(location.search).get('c') || '';
const msg = (html) => { $('#card').textContent = ''; $('#card').appendChild(html); };

function notice(big, title, text) {
  const d = document.createElement('div');
  d.className = 'v-ok';
  const b = document.createElement('div'); b.className = 'big'; b.textContent = big;
  const h = document.createElement('h2'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = text;
  d.append(b, h, p);
  return d;
}

async function init() {
  if (!token) return msg(notice('⚠️', 'Link inválido', 'Escaneie novamente o QR code da igreja.'));
  try {
    const res = await fetch('/api/public/visit/' + encodeURIComponent(token));
    if (!res.ok) throw new Error();
    const info = await res.json();
    $('#church').textContent = info.church;
    $('#event').textContent = info.event ? `Hoje: ${info.event}` : 'Ficamos felizes com a sua visita';
  } catch {
    msg(notice('⚠️', 'Link inválido ou expirado', 'Peça um novo QR code à equipe de recepção.'));
  }
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  $('#err').textContent = '';
  $('#send').disabled = true;
  try {
    const body = {
      name: f.name.value, phone: f.phone.value, email: f.email.value, birthDate: f.birthDate.value,
      howKnew: f.howKnew.value, prayerRequest: f.prayerRequest.value, wantsContact: f.wantsContact.checked,
      consent: f.consent.checked, website: f.website.value,
    };
    const res = await fetch('/api/public/visit/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.details?.map?.((d) => d.mensagem).join(' · ') || data.error || 'Não foi possível registrar');
    msg(data.alreadyRegistered
      ? notice('✅', `Que bom ver você, ${data.name}!`, 'Este WhatsApp já está cadastrado conosco, então não precisa se registrar de novo. Sua presença de hoje foi confirmada.')
      : notice('🙏', `Seja bem-vindo(a), ${data.name}!`, 'Seu cadastro foi feito. Em breve alguém da nossa equipe entrará em contato.'));
  } catch (err) {
    $('#err').textContent = err.message;
    $('#send').disabled = false;
  }
});

init();
