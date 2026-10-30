const prisma = require('../lib/prisma');
const config = require('../config');
const { getProvider, normalizeNumber } = require('./whatsapp');

// Partes da data (ano, mês, dia) no fuso da igreja — o servidor (Vercel) roda em UTC.
function partsInTz(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

const DEFAULT_TEMPLATE =
  'Olá, {nome}! 🎉 A {igreja} deseja a você um feliz aniversário! Que Deus abençoe grandemente a sua vida, ' +
  'renove suas forças e realize os desejos do seu coração. Com carinho, sua família em Cristo. 🙏';

async function getTemplate() {
  const s = await prisma.setting.findUnique({ where: { key: 'birthday_template' } });
  return s?.value || DEFAULT_TEMPLATE;
}

function render(template, member) {
  const first = member.fullName.trim().split(/\s+/)[0];
  return template.replaceAll('{nome}', first).replaceAll('{igreja}', member.church.name);
}

// Aniversariantes da data (ano não bissexto: quem nasceu em 29/02 é felicitado em 28/02).
async function birthdaysOn(date = new Date()) {
  const { y, m: month, d: day } = partsInTz(date);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const members = await prisma.member.findMany({
    where: { birthDate: { not: null }, status: { in: ['ATIVO', 'VISITANTE'] } },
    include: { church: { select: { name: true } } },
  });
  return members.filter((m) => {
    const bm = m.birthDate.getUTCMonth() + 1;
    const bd = m.birthDate.getUTCDate();
    if (bm === 2 && bd === 29 && !leap) return month === 2 && day === 28;
    return bm === month && bd === day;
  });
}

/**
 * Envia felicitações do dia. Idempotente por (membro, ano): rodar duas vezes não duplica mensagens.
 * Respeita o consentimento (receiveBirthdayMsg) e exige telefone cadastrado.
 */
async function sendBirthdayMessages({ date = new Date(), dryRun = false, budgetMs = 45000, delayMs = 400 } = {}) {
  const started = Date.now();
  const year = partsInTz(date).y;
  const [list, template] = await Promise.all([birthdaysOn(date), getTemplate()]);
  const provider = getProvider();
  const summary = { date: date.toISOString().slice(0, 10), found: list.length, remaining: 0, sent: 0, failed: 0, skipped: 0, items: [] };

  for (const m of list) {
    const refKey = `BDAY:${m.id}:${year}`;
    const body = render(template, m);
    if (!m.receiveBirthdayMsg || !m.phone) {
      summary.skipped++;
      summary.items.push({ memberId: m.id, name: m.fullName, result: m.phone ? 'SEM_CONSENTIMENTO' : 'SEM_TELEFONE' });
      continue;
    }
    if (dryRun) {
      summary.items.push({ memberId: m.id, name: m.fullName, result: 'SIMULADO', body });
      continue;
    }
    if (Date.now() - started > budgetMs) { summary.remaining++; continue; } // limite de tempo da função serverless; reexecutar conclui o restante
    const to = normalizeNumber(m.phone);
    const existing = await prisma.messageLog.findUnique({ where: { refKey } });
    if (existing?.status === 'ENVIADA') {
      summary.skipped++;
      summary.items.push({ memberId: m.id, name: m.fullName, result: 'JA_ENVIADA' });
      continue;
    }
    const log = existing || (await prisma.messageLog.create({ data: { memberId: m.id, kind: 'ANIVERSARIO', refKey, toNumber: to, body } }));
    try {
      await provider.send(to, body);
      await prisma.messageLog.update({ where: { id: log.id }, data: { status: 'ENVIADA', sentAt: new Date(), error: null } });
      summary.sent++;
      summary.items.push({ memberId: m.id, name: m.fullName, result: 'ENVIADA' });
    } catch (err) {
      await prisma.messageLog.update({ where: { id: log.id }, data: { status: 'FALHOU', error: String(err.message).slice(0, 500) } });
      summary.failed++;
      summary.items.push({ memberId: m.id, name: m.fullName, result: 'FALHOU', error: err.message });
    }
    await new Promise((r) => setTimeout(r, delayMs)); // espaçamento entre envios para evitar bloqueio por spam
  }
  return summary;
}

module.exports = { sendBirthdayMessages, birthdaysOn, getTemplate, DEFAULT_TEMPLATE };
