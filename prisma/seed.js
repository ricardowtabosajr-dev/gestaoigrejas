// Uso: node prisma/seed.js [--demo]
// Cria cargos/permissões, a igreja-sede e o usuário administrador. Com --demo, inclui dados de exemplo.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { DEFAULT_ROLES, expandPerms } = require('../src/constants');

const demo = process.argv.includes('--demo');
const day = (offset) => new Date(Date.now() + offset * 86400000);

async function main() {
  for (const r of DEFAULT_ROLES) {
    const perms = expandPerms(r.perms);
    const role = await prisma.role.upsert({
      where: { name: r.name },
      create: { name: r.name, level: r.level, allChurches: !!r.allChurches, isMinistry: r.isMinistry !== false },
      update: { level: r.level, allChurches: !!r.allChurches, isMinistry: r.isMinistry !== false },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: perms.map((permission) => ({ roleId: role.id, permission })) });
  }

  let sede = await prisma.church.findFirst({ where: { type: 'MATRIZ' } });
  if (!sede) sede = await prisma.church.create({ data: { name: 'Igreja Sede', type: 'MATRIZ', foundedAt: new Date('2000-01-01') } });
  if (!(await prisma.cashAccount.findFirst({ where: { churchId: sede.id } }))) {
    await prisma.cashAccount.create({ data: { churchId: sede.id, name: 'Caixa geral' } });
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@igreja.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Mudar@123';
  const apostolo = await prisma.role.findUnique({ where: { name: 'Apóstolo' } });
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({ data: { email, name: 'Administrador', passwordHash: await bcrypt.hash(password, 12), roleId: apostolo.id, churchId: sede.id, mustChangePw: true } });
    console.log(`Usuário admin criado: ${email} / ${password}  (troque a senha no primeiro acesso)`);
  }

  if (demo) await seedDemo(sede);
  console.log('Seed concluído.');
}

async function seedDemo(sede) {
  if ((await prisma.member.count()) > 0) return console.log('Demo ignorado: já existem membros.');
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const today = new Date();
  const bday = (y) => new Date(Date.UTC(y, today.getMonth(), today.getDate()));

  const filial = await prisma.church.create({ data: { name: 'Filial Zona Norte', type: 'FILIAL', parentId: sede.id, status: 'ATIVA', city: 'São Paulo', state: 'SP' } });
  await prisma.church.create({ data: { name: 'Congregação Vila Nova', type: 'CONGREGACAO', parentId: sede.id, status: 'PLANEJADA', plannedAt: day(120) } });

  const mk = (data) => prisma.member.create({ data: { churchId: sede.id, status: 'ATIVO', ...data } });
  const pastor = await mk({ fullName: 'Paulo Henrique Silva', roleId: roles['Pastor'], phone: '5511999990001', birthDate: bday(1975), profession: 'Pastor', conversionDate: new Date('1995-03-10'), baptismDate: new Date('1995-06-20') });
  const diacono = await mk({ fullName: 'Marcos Antônio Souza', roleId: roles['Diácono'], phone: '5511999990002', birthDate: new Date('1982-05-15'), discipulatorId: pastor.id, profession: 'Contador', conversionDate: new Date('2008-02-01'), baptismDate: new Date('2008-08-10'), leadershipSchoolDate: new Date('2015-12-05') });
  const obreira = await mk({ fullName: 'Ana Beatriz Lima', roleId: roles['Obreiro'], phone: '5511999990003', birthDate: bday(1990), discipulatorId: diacono.id, profession: 'Professora', gender: 'F', conversionDate: new Date('2016-04-04') });
  const novo = await mk({ fullName: 'Carlos Eduardo Rocha', phone: '5511999990004', birthDate: new Date('1998-11-30'), discipulatorId: obreira.id, profession: 'Designer', conversionDate: day(-20), receiveBirthdayMsg: false });
  await mk({ fullName: 'Fernanda Costa', phone: '5511999990005', birthDate: new Date('1995-01-20'), profession: 'Enfermeira', gender: 'F', status: 'ATIVO' });
  await prisma.church.update({ where: { id: sede.id }, data: { pastorId: pastor.id } });

  const cell = await prisma.cell.create({ data: { churchId: sede.id, name: 'Célula Vida Nova', leaderId: obreira.id, weekday: 3, time: '20:00', neighborhood: 'Centro', startedAt: day(-200) } });
  await prisma.cellMember.createMany({ data: [{ cellId: cell.id, memberId: novo.id }, { cellId: cell.id, memberId: obreira.id }] });
  await prisma.cellMeeting.create({ data: { cellId: cell.id, date: day(-7), topic: 'Fé que move', visitors: 2, conversions: 1, attendances: { create: [{ memberId: novo.id, present: true }, { memberId: obreira.id, present: true }] } } });

  const caixa = await prisma.cashAccount.findFirst({ where: { churchId: sede.id } });
  const events = [];
  for (let i = 1; i <= 4; i++) {
    events.push(await prisma.event.create({ data: { churchId: sede.id, title: 'Culto de Domingo', kind: 'CULTO', recurrence: 'SEMANAL', startsAt: day(-7 * i), status: 'REALIZADO', visitorsCount: 3 + i, conversionsCount: i % 2 } }));
  }
  const members = await prisma.member.findMany({ where: { churchId: sede.id } });
  for (const [i, ev] of events.entries()) {
    await prisma.attendance.createMany({ data: members.slice(0, 5 - (i % 3)).map((m) => ({ eventId: ev.id, memberId: m.id })) });
  }
  const congresso = await prisma.event.create({ data: { churchId: sede.id, title: 'Congresso de Jovens', kind: 'CONGRESSO', startsAt: day(45), endsAt: day(47), allowRegistration: true, priceCents: 15000, capacity: 300, location: 'Templo Central' } });
  // Inscrições de exemplo: 2 pagas (com entrada no caixa) e 2 pendentes.
  for (const [i, [name, status]] of [['Lucas Almeida', 'PAGO'], ['Juliana Prado', 'PAGO'], ['Rafael Gomes', 'PENDENTE'], ['Camila Duarte', 'PENDENTE']].entries()) {
    const reg = await prisma.registration.create({ data: { eventId: congresso.id, name, phone: `55119888800${i}0`, amountCents: 15000, status, paidAt: status === 'PAGO' ? day(-i - 1) : null } });
    await prisma.payment.create({ data: { registrationId: reg.id, provider: 'MOCK', amountCents: 15000, status: status === 'PAGO' ? 'APROVADO' : 'PENDENTE' } });
    if (status === 'PAGO') await prisma.transaction.create({ data: { churchId: sede.id, cashAccountId: caixa.id, direction: 'ENTRADA', category: 'INSCRICAO', amountCents: 15000, date: day(-i - 1), method: 'PIX', donorName: name, eventId: congresso.id, registrationId: reg.id, description: 'Inscrição: Congresso de Jovens' } });
  }
  await prisma.event.create({ data: { churchId: sede.id, title: 'Evangelismo na Praça', kind: 'EVANGELISMO', scope: 'EXTERNO', startsAt: day(10), location: 'Praça da Matriz' } });
  await prisma.event.create({ data: { churchId: sede.id, title: 'Ação Social: Cestas Básicas', kind: 'ACAO_SOCIAL', scope: 'EXTERNO', startsAt: day(20) } });
  await prisma.event.create({ data: { churchId: filial.id, title: 'Culto de Inauguração da Filial', kind: 'CULTO', startsAt: day(30) } });

  const tx = (category, amountCents, member, daysAgo = 3, direction = 'ENTRADA') => ({ churchId: sede.id, cashAccountId: caixa.id, direction, category, amountCents, date: day(-daysAgo), memberId: member?.id ?? null, method: 'PIX' });
  await prisma.transaction.createMany({ data: [
    tx('DIZIMO', 50000, diacono), tx('DIZIMO', 80000, pastor), tx('OFERTA', 12000, null, 2), tx('CONSTRUCAO', 30000, obreira, 5),
    tx('OFERTA_ALCADA', 20000, null, 9), tx('DOACAO', 15000, null, 12), tx('MANTENEDOR', 25000, diacono, 15), tx('DESPESA_FIXA', 45000, null, 4, 'SAIDA'),
  ] });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
