'use strict';
// Painel administrativo (SPA sem dependências). Todo conteúdo dinâmico passa por esc() (anti-XSS).

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
const fDateTime = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const LABEL = {
  CULTO: 'Culto', RETIRO: 'Retiro', SEMINARIO: 'Seminário', CONGRESSO: 'Congresso', EVANGELISMO: 'Evangelismo', ACAO_SOCIAL: 'Ação social', MISSAO: 'Missão', REUNIAO: 'Reunião', OUTRO: 'Outro',
  DIZIMO: 'Dízimo', OFERTA: 'Oferta', DOACAO: 'Doação', MANTENEDOR: 'Mantenedor', OFERTA_ALCADA: 'Oferta alçada', CONSTRUCAO: 'Construção', EVENTO: 'Evento', INSCRICAO: 'Inscrição', OUTRA_ENTRADA: 'Outra entrada',
  DESPESA_FIXA: 'Despesa fixa', DESPESA_EVENTO: 'Despesa de evento', DESPESA_CONSTRUCAO: 'Despesa de construção', MISSOES: 'Missões', SALARIOS: 'Salários', OUTRA_SAIDA: 'Outra saída',
  PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado', ISENTO: 'Isento', FREQUENTE: 'Frequente', IRREGULAR: 'Irregular', AUSENTE: 'Ausente',
};
const lbl = (k) => LABEL[k] || k;
const badge = (s) => `<span class="badge ${{ PAGO: 'ok', ISENTO: 'ok', FREQUENTE: 'ok', ATIVO: 'ok', PENDENTE: 'warn', IRREGULAR: 'warn', CANCELADO: 'bad', AUSENTE: 'bad', INATIVO: 'bad' }[s] || ''}">${esc(lbl(s))}</span>`;

let token = sessionStorage.getItem('token');
let me = null;
let actions = {};
let cleanup = null;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth/login')) { logout(); throw new Error('Sessão expirada'); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.details?.map?.((d) => `${d.campo}: ${d.mensagem}`).join('; ') || data?.error || 'Erro');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ── Modal e formulários dirigidos por configuração ──
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').showModal(); }
const closeModal = () => $('#modal').close();

function fieldHtml(f, v = {}) {
  const val = v[f.name];
  const req = f.required ? 'required' : '';
  if (f.type === 'select') return `<label>${esc(f.label)}<select name="${f.name}" ${req}>${f.required ? '' : '<option value=""></option>'}${f.options.map(([k, t]) => `<option value="${esc(k)}" ${String(val ?? f.default ?? '') === String(k) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${f.name}" ${(val ?? f.default) ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'textarea') return `<label>${esc(f.label)}<textarea name="${f.name}" rows="2">${esc(val)}</textarea></label>`;
  let shown = val ?? '';
  if (f.type === 'date') shown = toInputDate(val);
  if (f.type === 'datetime-local' && val) { const d = new Date(val); shown = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  if (f.type === 'money' && val != null) shown = (val / 100).toFixed(2);
  return `<label>${esc(f.label)}<input name="${f.name}" type="${f.type === 'money' ? 'number' : f.type || 'text'}" ${f.type === 'money' ? 'step="0.01" min="0"' : ''} value="${esc(shown)}" ${req}></label>`;
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (f.type === 'checkbox') { out[f.name] = el.checked; continue; }
    const v = el.value.trim();
    if (v === '') { if (f.nullable) out[f.name] = null; continue; }
    if (f.type === 'number' || (f.type === 'select' && f.num)) out[f.name] = Number(v);
    else if (f.type === 'money') out[f.name] = Math.round(parseFloat(v) * 100);
    else if (f.type === 'datetime-local') out[f.name] = new Date(v).toISOString();
    else out[f.name] = v;
  }
  return out;
}

function formModal({ title, fields, values, onSubmit }) {
  openModal(`<h3>${esc(title)}</h3><form id="mf"><div class="form-grid">${fields.map((f) => fieldHtml(f, values)).join('')}</div><p class="error" id="mfErr"></p><div class="modal-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
  $('#mf').onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(readForm(e.target, fields)); closeModal(); toast('Salvo com sucesso'); } catch (err) { $('#mfErr').textContent = err.message; }
  };
}

const table = (cols, rows, empty = 'Nada por aqui ainda.') =>
  rows.length ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.v(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted">${empty}</p>`;
const has = (p) => me?.permissions.includes(p);
const stat = (v, l) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
const bars = (rows, valueKey, labelKey, fmt = String, cls = '') => { const max = Math.max(1, ...rows.map((r) => r[valueKey])); return rows.map((r) => `<div class="bar-row"><span>${esc(r[labelKey])}</span><div class="bar ${cls}"><i style="width:${(r[valueKey] / max) * 100}%"></i></div><b>${esc(fmt(r[valueKey]))}</b></div>`).join(''); };

// ── Listas auxiliares ──
const churchOpts = async () => (await api('/churches?pageSize=200')).items.map((c) => [c.id, c.name]);
const memberOpts = async () => (await api('/members?pageSize=200')).items.map((m) => [m.id, m.fullName]);

// ───────────── Páginas ─────────────
const pages = {};

pages.dashboard = { title: 'Painel', perm: null, async render(v) {
  const d = await api('/reports/dashboard');
  const b = has('messages:read') ? await api('/messages/birthdays/today') : [];
  v.innerHTML = `<div class="grid">${stat(d.members.active, 'Membros ativos')}${stat(d.members.newThisMonth, 'Novos no mês')}${stat(d.members.visitsWeek, 'Visitas (7 dias)')}${stat(d.faith.conversionsThisMonth, 'Conversões no mês')}${stat(d.faith.baptismsThisMonth, 'Batismos no mês')}${stat(d.cells.active, 'Células ativas')}${d.finance ? stat(money(d.finance.monthIncomeCents), 'Entradas do mês') + stat(money(d.finance.monthBalanceCents), 'Saldo do mês') : ''}</div>
  <div class="card"><h3>Próximos eventos</h3>${table([{ h: 'Data', v: (e) => fDateTime(e.startsAt) }, { h: 'Evento', v: (e) => e.title }, { h: 'Tipo', v: (e) => lbl(e.kind) }, { h: 'Local', v: (e) => e.location || '—' }], d.upcomingEvents)}</div>
  <div class="card"><h3>🎂 Aniversariantes de hoje</h3>${table([{ h: 'Nome', v: (m) => m.fullName }, { h: 'Igreja', v: (m) => m.church }, { h: 'WhatsApp', v: (m) => m.phone || 'sem telefone' }], b)}</div>`;
} };

pages.agenda = { title: 'Cultos e Agenda', perm: 'events:read', async render(v) {
  const filters = { scope: '', kind: '' };
  const load = async () => {
    const q = new URLSearchParams({ pageSize: 100, ...(filters.scope && { scope: filters.scope }), ...(filters.kind && { kind: filters.kind }) });
    const { items } = await api('/events?' + q);
    $('#list').innerHTML = table([
      { h: 'Data', v: (e) => fDateTime(e.startsAt) }, { h: 'Evento', v: (e) => e.title }, { h: 'Tipo', v: (e) => lbl(e.kind) }, { h: 'Âmbito', v: (e) => (e.scope === 'EXTERNO' ? 'Externo' : 'Interno') },
      { h: 'Presenças', num: 1, v: (e) => e._count.attendances }, { h: 'Inscritos', num: 1, v: (e) => (e.allowRegistration ? e._count.registrations : '—') },
      { h: '', html: (e) => `${has('attendance:write') ? `<button class="btn small" data-act="attendance" data-id="${e.id}">Chamada</button> ` : ''}${has('events:write') ? `<button class="btn small" data-act="editEvent" data-id="${e.id}">Editar</button>` : ''}` },
    ], items);
    actions.items = items;
  };
  v.innerHTML = `<div class="toolbar"><select id="fScope"><option value="">Todos os âmbitos</option><option value="INTERNO">Interno</option><option value="EXTERNO">Externo (evangelismo, ação social, missões)</option></select><select id="fKind"><option value="">Todos os tipos</option>${Object.keys(LABEL).slice(0, 9).map((k) => `<option value="${k}">${LABEL[k]}</option>`).join('')}</select><span class="grow"></span>${has('events:write') ? '<button class="btn" data-act="weekly">Gerar cultos semanais</button><button class="btn primary" data-act="newEvent">+ Novo</button>' : ''}</div><div class="card" id="list"></div>`;
  $('#fScope').onchange = (e) => { filters.scope = e.target.value; load(); };
  $('#fKind').onchange = (e) => { filters.kind = e.target.value; load(); };
  await load();
  const eventFields = async () => [
    { name: 'churchId', label: 'Igreja', type: 'select', options: await churchOpts(), num: true, required: true, default: me.churchId },
    { name: 'title', label: 'Título', required: true }, { name: 'kind', label: 'Tipo', type: 'select', required: true, options: Object.keys(LABEL).slice(0, 9).map((k) => [k, LABEL[k]]) },
    { name: 'scope', label: 'Âmbito', type: 'select', required: true, options: [['INTERNO', 'Interno'], ['EXTERNO', 'Externo']] },
    { name: 'startsAt', label: 'Início', type: 'datetime-local', required: true }, { name: 'endsAt', label: 'Fim', type: 'datetime-local', nullable: true },
    { name: 'location', label: 'Local', nullable: true }, { name: 'preacher', label: 'Pregador', nullable: true }, { name: 'theme', label: 'Tema', nullable: true },
    { name: 'visitorsCount', label: 'Visitantes', type: 'number' }, { name: 'conversionsCount', label: 'Conversões', type: 'number' },
    { name: 'status', label: 'Situação', type: 'select', required: true, options: [['AGENDADO', 'Agendado'], ['REALIZADO', 'Realizado'], ['CANCELADO', 'Cancelado']] },
    { name: 'allowRegistration', label: 'Inscrições online', type: 'checkbox' }, { name: 'priceCents', label: 'Valor da inscrição (R$)', type: 'money' }, { name: 'capacity', label: 'Vagas', type: 'number', nullable: true },
  ];
  actions.newEvent = guard(async () => formModal({ title: 'Novo evento', fields: await eventFields(), values: {}, onSubmit: async (b) => { await api('/events', { method: 'POST', body: b }); load(); } }));
  actions.editEvent = guard(async (el) => { const ev = actions.items.find((e) => e.id == el.dataset.id); formModal({ title: 'Editar evento', fields: await eventFields(), values: ev, onSubmit: async (b) => { await api('/events/' + ev.id, { method: 'PUT', body: b }); load(); } }); });
  actions.weekly = guard(async () => formModal({ title: 'Gerar cultos semanais', fields: [
    { name: 'churchId', label: 'Igreja', type: 'select', options: await churchOpts(), num: true, required: true, default: me.churchId }, { name: 'title', label: 'Título', required: true, default: 'Culto' },
    { name: 'weekdays', label: 'Dias da semana (0=dom ... 6=sáb, separados por vírgula)', required: true }, { name: 'time', label: 'Horário', type: 'time', required: true },
    { name: 'from', label: 'De', type: 'date', required: true }, { name: 'to', label: 'Até', type: 'date', required: true }], values: {},
    onSubmit: async (b) => { b.weekdays = String(b.weekdays).split(',').map((x) => Number(x.trim())); const r = await api('/events/generate-weekly', { method: 'POST', body: b }); toast(`${r.created} criados, ${r.skipped} já existiam`); load(); } }));
  actions.attendance = guard(async (el) => {
    const id = el.dataset.id;
    const [members, present] = await Promise.all([api('/members?pageSize=200&status=ATIVO'), api(`/events/${id}/attendance`)]);
    const have = new Set(present.map((p) => p.memberId));
    openModal(`<h3>Chamada</h3><div class="check-list">${members.items.map((m) => `<label class="check"><input type="checkbox" value="${m.id}" ${have.has(m.id) ? 'checked disabled' : ''}> ${esc(m.fullName)}</label>`).join('')}</div><div class="modal-actions"><button class="btn" data-act="closeModal">Fechar</button><button class="btn primary" id="saveAtt">Registrar presenças</button></div>`);
    $('#saveAtt').onclick = guard(async () => {
      const ids = [...$('#modalBody').querySelectorAll('input:checked:not(:disabled)')].map((i) => Number(i.value));
      if (!ids.length) return toast('Selecione ao menos um membro');
      const r = await api(`/events/${id}/attendance`, { method: 'POST', body: { memberIds: ids } });
      toast(`${r.added} presença(s) registrada(s)`); closeModal(); load();
    });
  });
} };

const memberFields = async () => [
  { name: 'churchId', label: 'Igreja', type: 'select', options: await churchOpts(), num: true, required: true, default: me.churchId },
  { name: 'fullName', label: 'Nome completo', required: true }, { name: 'gender', label: 'Sexo', type: 'select', options: [['M', 'Masculino'], ['F', 'Feminino']], nullable: true },
  { name: 'birthDate', label: 'Nascimento', type: 'date', nullable: true }, { name: 'phone', label: 'WhatsApp (com DDD)', nullable: true }, { name: 'email', label: 'E-mail', type: 'email', nullable: true },
  { name: 'cpf', label: 'CPF', nullable: true }, { name: 'maritalStatus', label: 'Estado civil', nullable: true }, { name: 'profession', label: 'Profissão', nullable: true }, { name: 'employer', label: 'Local de trabalho', nullable: true },
  { name: 'address', label: 'Endereço', nullable: true }, { name: 'city', label: 'Cidade', nullable: true }, { name: 'state', label: 'UF', nullable: true },
  { name: 'status', label: 'Situação', type: 'select', required: true, options: ['ATIVO', 'VISITANTE', 'INATIVO', 'AFASTADO', 'TRANSFERIDO'].map((s) => [s, lbl(s) === s ? s[0] + s.slice(1).toLowerCase() : lbl(s)]) },
  { name: 'roleId', label: 'Cargo ministerial', type: 'select', num: true, nullable: true, options: (await api('/users/roles')).map((r) => [r.id, r.name]) },
  { name: 'discipulatorId', label: 'Discipulador', type: 'select', num: true, nullable: true, options: await memberOpts() },
  { name: 'conversionDate', label: 'Data de conversão', type: 'date', nullable: true }, { name: 'baptismDate', label: 'Data de batismo', type: 'date', nullable: true },
  { name: 'membershipDate', label: 'Entrada na igreja', type: 'date', nullable: true }, { name: 'leadershipSchoolDate', label: 'Formatura Escola de Líderes', type: 'date', nullable: true },
  { name: 'receiveBirthdayMsg', label: 'Aceita mensagem de aniversário', type: 'checkbox', default: true }, { name: 'notes', label: 'Observações', type: 'textarea', nullable: true },
];

pages.members = { title: 'Membros e Discipulado', perm: 'members:read', async render(v) {
  let q = '';
  const load = async () => {
    const { items, total } = await api(`/members?pageSize=100&q=${encodeURIComponent(q)}`);
    $('#list').innerHTML = `<p class="muted">${total} membro(s)</p>` + table([
      { h: 'Nome', v: (m) => m.fullName }, { h: 'Cargo', v: (m) => m.role?.name || '—' }, { h: 'Situação', html: (m) => badge(m.status) }, { h: 'Profissão', v: (m) => m.profession || '—' },
      { h: 'Conversão', v: (m) => fDate(m.conversionDate) }, { h: 'Batismo', v: (m) => fDate(m.baptismDate) }, { h: 'Discipulador', v: (m) => m.discipulator?.fullName || '—' },
      { h: '', html: (m) => `<button class="btn small" data-act="journey" data-id="${m.id}">Jornada</button> ${has('members:write') ? `<button class="btn small" data-act="editMember" data-id="${m.id}">Editar</button>` : ''}` },
    ], items);
    actions.items = items;
  };
  v.innerHTML = `<div class="toolbar"><input id="q" placeholder="Buscar nome, e-mail, telefone, profissão"><button class="btn" data-act="tree">🌳 Árvore de discipulado</button><span class="grow"></span>${has('members:write') ? '<button class="btn primary" data-act="newMember">+ Novo membro</button>' : ''}</div><div class="card" id="list"></div>`;
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; load(); }, 300); };
  await load();
  actions.newMember = guard(async () => formModal({ title: 'Novo membro', fields: await memberFields(), values: {}, onSubmit: async (b) => { await api('/members', { method: 'POST', body: b }); load(); } }));
  actions.editMember = guard(async (el) => { const m = actions.items.find((x) => x.id == el.dataset.id); formModal({ title: 'Editar membro', fields: await memberFields(), values: m, onSubmit: async (b) => { await api('/members/' + m.id, { method: 'PUT', body: b }); load(); } }); });
  actions.tree = guard(async () => {
    const roots = await api('/members/tree/all');
    const node = (n) => `<li><b>${esc(n.name)}</b> <small class="muted">${esc(n.role || '')}</small>${n.disciples.length ? `<ul class="tree">${n.disciples.map(node).join('')}</ul>` : ''}</li>`;
    openModal(`<h3>Árvore de discipulado</h3><ul class="tree">${roots.map(node).join('') || '<li class="muted">Sem dados</li>'}</ul><div class="modal-actions"><button class="btn" data-act="closeModal">Fechar</button></div>`);
  });
  actions.journey = guard(async (el) => {
    const id = el.dataset.id;
    const m = await api(`/members/${id}/journey`);
    openModal(`<h3>${esc(m.fullName)}</h3>
      <div class="grid">${stat(fDate(m.conversionDate), 'Aceitou a Jesus')}${stat(fDate(m.baptismDate), 'Batismo')}${stat(fDate(m.leadershipSchoolDate), 'Escola de Líderes')}${stat(m._count.attendances, 'Presenças em cultos')}</div>
      <p><b>Discipulador:</b> ${esc(m.discipulator?.fullName || '—')} · <b>Discípulos:</b> ${m.disciples.map((d) => esc(d.fullName)).join(', ') || '—'}</p>
      <p><b>Células:</b> ${m.cellMemberships.map((c) => esc(c.cell.name)).join(', ') || '—'}</p>
      <h4>Histórico de discipulado ${has('members:write') ? '<button class="btn small" data-act="addRecord" data-id="' + id + '">+</button>' : ''}</h4>${table([{ h: 'Data', v: (r) => fDate(r.date) }, { h: 'Tipo', v: (r) => r.type }, { h: 'Título', v: (r) => r.title }], m.discipleshipRecords)}
      <h4>Conquistas espirituais ${has('members:write') ? '<button class="btn small" data-act="addAch" data-id="' + id + '">+</button>' : ''}</h4>${table([{ h: 'Data', v: (r) => fDate(r.date) }, { h: 'Conquista', v: (r) => r.title }], m.achievements)}
      <div class="modal-actions"><button class="btn" data-act="closeModal">Fechar</button></div>`);
  });
  actions.addRecord = (el) => formModal({ title: 'Registro de discipulado', fields: [{ name: 'date', label: 'Data', type: 'date', required: true }, { name: 'type', label: 'Tipo', type: 'select', required: true, options: ['ENCONTRO', 'CURSO', 'MENTORIA', 'ACONSELHAMENTO', 'ETAPA'].map((x) => [x, x]) }, { name: 'title', label: 'Título', required: true }, { name: 'notes', label: 'Notas', type: 'textarea', nullable: true }], values: {}, onSubmit: (b) => api(`/members/${el.dataset.id}/discipleship`, { method: 'POST', body: b }) });
  actions.addAch = (el) => formModal({ title: 'Conquista espiritual', fields: [{ name: 'date', label: 'Data', type: 'date', required: true }, { name: 'title', label: 'Conquista', required: true }, { name: 'description', label: 'Descrição', type: 'textarea', nullable: true }], values: {}, onSubmit: (b) => api(`/members/${el.dataset.id}/achievements`, { method: 'POST', body: b }) });
} };

pages.cells = { title: 'Células', perm: 'cells:read', async render(v) {
  const load = async () => {
    const { items } = await api('/cells?pageSize=100');
    $('#list').innerHTML = table([
      { h: 'Célula', v: (c) => c.name }, { h: 'Líder', v: (c) => c.leader?.fullName || '—' }, { h: 'Dia/Hora', v: (c) => (c.weekday != null ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][c.weekday] : '—') + ' ' + (c.time || '') },
      { h: 'Situação', html: (c) => badge(c.status) }, { h: 'Membros', num: 1, v: (c) => c._count.members }, { h: 'Reuniões', num: 1, v: (c) => c._count.meetings },
      { h: '', html: (c) => `<button class="btn small" data-act="cellStats" data-id="${c.id}">Crescimento</button> ${has('cells:write') ? `<button class="btn small" data-act="meeting" data-id="${c.id}">Reunião</button> <button class="btn small" data-act="addCellMember" data-id="${c.id}">+ Participante</button>` : ''}` },
    ], items);
  };
  v.innerHTML = `<div class="toolbar"><span class="grow"></span>${has('cells:write') ? '<button class="btn primary" data-act="newCell">+ Nova célula</button>' : ''}</div><div class="card" id="list"></div>`;
  await load();
  actions.newCell = guard(async () => formModal({ title: 'Nova célula', fields: [
    { name: 'churchId', label: 'Igreja', type: 'select', options: await churchOpts(), num: true, required: true, default: me.churchId }, { name: 'name', label: 'Nome', required: true },
    { name: 'leaderId', label: 'Líder', type: 'select', num: true, nullable: true, options: await memberOpts() }, { name: 'weekday', label: 'Dia (0=dom..6=sáb)', type: 'number', nullable: true }, { name: 'time', label: 'Horário (HH:MM)', nullable: true },
    { name: 'neighborhood', label: 'Bairro', nullable: true }, { name: 'address', label: 'Endereço', nullable: true }, { name: 'startedAt', label: 'Início', type: 'date', nullable: true }], values: {},
    onSubmit: async (b) => { await api('/cells', { method: 'POST', body: b }); load(); } }));
  actions.addCellMember = guard(async (el) => formModal({ title: 'Adicionar participante', fields: [{ name: 'memberId', label: 'Membro', type: 'select', num: true, required: true, options: await memberOpts() }], values: {}, onSubmit: async (b) => { await api(`/cells/${el.dataset.id}/members`, { method: 'POST', body: b }); load(); } }));
  actions.meeting = guard(async (el) => {
    const id = el.dataset.id;
    const parts = await api(`/cells/${id}/members`);
    openModal(`<h3>Registrar reunião</h3><form id="mf"><div class="form-grid"><label>Data<input type="date" name="date" required></label><label>Tema<input name="topic"></label><label>Visitantes<input type="number" min="0" name="visitors" value="0"></label><label>Conversões<input type="number" min="0" name="conversions" value="0"></label><label>Oferta (R$)<input type="number" step="0.01" min="0" name="offering" value="0"></label></div><b>Presença</b><div class="check-list">${parts.map((p) => `<label class="check"><input type="checkbox" data-m="${p.memberId}" checked> ${esc(p.member.fullName)}</label>`).join('') || '<span class="muted">Sem participantes cadastrados</span>'}</div><p class="error" id="mfErr"></p><div class="modal-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
    $('#mf').onsubmit = async (e) => { e.preventDefault(); const f = e.target.elements;
      try { await api(`/cells/${id}/meetings`, { method: 'POST', body: { date: f.date.value, topic: f.topic.value || null, visitors: +f.visitors.value, conversions: +f.conversions.value, offeringCents: Math.round(f.offering.value * 100), attendance: [...e.target.querySelectorAll('[data-m]')].map((i) => ({ memberId: +i.dataset.m, present: i.checked })) } }); closeModal(); toast('Reunião registrada'); load(); } catch (err) { $('#mfErr').textContent = err.message; } };
  });
  actions.cellStats = guard(async (el) => {
    const s = await api(`/cells/${el.dataset.id}/stats`);
    openModal(`<h3>Crescimento e frequência</h3><div class="grid">${stat(s.activeMembers, 'Participantes ativos')}${stat(s.meetings, 'Reuniões')}${stat(s.averageAttendance, 'Média de presentes')}${stat(s.totalConversions, 'Conversões')}</div>${bars(s.series.map((x) => ({ ...x, d: fDate(x.date) })), 'total', 'd')}<div class="modal-actions"><button class="btn" data-act="closeModal">Fechar</button></div>`);
  });
} };

pages.finance = { title: 'Financeiro e Tesouraria', perm: 'finance:read', async render(v) {
  const [cats, accounts] = await Promise.all([api('/finance/categories'), api('/finance/accounts')]);
  const f = { category: '', from: '', to: '' };
  const load = async () => {
    const q = new URLSearchParams({ pageSize: 100, ...(f.category && { category: f.category }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }) });
    const r = await api('/finance/transactions?' + q);
    $('#sum').innerHTML = stat(money(r.totals.entradaCents), 'Entradas') + stat(money(r.totals.saidaCents), 'Saídas') + stat(money(r.totals.saldoCents), 'Saldo do filtro');
    $('#list').innerHTML = table([
      { h: 'Data', v: (t) => fDate(t.date) }, { h: 'Tipo', html: (t) => (t.direction === 'ENTRADA' ? '<span class="badge ok">Entrada</span>' : '<span class="badge bad">Saída</span>') }, { h: 'Categoria', v: (t) => lbl(t.category) },
      { h: 'Origem', v: (t) => t.member?.fullName || t.donorName || t.event?.title || '—' }, { h: 'Caixa', v: (t) => t.cashAccount.name }, { h: 'Valor', num: 1, v: (t) => money(t.amountCents) },
      { h: '', html: (t) => (has('finance:delete') && !t.registrationId ? `<button class="btn small danger" data-act="delTx" data-id="${t.id}">Excluir</button>` : '') },
    ], r.items);
  };
  v.innerHTML = `<div class="grid">${accounts.map((a) => stat(money(a.balanceCents), 'Saldo: ' + a.name)).join('')}</div><div class="grid" id="sum"></div>
  <div class="toolbar"><select id="fCat"><option value="">Todas as categorias</option>${[...cats.entrada, ...cats.saida].map((c) => `<option value="${c}">${esc(lbl(c))}</option>`).join('')}</select><input type="date" id="fFrom"><input type="date" id="fTo"><span class="grow"></span>${has('finance:write') ? '<button class="btn" data-act="newAccount">+ Caixa</button><button class="btn primary" data-act="newTx">+ Lançamento</button>' : ''}</div><div class="card" id="list"></div>`;
  $('#fCat').onchange = (e) => { f.category = e.target.value; load(); };
  $('#fFrom').onchange = (e) => { f.from = e.target.value; load(); };
  $('#fTo').onchange = (e) => { f.to = e.target.value; load(); };
  await load();
  actions.newAccount = guard(async () => formModal({ title: 'Novo caixa', fields: [{ name: 'churchId', label: 'Igreja', type: 'select', options: await churchOpts(), num: true, required: true, default: me.churchId }, { name: 'name', label: 'Nome', required: true }, { name: 'openingCents', label: 'Saldo inicial (R$)', type: 'money' }], values: {}, onSubmit: async (b) => { await api('/finance/accounts', { method: 'POST', body: b }); render(); } }));
  actions.newTx = guard(async () => formModal({ title: 'Novo lançamento', fields: [
    { name: 'cashAccountId', label: 'Caixa', type: 'select', num: true, required: true, options: accounts.map((a) => [a.id, a.name]) },
    { name: 'direction', label: 'Tipo', type: 'select', required: true, options: [['ENTRADA', 'Entrada'], ['SAIDA', 'Saída']] },
    { name: 'category', label: 'Categoria', type: 'select', required: true, options: [...cats.entrada, ...cats.saida].map((c) => [c, lbl(c)]) },
    { name: 'amountCents', label: 'Valor (R$)', type: 'money', required: true }, { name: 'date', label: 'Data', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
    { name: 'method', label: 'Forma', type: 'select', required: true, options: ['DINHEIRO', 'PIX', 'CARTAO', 'TRANSFERENCIA', 'BOLETO'].map((x) => [x, x]) },
    { name: 'memberId', label: 'Membro (dizimista/ofertante)', type: 'select', num: true, nullable: true, options: await memberOpts() }, { name: 'donorName', label: 'Ofertante externo', nullable: true }, { name: 'description', label: 'Descrição', nullable: true }], values: { date: new Date() },
    onSubmit: async (b) => { await api('/finance/transactions', { method: 'POST', body: b }); render(); } }));
  actions.delTx = guard(async (el) => { if (confirm('Excluir lançamento? A exclusão fica registrada na auditoria.')) { await api('/finance/transactions/' + el.dataset.id, { method: 'DELETE' }); load(); } });
  const render = () => show('finance');
} };

pages.registrations = { title: 'Inscrições em Eventos', perm: 'registrations:read', async render(v) {
  const { items: events } = await api('/events?pageSize=100&kind=');
  const open = events.filter((e) => e.allowRegistration);
  v.innerHTML = `<div class="toolbar"><select id="ev">${open.map((e) => `<option value="${e.id}">${esc(e.title)} — ${fDate(e.startsAt)}</option>`).join('') || '<option value="">Nenhum evento com inscrição online</option>'}</select><span class="live" id="live"></span><span class="grow"></span><a class="btn" href="/inscricao.html" target="_blank" rel="noopener">Abrir página pública</a></div><div class="grid" id="sum"></div><div class="card" id="list"></div>`;
  if (!open.length) return;
  const load = async () => {
    const r = await api('/registrations?eventId=' + $('#ev').value);
    $('#sum').innerHTML = stat(r.summary.total, 'Inscritos') + stat(r.summary.paid, 'Pagos') + stat(r.summary.pending, 'Aguardando pagamento') + stat(money(r.summary.receivedCents), 'Arrecadado') + stat(money(r.summary.pendingCents), 'A receber');
    $('#list').innerHTML = table([
      { h: 'Nome', v: (x) => x.name }, { h: 'Contato', v: (x) => x.phone || x.email || '—' }, { h: 'Situação', html: (x) => badge(x.status) }, { h: 'Valor', num: 1, v: (x) => money(x.amountCents) }, { h: 'Pago em', v: (x) => fDateTime(x.paidAt) }, { h: 'Check-in', v: (x) => (x.checkedIn ? '✔' : '') },
      { h: '', html: (x) => has('registrations:write') ? (x.status === 'PENDENTE' ? `<button class="btn small" data-act="pay" data-id="${x.id}">Baixar pagamento</button> <button class="btn small danger" data-act="cancelReg" data-id="${x.id}">Cancelar</button>` : (['PAGO', 'ISENTO'].includes(x.status) && !x.checkedIn ? `<button class="btn small" data-act="checkin" data-id="${x.id}">Check-in</button>` : '')) : '' },
    ], r.items);
  };
  // Atualização quase em tempo real por polling (serverless não mantém conexões abertas).
  const timer = setInterval(() => { if (!document.hidden) load().then(() => { $('#live').textContent = '● atualiza a cada 5s'; }).catch(() => {}); }, 5000);
  cleanup = () => clearInterval(timer);
  $('#ev').onchange = () => load();
  await load();
  actions.pay = guard(async (el) => { if (confirm('Confirmar recebimento manual deste pagamento?')) { await api(`/registrations/${el.dataset.id}/pay`, { method: 'POST' }); load(); } });
  actions.cancelReg = guard(async (el) => { if (confirm('Cancelar inscrição?')) { await api(`/registrations/${el.dataset.id}/cancel`, { method: 'POST' }); load(); } });
  actions.checkin = guard(async (el) => { await api(`/registrations/${el.dataset.id}/checkin`, { method: 'POST' }); load(); });
} };

pages.reports = { title: 'Relatórios e Estatísticas', perm: 'reports:read', async render(v) {
  const tabs = [['attendance', 'Frequência nos cultos'], ['members', 'Presentes e ausentes'], ['growth', 'Crescimento'], ['finance', 'Finanças'], ['departments', 'Departamentos']];
  v.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button class="btn" data-act="tab" data-k="${k}">${t}</button>`).join('')}</div><div id="rep"></div>`;
  const R = {
    async attendance(el) { const r = await api('/reports/attendance/events'); el.innerHTML = `<div class="grid">${stat(r.averageAttendance, 'Média por culto (membros + visitantes)')}${stat(r.totalConversions, 'Conversões nos cultos')}</div><div class="card">${bars(r.events.map((e) => ({ ...e, l: fDate(e.startsAt) })), 'total', 'l')}</div>`; },
    async members(el) { const r = await api('/reports/attendance/members'); el.innerHTML = `<div class="grid">${stat(r.summary.frequent, 'Frequentes (≥50%)')}${stat(r.summary.irregular, 'Irregulares')}${stat(r.summary.absent, 'Ausentes no período')}${stat(r.totalEvents, 'Cultos no período (90 dias)')}</div><div class="card">${table([{ h: 'Membro', v: (m) => m.fullName }, { h: 'Cargo', v: (m) => m.role || '—' }, { h: 'Presenças', num: 1, v: (m) => m.presences }, { h: 'Frequência', num: 1, v: (m) => m.rate + '%' }, { h: 'Última presença', v: (m) => fDateTime(m.lastAttendance) }, { h: 'Situação', html: (m) => badge(m.situation) }, { h: 'Contato', v: (m) => m.phone || '—' }], r.members)}</div>`; },
    async growth(el) { const r = await api('/reports/growth'); el.innerHTML = `<div class="grid">${stat(r.totals.newMembers, 'Novos membros ' + r.year)}${stat(r.totals.conversions, 'Conversões')}${stat(r.totals.baptisms, 'Batismos')}${stat(r.totals.leadershipGraduates, 'Formados na Escola de Líderes')}</div><div class="card"><h3>Conversões por mês</h3>${bars(r.months, 'conversions', 'month')}<h3>Novos membros por mês</h3>${bars(r.months, 'newMembers', 'month')}<h3>Batismos por mês</h3>${bars(r.months, 'baptisms', 'month')}</div><div class="card"><h3>Expansão (igrejas por situação)</h3>${table([{ h: 'Situação', v: (x) => x.status }, { h: 'Qtd', num: 1, v: (x) => x.count }], r.expansion)}</div>`; },
    async finance(el) { const r = await api('/reports/finance'); el.innerHTML = `<div class="grid">${stat(money(r.totals.entradaCents), 'Entradas (90 dias)')}${stat(money(r.totals.saidaCents), 'Saídas')}${stat(money(r.totals.saldoCents), 'Saldo')}</div><div class="card"><h3>Entradas por categoria</h3>${bars(r.byCategory.filter((c) => c.direction === 'ENTRADA').map((c) => ({ ...c, l: lbl(c.category) })), 'totalCents', 'l', money)}<h3>Saídas por categoria</h3>${bars(r.byCategory.filter((c) => c.direction === 'SAIDA').map((c) => ({ ...c, l: lbl(c.category) })), 'totalCents', 'l', money, 'out')}</div><div class="card"><h3>Por mês</h3>${table([{ h: 'Mês', v: (m) => m.month }, { h: 'Entradas', num: 1, v: (m) => money(m.entradaCents) }, { h: 'Saídas', num: 1, v: (m) => money(m.saidaCents) }], r.byMonth)}</div><div class="card"><h3>Por igreja</h3>${table([{ h: 'Igreja', v: (m) => m.church }, { h: 'Entradas', num: 1, v: (m) => money(m.entradaCents) }, { h: 'Saídas', num: 1, v: (m) => money(m.saidaCents) }], r.byChurch)}</div>`; },
    async departments(el) { const r = await api('/reports/departments'); el.innerHTML = `<div class="card">${table([{ h: 'Departamento / cargo', v: (d) => d.role }, { h: 'Membros', num: 1, v: (d) => d.members }, { h: 'Frequência nos cultos', num: 1, v: (d) => d.attendanceRate + '%' }, { h: 'Discípulos', num: 1, v: (d) => d.disciples }, { h: 'Células lideradas', num: 1, v: (d) => d.cellsLed }], r.departments)}<p class="muted">Período: últimos 90 dias · ${r.cultosNoPeriodo} culto(s)</p></div>`; },
  };
  actions.tab = guard(async (el) => { document.querySelectorAll('.tabs .btn').forEach((b) => b.classList.toggle('active', b === el)); await R[el.dataset.k]($('#rep')); });
  actions.tab($('.tabs .btn'));
} };

pages.messages = { title: 'Aniversariantes e Mensagens', perm: 'messages:read', async render(v) {
  const [today, month, tpl, log] = await Promise.all([api('/messages/birthdays/today'), api('/messages/birthdays/month'), api('/messages/template'), api('/messages/log')]);
  v.innerHTML = `<div class="card"><h3>Mensagem automática de aniversário (WhatsApp)</h3><p class="muted">Enviada todos os dias no horário configurado. Variáveis: {nome} e {igreja}.</p><textarea id="tpl" rows="4" ${has('messages:write') ? '' : 'disabled'}>${esc(tpl.template)}</textarea><div class="toolbar" style="margin-top:8px">${has('messages:write') ? '<button class="btn primary" data-act="saveTpl">Salvar mensagem</button><button class="btn" data-act="runDry">Simular envio de hoje</button><button class="btn danger" data-act="runReal">Enviar agora</button>' : ''}</div></div>
  <div class="card"><h3>🎂 Hoje (${today.length})</h3>${table([{ h: 'Nome', v: (m) => m.fullName }, { h: 'Igreja', v: (m) => m.church }, { h: 'WhatsApp', v: (m) => m.phone || '—' }, { h: 'Aceita msg', v: (m) => (m.receiveBirthdayMsg ? 'Sim' : 'Não') }], today)}</div>
  <div class="card"><h3>Aniversariantes do mês</h3>${table([{ h: 'Dia', v: (m) => String(new Date(m.birthDate).getUTCDate()).padStart(2, '0') }, { h: 'Nome', v: (m) => m.fullName }], month)}</div>
  <div class="card"><h3>Histórico de envios</h3>${table([{ h: 'Data', v: (l) => fDateTime(l.createdAt) }, { h: 'Membro', v: (l) => l.member?.fullName || '—' }, { h: 'Status', html: (l) => `<span class="badge ${l.status === 'ENVIADA' ? 'ok' : 'bad'}">${esc(l.status)}</span>` }, { h: 'Erro', v: (l) => l.error || '' }], log)}</div>`;
  actions.saveTpl = guard(async () => { await api('/messages/template', { method: 'PUT', body: { template: $('#tpl').value } }); toast('Mensagem salva'); });
  actions.runDry = guard(async () => { const r = await api('/messages/birthdays/run?dryRun=true', { method: 'POST' }); toast(`Simulação: ${r.found} aniversariante(s), ${r.skipped} ignorado(s)`); });
  actions.runReal = guard(async () => { if (confirm('Enviar agora as mensagens de aniversário de hoje?')) { const r = await api('/messages/birthdays/run?dryRun=false', { method: 'POST' }); toast(`${r.sent} enviada(s), ${r.failed} falha(s)`); show('messages'); } });
} };

pages.churches = { title: 'Igrejas e Filiais', perm: 'churches:read', async render(v) {
  const load = async () => {
    const { items } = await api('/churches?pageSize=200');
    $('#list').innerHTML = table([{ h: 'Igreja', v: (c) => c.name }, { h: 'Tipo', v: (c) => c.type }, { h: 'Situação', v: (c) => c.status }, { h: 'Sede', v: (c) => c.parent?.name || '—' }, { h: 'Cidade', v: (c) => [c.city, c.state].filter(Boolean).join('/') || '—' }, { h: 'Pastor', v: (c) => c.pastor?.fullName || '—' }, { h: 'Previsão', v: (c) => fDate(c.plannedAt) }, { h: 'Membros', num: 1, v: (c) => c._count.members }, { h: 'Células', num: 1, v: (c) => c._count.cells }, { h: '', html: (c) => (has('churches:write') ? `<button class="btn small" data-act="editChurch" data-id="${c.id}">Editar</button>` : '') }], items);
    actions.items = items;
  };
  v.innerHTML = `<div class="toolbar"><span class="grow"></span>${has('churches:write') ? '<button class="btn primary" data-act="newChurch">+ Nova igreja/filial</button>' : ''}</div><div class="card" id="list"></div>`;
  await load();
  const fields = async () => [{ name: 'name', label: 'Nome', required: true }, { name: 'type', label: 'Tipo', type: 'select', required: true, options: [['FILIAL', 'Filial'], ['CONGREGACAO', 'Congregação'], ['PONTO_DE_PREGACAO', 'Ponto de pregação'], ['MATRIZ', 'Matriz']] }, { name: 'status', label: 'Situação', type: 'select', required: true, options: [['ATIVA', 'Ativa'], ['PLANEJADA', 'Planejada'], ['EM_IMPLANTACAO', 'Em implantação'], ['INATIVA', 'Inativa']] }, { name: 'parentId', label: 'Igreja-mãe', type: 'select', num: true, nullable: true, options: await churchOpts() }, { name: 'pastorId', label: 'Pastor responsável', type: 'select', num: true, nullable: true, options: await memberOpts() }, { name: 'city', label: 'Cidade', nullable: true }, { name: 'state', label: 'UF', nullable: true }, { name: 'address', label: 'Endereço', nullable: true }, { name: 'foundedAt', label: 'Fundação', type: 'date', nullable: true }, { name: 'plannedAt', label: 'Previsão de abertura', type: 'date', nullable: true }, { name: 'notes', label: 'Observações', type: 'textarea', nullable: true }];
  actions.newChurch = guard(async () => formModal({ title: 'Nova igreja', fields: await fields(), values: {}, onSubmit: async (b) => { await api('/churches', { method: 'POST', body: b }); load(); } }));
  actions.editChurch = guard(async (el) => { const c = actions.items.find((x) => x.id == el.dataset.id); formModal({ title: 'Editar igreja', fields: await fields(), values: c, onSubmit: async (b) => { await api('/churches/' + c.id, { method: 'PUT', body: b }); load(); } }); });
} };

pages.users = { title: 'Usuários e Permissões', perm: 'users:read', async render(v) {
  const [users, roles] = await Promise.all([api('/users'), api('/users/roles')]);
  v.innerHTML = `<div class="toolbar"><span class="grow"></span>${has('users:write') ? '<button class="btn primary" data-act="newUser">+ Novo usuário</button>' : ''}</div><div class="card">${table([{ h: 'Nome', v: (u) => u.name }, { h: 'E-mail', v: (u) => u.email }, { h: 'Cargo', v: (u) => u.role.name }, { h: 'Ativo', html: (u) => badge(u.active ? 'ATIVO' : 'INATIVO') }, { h: 'Último acesso', v: (u) => fDateTime(u.lastLoginAt) }, { h: '', html: (u) => (has('users:write') ? `<button class="btn small" data-act="toggleUser" data-id="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Ativar'}</button>` : '') }], users)}</div>
  <div class="card"><h3>Cargos e permissões</h3>${table([{ h: 'Cargo', v: (r) => r.name }, { h: 'Nível', num: 1, v: (r) => r.level }, { h: 'Todas as igrejas', v: (r) => (r.allChurches ? 'Sim' : 'Não') }, { h: 'Permissões', html: (r) => `<small class="muted">${esc(r.permissions.map((p) => p.permission).join(', '))}</small>` }].map((c) => ({ ...c })), roles).replace(/<td>(<small)/g, '<td class="wrap">$1')}</div>`;
  actions.newUser = guard(async () => formModal({ title: 'Novo usuário', fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true }, { name: 'password', label: 'Senha provisória (mín. 8, letras e números)', type: 'password', required: true }, { name: 'roleId', label: 'Cargo', type: 'select', num: true, required: true, options: roles.map((r) => [r.id, r.name]) }, { name: 'churchId', label: 'Igreja', type: 'select', num: true, required: true, options: await churchOpts(), default: me.churchId }], values: {}, onSubmit: async (b) => { await api('/users', { method: 'POST', body: b }); show('users'); } }));
  actions.toggleUser = guard(async (el) => { await api('/users/' + el.dataset.id, { method: 'PUT', body: { active: el.dataset.active !== 'true' } }); show('users'); });
} };

pages.visits = { title: 'Visitantes (QR code)', perm: 'members:read', async render(v) {
  const FU = [['NOVO', 'Novo'], ['CONTATADO', 'Contatado'], ['AGENDADO', 'Visita agendada'], ['INTEGRADO', 'Integrado'], ['SEM_RETORNO', 'Sem retorno']];
  const fuBadge = (s) => `<span class="badge ${{ NOVO: 'warn', CONTATADO: '', AGENDADO: '', INTEGRADO: 'ok', SEM_RETORNO: 'bad' }[s] || ''}">${esc((FU.find((x) => x[0] === s) || [0, s])[1])}</span>`;
  let status = '';
  const load = async () => {
    const r = await api('/visits?pageSize=100' + (status ? '&status=' + status : ''));
    $('#sum').innerHTML = FU.map(([k, t]) => stat(r.summary[k] || 0, t)).join('');
    actions.items = r.items;
    $('#list').innerHTML = table([
      { h: 'Data', v: (x) => fDateTime(x.createdAt) }, { h: 'Visitante', html: (x) => `<b>${esc(x.member.fullName)}</b>${x.isFirstVisit ? ' <span class="badge ok">1ª visita</span>' : ' <span class="badge">retorno</span>'}` },
      { h: 'WhatsApp', html: (x) => (x.member.phone ? `<a href="https://wa.me/${esc(x.member.phone.length <= 11 ? '55' + x.member.phone : x.member.phone)}" target="_blank" rel="noopener">${esc(x.member.phone)}</a>` : '—') },
      { h: 'Culto', v: (x) => x.event?.title || '—' }, { h: 'Como conheceu', v: (x) => x.howKnew || '—' },
      { h: 'Oração', html: (x) => `<span title="${esc(x.prayerRequest || '')}">${esc((x.prayerRequest || '—').slice(0, 40))}${(x.prayerRequest || '').length > 40 ? '…' : ''}</span>` },
      { h: 'Quer contato', v: (x) => (x.wantsContact ? 'Sim' : 'Não') }, { h: 'Acompanhamento', html: (x) => fuBadge(x.followUpStatus) },
      { h: '', html: (x) => (has('members:write') ? `<button class="btn small" data-act="followUp" data-id="${x.id}">Acompanhar</button>` : '') },
    ], r.items, 'Nenhuma visita registrada ainda. Imprima o QR code e deixe na entrada da igreja.');
  };
  v.innerHTML = `<div class="toolbar"><select id="fSt"><option value="">Todos os status</option>${FU.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><span class="grow"></span><button class="btn primary" data-act="qr">📱 QR code de visitantes</button></div><div class="grid" id="sum"></div><div class="card" id="list"></div>`;
  $('#fSt').onchange = (e) => { status = e.target.value; load(); };
  await load();
  actions.followUp = guard(async (el) => {
    const x = actions.items.find((i) => i.id == el.dataset.id);
    formModal({ title: 'Acompanhamento: ' + x.member.fullName, fields: [
      { name: 'followUpStatus', label: 'Situação', type: 'select', required: true, options: FU },
      { name: 'followUpNotes', label: 'Anotações do contato', type: 'textarea', nullable: true }], values: x,
    onSubmit: async (b) => { await api('/visits/' + x.id, { method: 'PUT', body: b }); load(); } });
  });
  actions.qr = guard(async () => {
    const churches = (await api('/churches?pageSize=200')).items;
    const show = async (id) => {
      const q = await api('/visits/qr?churchId=' + id);
      $('#qrBox').innerHTML = `<div class="poster" style="text-align:center"><h2>${esc(q.church)}</h2><p style="font-size:20px"><b>Seja bem-vindo(a)!</b><br>Escaneie e registre sua visita</p><div style="width:min(300px,70vw);margin:0 auto">${q.svg}</div><p class="muted" style="word-break:break-all">${esc(q.url)}</p></div>`;
    };
    openModal(`<div class="no-print"><h3>QR code de visitantes</h3><label>Igreja<select id="qrChurch">${churches.map((c) => `<option value="${c.id}" ${c.id === me.churchId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div><div id="qrBox"></div><div class="modal-actions no-print"><button class="btn danger" id="qrRotate">Gerar novo QR (invalida o atual)</button><button class="btn" data-act="closeModal">Fechar</button><button class="btn primary" id="qrPrint">🖨 Imprimir cartaz</button></div>`);
    await show($('#qrChurch').value);
    $('#qrChurch').onchange = guard((e) => show(e.target.value));
    $('#qrPrint').onclick = () => window.print();
    $('#qrRotate').onclick = guard(async () => { if (confirm('O QR impresso atual deixará de funcionar. Continuar?')) { await api('/visits/qr/rotate', { method: 'POST', body: { churchId: Number($('#qrChurch').value) } }); await show($('#qrChurch').value); toast('Novo QR gerado: reimprima o cartaz'); } });
  });
} };

// ───────────── Navegação / sessão ─────────────
const NAV = [['dashboard', '📊 Painel'], ['agenda', '📅 Cultos e Agenda'], ['members', '👥 Membros'], ['visits', '🙋 Visitantes'], ['cells', '🏠 Células'], ['finance', '💰 Financeiro'], ['registrations', '🎟 Inscrições'], ['reports', '📈 Relatórios'], ['messages', '🎂 Aniversariantes'], ['churches', '⛪ Igrejas'], ['users', '🔐 Usuários']];

async function show(name) {
  const page = pages[name] && (!pages[name].perm || has(pages[name].perm)) ? pages[name] : pages.dashboard;
  if (cleanup) { cleanup(); cleanup = null; }
  actions = {};
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  $('#title').textContent = page.title;
  $('.sidebar').classList.remove('open');
  const v = $('#view');
  v.innerHTML = '<p class="muted">Carregando…</p>';
  try { await page.render(v); } catch (e) { v.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

function route() { show(location.hash.slice(1) || 'dashboard'); }

async function start() {
  if (!token) return showLogin();
  try { me = await api('/auth/me'); } catch { return showLogin(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userName').textContent = me.name; $('#userRole').textContent = me.roleName;
  $('#nav').innerHTML = NAV.filter(([k]) => !pages[k].perm || has(pages[k].perm)).map(([k, t]) => `<a href="#${k}" data-page="${k}">${t}</a>`).join('');
  route();
}
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function logout() { sessionStorage.removeItem('token'); token = null; me = null; showLogin(); }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'closeModal') return closeModal();
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});
window.addEventListener('hashchange', () => me && route());
$('#logout').onclick = logout;
$('#chpw').onclick = () => formModal({ title: 'Trocar senha', fields: [{ name: 'current', label: 'Senha atual', type: 'password', required: true }, { name: 'next', label: 'Nova senha (mín. 8, letras e números)', type: 'password', required: true }], values: {}, onSubmit: (b) => api('/auth/change-password', { method: 'POST', body: b }) });
$('#menuBtn').onclick = () => $('.sidebar').classList.toggle('open');
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const f = e.target.elements;
    const r = await api('/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    token = r.token; sessionStorage.setItem('token', token);
    f.password.value = '';
    await start();
    if (r.user.mustChangePw) setTimeout(() => toast('Troque sua senha provisória em "Trocar senha"'), 500);
  } catch (err) { $('#loginError').textContent = err.message; }
};
start();
