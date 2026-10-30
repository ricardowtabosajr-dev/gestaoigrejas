'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const params = new URLSearchParams(location.search);
if (params.get('paid')) $('#msg').textContent = 'Pagamento recebido! Sua inscrição será confirmada em instantes.';
if (params.get('pending')) $('#msg').textContent = 'Pagamento em análise. Você será confirmado assim que for aprovado.';

async function load() {
  const res = await fetch('/api/public/events');
  const events = await res.json();
  $('#events').innerHTML = events.length ? events.map((e) => `<div class="card"><h3>${esc(e.title)}</h3>
    <p class="muted">${new Date(e.startsAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}${e.location ? ' · ' + esc(e.location) : ''} · ${esc(e.church.name)}</p>
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    <p><b>${e.priceCents ? money(e.priceCents) : 'Gratuito'}</b></p>
    <button class="btn primary" data-id="${e.id}" data-title="${esc(e.title)}">Quero me inscrever</button></div>`).join('') : '<p class="muted">Nenhum evento com inscrições abertas no momento.</p>';
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  $('#modalBody').innerHTML = `<h3>${esc(b.dataset.title)}</h3><form id="f"><label>Nome completo<input name="name" required minlength="3"></label><label>E-mail<input name="email" type="email"></label><label>WhatsApp (com DDD)<input name="phone" inputmode="tel"></label><label>CPF<input name="cpf" inputmode="numeric"></label><p class="error" id="err"></p><div class="modal-actions"><button type="button" class="btn" id="cancel">Cancelar</button><button class="btn primary">Continuar</button></div></form>`;
  $('#modal').showModal();
  $('#cancel').onclick = () => $('#modal').close();
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    const res = await fetch(`/api/public/events/${b.dataset.id}/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { $('#err').textContent = data.details?.map?.((d) => `${d.campo}: ${d.mensagem}`).join('; ') || data.error; return; }
    if (data.checkoutUrl) location.href = data.checkoutUrl;
    else { $('#modal').close(); $('#msg').textContent = 'Inscrição confirmada! Deus abençoe.'; }
  };
});

load();
