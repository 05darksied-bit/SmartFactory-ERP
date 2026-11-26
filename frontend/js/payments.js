'use strict';
if (user.role === 'ACCOUNTANT') {
  document.getElementById('paymentForm').style.display = 'none';
}

async function loadPaymentsData() {
  const historyEl = document.getElementById('paymentHistory');
  try {
    const [invoices, payments] = await Promise.all([api('/api/invoices'), api('/api/payments')]);
    document.getElementById('invoiceId').innerHTML = invoices.map(x =>
      `<option value="${x.id}">${esc(x.invoice_number)} · ${esc(x.customer_name)} · ₹${Number(x.total_amount).toFixed(2)}</option>`
    ).join('') || '<option value="">No posted invoices</option>';
    document.getElementById('paymentDate').value = new Date().toISOString().slice(0, 10);
    historyEl.innerHTML = `<table class="table table-sm table-hover">
      <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Mode</th></tr></thead>
      <tbody>${payments.map(p => `<tr>
        <td>${String(p.payment_date).slice(0, 10)}</td>
        <td>${esc(p.invoice_number)}</td>
        <td>${esc(p.customer_name)}</td>
        <td><strong>${money(p.amount)}</strong></td>
        <td>${esc(p.mode || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="text-secondary">No payments recorded.</td></tr>'}</tbody>
    </table>`;
  } catch (e) {
    historyEl.textContent = e.message;
  }
}

document.getElementById('paymentForm').onsubmit = async e => {
  e.preventDefault();
  const ok = await confirmAction('Record Payment', 'Confirm posting this payment against the selected invoice?');
  if (!ok) return;
  try {
    const r = await api('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId: Number(document.getElementById('invoiceId').value),
        amount: Number(document.getElementById('paymentAmount').value),
        paymentDate: document.getElementById('paymentDate').value,
        mode: document.getElementById('paymentMode').value
      })
    });
    const msg = `Payment recorded. Remaining outstanding: ₹${r.outstanding}.`;
    document.getElementById('paymentMessage').textContent = msg;
    document.getElementById('paymentMessage').className = 'small mt-3 message-success';
    toast(msg, 'success');
    document.getElementById('paymentAmount').value = '';
    await loadPaymentsData();
  } catch (err) {
    document.getElementById('paymentMessage').textContent = err.message;
    document.getElementById('paymentMessage').className = 'small mt-3 message-error';
    toast(err.message, 'error');
  }
};

loadPaymentsData();
