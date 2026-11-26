'use strict';
async function loadPurchasesList() {
  const tbody = document.getElementById('purchasesBody');
  try {
    const rows = await api('/api/purchases');
    tbody.innerHTML = rows.length ? rows.map(p => `<tr>
      <td>#${p.id}</td>
      <td>${String(p.purchase_date).slice(0, 10)}</td>
      <td>${esc(p.supplier_name)}</td>
      <td>${esc(p.invoice_number || '—')}</td>
      <td>${esc(p.item_name)}</td>
      <td>${Number(p.quantity).toFixed(2)} ${esc(p.unit)}</td>
      <td><strong>${money(p.total_amount)}</strong></td>
      <td>${['ADMIN', 'OWNER'].includes(user.role) ? `<button class="btn btn-sm btn-outline-danger btn-return" data-pid="${p.id}" data-iid="${p.item_id}" data-iname="${esc(p.item_name)}" data-max="${p.quantity}">Return</button>` : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="text-center text-secondary py-3">No purchases recorded.</td></tr>';
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-danger">Failed to load purchases.</td></tr>';
  }
}

(async () => {
  try {
    const [s, items] = await Promise.all([api('/api/purchases/suppliers'), api('/api/masters/inventory-items')]);
    const supSel = document.getElementById('supplierId');
    const itemSel = document.getElementById('itemId');
    supSel.innerHTML = s.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    itemSel.innerHTML = items.map(x => `<option value="${x.id}" data-unit="${esc(x.base_unit)}">${esc(x.name)}</option>`).join('');
    itemSel.onchange = () => { document.getElementById('purchaseUnit').value = itemSel.selectedOptions[0]?.dataset.unit || ''; };
    itemSel.dispatchEvent(new Event('change'));
    document.getElementById('purchaseDate').value = new Date().toISOString().slice(0, 10);
    await loadPurchasesList();
  } catch (e) {
    document.getElementById('purchaseMessage').textContent = e.message;
  }
})();

document.getElementById('purchaseForm').onsubmit = async e => {
  e.preventDefault();
  const ok = await confirmAction('Post Purchase Receipt', 'Confirm posting this purchase to inventory and stock batches?');
  if (!ok) return;
  try {
    const r = await api('/api/purchases', {
      method: 'POST',
      body: JSON.stringify({
        supplierId: Number(document.getElementById('supplierId').value),
        invoiceNumber: document.getElementById('invoiceNumber').value,
        purchaseDate: document.getElementById('purchaseDate').value,
        items: [{
          itemId: Number(document.getElementById('itemId').value),
          quantity: Number(document.getElementById('purchaseQty').value),
          rate: Number(document.getElementById('purchaseRate').value),
          unit: document.getElementById('purchaseUnit').value,
          batchNo: document.getElementById('batchNo').value.trim() || undefined,
          expiryDate: document.getElementById('expiryDate').value || null
        }]
      })
    });
    const msg = `Purchase #${r.purchaseId} posted. Total ₹${r.total}. Stock ledger & batch updated.`;
    document.getElementById('purchaseMessage').textContent = msg;
    document.getElementById('purchaseMessage').className = 'small mt-3 message-success';
    toast(msg, 'success');
    await loadPurchasesList();
  } catch (e) {
    document.getElementById('purchaseMessage').textContent = e.message;
    document.getElementById('purchaseMessage').className = 'small mt-3 message-error';
    toast(e.message, 'error');
  }
};

document.getElementById('purchasesBody').addEventListener('click', e => {
  const btn = e.target.closest('.btn-return');
  if (!btn) return;
  document.getElementById('retPurId').textContent = btn.dataset.pid;
  document.getElementById('retItemId').value = btn.dataset.iid;
  document.getElementById('retItemName').textContent = btn.dataset.iname;
  document.getElementById('retQty').max = btn.dataset.max;
  document.getElementById('retQty').value = '';
  document.getElementById('retReason').value = '';
  new bootstrap.Modal(document.getElementById('returnModal')).show();
});

document.getElementById('returnForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pid = document.getElementById('retPurId').textContent;
  try {
    await api(`/api/purchases/${pid}/return`, {
      method: 'POST',
      body: JSON.stringify({
        itemId: Number(document.getElementById('retItemId').value),
        quantity: Number(document.getElementById('retQty').value),
        reason: document.getElementById('retReason').value
      })
    });
    bootstrap.Modal.getInstance(document.getElementById('returnModal')).hide();
    toast('Purchase return recorded.', 'success');
    loadPurchasesList();
  } catch (err) { toast(err.message, 'error'); }
});
