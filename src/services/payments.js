const config = require('../config');
const prisma = require('../lib/prisma');
const { HttpError } = require('../lib/http');

// ── Provedores de gateway ──
// Interface: createCheckout({ registration, event }) -> { providerRef, checkoutUrl }

const mock = {
  name: 'MOCK',
  async createCheckout({ registration }) {
    // Página local que simula o gateway (apenas desenvolvimento).
    return { providerRef: `mock-${registration.id}-${Date.now()}`, checkoutUrl: `${config.publicUrl}/mock-checkout.html?r=${registration.id}` };
  },
};

const mercadopago = {
  name: 'MERCADOPAGO',
  async createCheckout({ registration, event }) {
    if (!config.payment.mpToken) throw new HttpError(500, 'MERCADOPAGO_ACCESS_TOKEN não configurado');
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.payment.mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: `Inscrição: ${event.title}`, quantity: 1, currency_id: 'BRL', unit_price: registration.amountCents / 100 }],
        payer: { name: registration.name, email: registration.email || undefined },
        external_reference: String(registration.id),
        notification_url: `${config.publicUrl}/api/webhooks/mercadopago`,
        back_urls: { success: `${config.publicUrl}/inscricao.html?paid=1`, failure: `${config.publicUrl}/inscricao.html`, pending: `${config.publicUrl}/inscricao.html?pending=1` },
        auto_return: 'approved',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new HttpError(502, 'Falha ao criar cobrança no gateway', data.message);
    return { providerRef: data.id, checkoutUrl: data.init_point };
  },

  // Nunca confiamos no corpo do webhook: consultamos o pagamento direto na API do gateway.
  async fetchPayment(paymentId) {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${config.payment.mpToken}` } });
    if (!res.ok) throw new HttpError(502, 'Pagamento não encontrado no gateway');
    return res.json();
  },
};

const providers = { mock, mercadopago };
const provider = () => providers[config.payment.provider] || mock;

async function defaultCashAccount(tx, churchId) {
  const acc = await tx.cashAccount.findFirst({ where: { churchId, active: true }, orderBy: { id: 'asc' } });
  return acc || tx.cashAccount.create({ data: { churchId, name: 'Caixa geral' } });
}

/**
 * Confirma pagamento de inscrição de forma idempotente: atualiza inscrição, pagamento e
 * lança a entrada no caixa da igreja (categoria INSCRICAO). Chamado por webhook, mock ou baixa manual.
 */
async function markPaid({ registrationId, providerName, providerPaymentId, amountCents, raw }) {
  const result = await prisma.$transaction(async (tx) => {
    const reg = await tx.registration.findUnique({ where: { id: registrationId }, include: { event: true } });
    if (!reg) throw new HttpError(404, 'Inscrição não encontrada');
    if (reg.status === 'PAGO') return { reg, already: true };
    if (reg.status === 'CANCELADO') throw new HttpError(409, 'Inscrição cancelada');
    if (amountCents != null && amountCents !== reg.amountCents) throw new HttpError(409, 'Valor pago diferente do valor da inscrição');

    const pay = await tx.payment.findFirst({ where: { registrationId, status: 'PENDENTE' }, orderBy: { id: 'desc' } });
    const payData = { status: 'APROVADO', providerPaymentId: providerPaymentId ? String(providerPaymentId) : null, rawPayload: raw ? JSON.stringify(raw).slice(0, 8000) : null };
    if (pay) await tx.payment.update({ where: { id: pay.id }, data: payData });
    else await tx.payment.create({ data: { registrationId, provider: providerName, amountCents: reg.amountCents, ...payData } });

    const updated = await tx.registration.update({ where: { id: registrationId }, data: { status: 'PAGO', paidAt: new Date() } });
    const account = await defaultCashAccount(tx, reg.event.churchId);
    await tx.transaction.create({
      data: {
        churchId: reg.event.churchId, cashAccountId: account.id, direction: 'ENTRADA', category: 'INSCRICAO', amountCents: reg.amountCents,
        date: new Date(), method: providerName === 'MANUAL' ? 'DINHEIRO' : 'PIX', memberId: reg.memberId, donorName: reg.memberId ? null : reg.name,
        eventId: reg.eventId, registrationId, description: `Inscrição: ${reg.event.title}`,
      },
    });
    return { reg: updated, already: false };
  });
  return result;
}

module.exports = { provider, providers, markPaid };
