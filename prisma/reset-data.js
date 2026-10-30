// Zera os dados operacionais (membros, células, eventos, financeiro, mensagens, auditoria, filiais...).
// Mantém: cargos/permissões, igreja-sede (MATRIZ) com seu caixa, e o usuário admin (ADMIN_EMAIL).
// Uso: node prisma/reset-data.js --confirm
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Operação destrutiva. Rode com --confirm para apagar os dados.');
    process.exit(1);
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@igreja.local').toLowerCase();
  const admin = await prisma.user.findUnique({ where: { email } });
  const sede = await prisma.church.findFirst({ where: { type: 'MATRIZ' }, orderBy: { id: 'asc' } });
  if (!admin || !sede) throw new Error('Admin ou igreja-sede não encontrados; abortado para evitar perda de acesso.');

  const [r] = await prisma.$transaction([
    prisma.$queryRaw`select 1`,
    prisma.messageLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.registration.deleteMany(),
    prisma.attendance.deleteMany(),
    prisma.cellAttendance.deleteMany(),
    prisma.cellMeeting.deleteMany(),
    prisma.cellMember.deleteMany(),
    prisma.cell.updateMany({ data: { parentCellId: null } }),
    prisma.cell.deleteMany(),
    prisma.event.deleteMany(),
    prisma.achievement.deleteMany(),
    prisma.discipleshipRecord.deleteMany(),
    prisma.member.updateMany({ data: { discipulatorId: null } }),
    prisma.church.updateMany({ data: { pastorId: null } }),
    prisma.user.updateMany({ where: { id: admin.id }, data: { memberId: null } }),
    prisma.user.deleteMany({ where: { id: { not: admin.id } } }),
    prisma.auditLog.deleteMany(),
    prisma.member.deleteMany(),
    prisma.cashAccount.deleteMany({ where: { churchId: { not: sede.id } } }),
    prisma.church.deleteMany({ where: { id: { not: sede.id } } }),
    prisma.setting.deleteMany(),
  ]);
  const counts = { membros: await prisma.member.count(), eventos: await prisma.event.count(), lancamentos: await prisma.transaction.count(), igrejas: await prisma.church.count(), usuarios: await prisma.user.count(), cargos: await prisma.role.count() };
  console.log('Banco zerado. Restaram:', counts);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
