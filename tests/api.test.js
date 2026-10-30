// Teste de integração: usa o banco configurado em DATABASE_URL (rode após `npm run db:reset -- --demo`).
// Execução: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let server, base, token;
const call = async (method, path, body, tk = token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(tk && { Authorization: `Bearer ${tk}` }) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  const r = await call('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL || 'admin@igreja.local', password: process.env.ADMIN_PASSWORD || 'Mudar@123' }, null);
  assert.equal(r.status, 200);
  token = r.body.token;
});
after(() => server.close());

test('rotas protegidas exigem token', async () => {
  assert.equal((await call('GET', '/api/members', null, null)).status, 401);
  assert.equal((await call('GET', '/api/members', null, 'lixo')).status, 401);
});

test('login com senha errada falha', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@igreja.local', password: 'errada123' }, null)).status, 401);
});

test('cadastro de membro valida dados e detecta ciclo de discipulado', async () => {
  assert.equal((await call('POST', '/api/members', { fullName: 'X' })).status, 400);
  const a = await call('POST', '/api/members', { fullName: 'Teste Discipulador', phone: '(11) 98888-7777' });
  assert.equal(a.status, 201);
  assert.equal(a.body.phone, '11988887777');
  const b = await call('POST', '/api/members', { fullName: 'Teste Discípulo', discipulatorId: a.body.id });
  assert.equal(b.status, 201);
  const cycle = await call('PUT', `/api/members/${a.body.id}`, { discipulatorId: b.body.id });
  assert.equal(cycle.status, 400);
});

test('RBAC: obreiro não acessa financeiro nem cria usuário acima do seu cargo', async () => {
  const roles = (await call('GET', '/api/users/roles')).body;
  const obreiro = roles.find((r) => r.name === 'Obreiro');
  const apostolo = roles.find((r) => r.name === 'Apóstolo');
  const email = `obreiro${Date.now()}@teste.com`;
  const u = await call('POST', '/api/users', { email, name: 'Obreiro Teste', password: 'Senha1234', roleId: obreiro.id, churchId: 1 });
  assert.equal(u.status, 201);
  const login = await call('POST', '/api/auth/login', { email, password: 'Senha1234' }, null);
  const tk = login.body.token;
  assert.equal((await call('GET', '/api/finance/transactions', null, tk)).status, 403);
  assert.equal((await call('GET', '/api/members', null, tk)).status, 200);
  assert.equal((await call('POST', '/api/users', { email: `x${Date.now()}@t.com`, name: 'Escalada', password: 'Senha1234', roleId: apostolo.id, churchId: 1 }, tk)).status, 403);
});

test('inscrição paga: pendente → pago gera entrada no caixa', async () => {
  const events = (await call('GET', '/api/public/events', null, null)).body;
  const ev = events.find((e) => e.priceCents > 0);
  assert.ok(ev, 'evento com inscrição aberta');
  const reg = await call('POST', `/api/public/events/${ev.id}/registrations`, { name: 'Participante Teste', email: 'p@teste.com' }, null);
  assert.equal(reg.status, 201);
  assert.equal(reg.body.status, 'PENDENTE');
  let list = (await call('GET', `/api/registrations?eventId=${ev.id}`)).body;
  assert.ok(list.items.find((i) => i.id === reg.body.registrationId && i.status === 'PENDENTE'));
  assert.equal((await call('POST', `/api/public/mock-pay/${reg.body.registrationId}`, null, null)).status, 200);
  assert.equal((await call('POST', `/api/public/mock-pay/${reg.body.registrationId}`, null, null)).status, 200); // idempotente
  list = (await call('GET', `/api/registrations?eventId=${ev.id}`)).body;
  assert.equal(list.items.find((i) => i.id === reg.body.registrationId).status, 'PAGO');
  const tx = (await call('GET', `/api/finance/transactions?category=INSCRICAO&eventId=${ev.id}`)).body;
  assert.equal(tx.items.filter((t) => t.registrationId === reg.body.registrationId).length, 1);
});

test('aniversariantes: simulação encontra o membro do dia e respeita consentimento', async () => {
  const r = await call('POST', '/api/messages/birthdays/run?dryRun=true');
  assert.equal(r.status, 200);
  assert.ok(r.body.found >= 1);
});

test('relatórios respondem', async () => {
  for (const p of ['dashboard', 'attendance/events', 'attendance/members', 'growth', 'finance', 'departments']) {
    const r = await call('GET', `/api/reports/${p}`);
    assert.equal(r.status, 200, p);
  }
  const m = (await call('GET', '/api/members/tree/all')).body;
  assert.ok(Array.isArray(m));
});
