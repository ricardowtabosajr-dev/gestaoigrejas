'use strict';
const id = new URLSearchParams(location.search).get('r');
document.getElementById('pay').onclick = async () => {
  const res = await fetch(`/api/public/mock-pay/${encodeURIComponent(id)}`, { method: 'POST' });
  document.getElementById('out').textContent = res.ok ? 'Pagamento aprovado! Redirecionando…' : 'Falha ao simular pagamento.';
  if (res.ok) setTimeout(() => (location.href = '/inscricao.html?paid=1'), 1200);
};
