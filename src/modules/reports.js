const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { wrap } = require('../lib/http');
const { requirePermission, scopedWhere } = require('../middleware/auth');

const router = express.Router();
router.use(requirePermission('reports:read'));

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const config = require('../config');
// Primeiro instante do mês corrente no fuso da igreja.
const startOfMonth = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(`${p.year}-${p.month}-01T00:00:00${config.tzOffset}`);
};
const range = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 90 * 86400000)),
  to: z.coerce.date().default(() => new Date()),
});

// ── Painel (dashboard) ──
router.get('/dashboard', wrap(async (req, res) => {
  const som = startOfMonth();
  const canFinance = req.user.permissions.has('finance:read');
  const memberWhere = await scopedWhere(req);
  const [active, newThisMonth, conversions, baptisms, cells, upcoming, fin, visitors, visitsWeek] = await Promise.all([
    prisma.member.count({ where: { ...memberWhere, status: 'ATIVO' } }),
    prisma.member.count({ where: { ...memberWhere, createdAt: { gte: som } } }),
    prisma.member.count({ where: { ...memberWhere, conversionDate: { gte: som } } }),
    prisma.member.count({ where: { ...memberWhere, baptismDate: { gte: som } } }),
    prisma.cell.count({ where: await scopedWhere(req, { status: 'ATIVA' }) }),
    prisma.event.findMany({ where: await scopedWhere(req, { startsAt: { gte: new Date() }, status: 'AGENDADO' }), orderBy: { startsAt: 'asc' }, take: 6, select: { id: true, title: true, kind: true, scope: true, startsAt: true, location: true } }),
    canFinance ? prisma.transaction.groupBy({ by: ['direction'], where: await scopedWhere(req, { date: { gte: som } }), _sum: { amountCents: true } }) : [],
    prisma.member.count({ where: { ...memberWhere, status: 'VISITANTE' } }),
    prisma.visit.count({ where: await scopedWhere(req, { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }) }),
  ]);
  const f = (d) => fin.find((x) => x.direction === d)?._sum.amountCents ?? 0;
  res.json({
    members: { active, newThisMonth, visitors, visitsWeek },
    faith: { conversionsThisMonth: conversions, baptismsThisMonth: baptisms },
    cells: { active: cells },
    upcomingEvents: upcoming,
    finance: canFinance ? { monthIncomeCents: f('ENTRADA'), monthExpenseCents: f('SAIDA'), monthBalanceCents: f('ENTRADA') - f('SAIDA') } : null,
  });
}));

// ── Frequência por culto (balanço) ──
router.get('/attendance/events', wrap(async (req, res) => {
  const { from, to } = range.parse(req.query);
  const kind = req.query.kind ? String(req.query.kind) : 'CULTO';
  const events = await prisma.event.findMany({
    where: await scopedWhere(req, { kind, startsAt: { gte: from, lte: to }, status: { not: 'CANCELADO' } }),
    orderBy: { startsAt: 'asc' },
    include: { _count: { select: { attendances: true } } },
  });
  const rows = events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, present: e._count.attendances, visitors: e.visitorsCount, conversions: e.conversionsCount, total: e._count.attendances + e.visitorsCount }));
  const avg = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
  res.json({ events: rows, averageAttendance: Number(avg.toFixed(1)), totalConversions: rows.reduce((s, r) => s + r.conversions, 0) });
}));

// Quem está frequentando e quem está ausente (por membro) no período.
router.get('/attendance/members', wrap(async (req, res) => {
  const { from, to } = range.parse(req.query);
  const kind = req.query.kind ? String(req.query.kind) : 'CULTO';
  const events = await prisma.event.findMany({ where: await scopedWhere(req, { kind, startsAt: { gte: from, lte: to }, status: { not: 'CANCELADO' } }), select: { id: true, startsAt: true } });
  const eventIds = events.map((e) => e.id);
  const members = await prisma.member.findMany({
    where: await scopedWhere(req, { status: 'ATIVO' }),
    select: { id: true, fullName: true, phone: true, churchId: true, role: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
  });
  const att = await prisma.attendance.findMany({ where: { eventId: { in: eventIds }, memberId: { in: members.map((m) => m.id) } }, select: { memberId: true, event: { select: { startsAt: true } } } });
  const stats = new Map();
  for (const a of att) {
    const s = stats.get(a.memberId) || { count: 0, last: null };
    s.count++;
    if (!s.last || a.event.startsAt > s.last) s.last = a.event.startsAt;
    stats.set(a.memberId, s);
  }
  const total = events.length;
  const rows = members.map((m) => {
    const s = stats.get(m.id) || { count: 0, last: null };
    const rate = total ? Math.round((s.count / total) * 100) : 0;
    return { id: m.id, fullName: m.fullName, phone: m.phone, role: m.role?.name ?? null, presences: s.count, rate, lastAttendance: s.last, situation: s.count === 0 ? 'AUSENTE' : rate >= 50 ? 'FREQUENTE' : 'IRREGULAR' };
  }).sort((a, b) => a.rate - b.rate);
  const count = (s) => rows.filter((r) => r.situation === s).length;
  res.json({ totalEvents: total, summary: { frequent: count('FREQUENTE'), irregular: count('IRREGULAR'), absent: count('AUSENTE') }, members: rows });
}));

// ── Crescimento ──
router.get('/growth', wrap(async (req, res) => {
  const year = z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()).parse(req.query.year);
  const inYear = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
  const w = await scopedWhere(req);
  const [joined, converted, baptized, graduated, churches] = await Promise.all([
    prisma.member.findMany({ where: { ...w, OR: [{ membershipDate: inYear }, { membershipDate: null, createdAt: inYear }] }, select: { membershipDate: true, createdAt: true } }),
    prisma.member.findMany({ where: { ...w, conversionDate: inYear }, select: { conversionDate: true } }),
    prisma.member.findMany({ where: { ...w, baptismDate: inYear }, select: { baptismDate: true } }),
    prisma.member.count({ where: { ...w, leadershipSchoolDate: inYear } }),
    prisma.church.groupBy({ by: ['status'], where: await scopedWhere(req, {}, 'id'), _count: { _all: true } }),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, newMembers: 0, conversions: 0, baptisms: 0 }));
  const bump = (d, field) => { const m = months[d.getUTCMonth()]; if (m) m[field]++; };
  joined.forEach((m) => bump(m.membershipDate || m.createdAt, 'newMembers'));
  converted.forEach((m) => bump(m.conversionDate, 'conversions'));
  baptized.forEach((m) => bump(m.baptismDate, 'baptisms'));
  const sum = (f) => months.reduce((s, m) => s + m[f], 0);
  res.json({ year, months, totals: { newMembers: sum('newMembers'), conversions: sum('conversions'), baptisms: sum('baptisms'), leadershipGraduates: graduated }, expansion: churches.map((c) => ({ status: c.status, count: c._count._all })) });
}));

// ── Finanças ──
router.get('/finance', requirePermission('finance:read'), wrap(async (req, res) => {
  const { from, to } = range.parse(req.query);
  const where = await scopedWhere(req, { date: { gte: from, lte: to } });
  const [byCategory, rows, byChurch] = await Promise.all([
    prisma.transaction.groupBy({ by: ['direction', 'category'], where, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.transaction.findMany({ where, select: { date: true, direction: true, amountCents: true } }),
    prisma.transaction.groupBy({ by: ['churchId', 'direction'], where, _sum: { amountCents: true } }),
  ]);
  const months = {};
  for (const r of rows) {
    const m = (months[monthKey(r.date)] ||= { month: monthKey(r.date), entradaCents: 0, saidaCents: 0 });
    m[r.direction === 'ENTRADA' ? 'entradaCents' : 'saidaCents'] += r.amountCents;
  }
  const entrada = byCategory.filter((c) => c.direction === 'ENTRADA').reduce((s, c) => s + (c._sum.amountCents ?? 0), 0);
  const saida = byCategory.filter((c) => c.direction === 'SAIDA').reduce((s, c) => s + (c._sum.amountCents ?? 0), 0);
  const churches = await prisma.church.findMany({ where: { id: { in: [...new Set(byChurch.map((b) => b.churchId))] } }, select: { id: true, name: true } });
  res.json({
    period: { from, to },
    totals: { entradaCents: entrada, saidaCents: saida, saldoCents: entrada - saida },
    byCategory: byCategory.map((c) => ({ direction: c.direction, category: c.category, totalCents: c._sum.amountCents ?? 0, count: c._count._all })),
    byMonth: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
    byChurch: churches.map((c) => ({ church: c.name, entradaCents: byChurch.find((b) => b.churchId === c.id && b.direction === 'ENTRADA')?._sum.amountCents ?? 0, saidaCents: byChurch.find((b) => b.churchId === c.id && b.direction === 'SAIDA')?._sum.amountCents ?? 0 })),
  });
}));

// ── Desempenho de departamentos (Apostolado, Pastores, Missionários, Diaconato, Obreiros...) ──
router.get('/departments', wrap(async (req, res) => {
  const { from, to } = range.parse(req.query);
  const roles = await prisma.role.findMany({ where: { isMinistry: true }, orderBy: { level: 'desc' } });
  const events = await prisma.event.count({ where: await scopedWhere(req, { kind: 'CULTO', startsAt: { gte: from, lte: to }, status: { not: 'CANCELADO' } }) });
  const members = await prisma.member.findMany({
    where: await scopedWhere(req, { roleId: { in: roles.map((r) => r.id) }, status: 'ATIVO' }),
    select: { id: true, roleId: true, conversionDate: true, _count: { select: { disciples: true, cellsLed: true } } },
  });
  const presences = await prisma.attendance.groupBy({ by: ['memberId'], where: { memberId: { in: members.map((m) => m.id) }, event: { kind: 'CULTO', startsAt: { gte: from, lte: to }, status: { not: 'CANCELADO' } } }, _count: { _all: true } });
  const pMap = new Map(presences.map((p) => [p.memberId, p._count._all]));
  res.json({
    period: { from, to }, cultosNoPeriodo: events,
    departments: roles.map((r) => {
      const ms = members.filter((m) => m.roleId === r.id);
      const totalPresences = ms.reduce((s, m) => s + (pMap.get(m.id) ?? 0), 0);
      return {
        role: r.name, members: ms.length,
        attendanceRate: events && ms.length ? Math.round((totalPresences / (events * ms.length)) * 100) : 0,
        disciples: ms.reduce((s, m) => s + m._count.disciples, 0),
        cellsLed: ms.reduce((s, m) => s + m._count.cellsLed, 0),
      };
    }),
  });
}));

module.exports = router;
