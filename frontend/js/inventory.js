'use strict';
let summaryItems = [];

async function loadLedger() {
  const body = document.getElementById('ledgerBody');
  const errEl = document.getElementById('ledgerError');
  errEl.textContent = '';
  try {
    const [rows, summary, batches, adjusts] = await Promise.all([
      api('/api/inventory/ledger'),
      api('/api/inventory/summary'),
      api('/api/inventory/batches'),
      api('/api/inventory/adjustments')
    ]);
    summaryItems = summary;

    body.innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${new Date(r.created_at).toLocaleString('en-IN')}</td>
      <td>${esc(r.item_name)}</td>
      <td>${esc(r.item_type)}</td>
      <td><code>${esc(r.movement_type)}</code></td>
      <td>${Number(r.quantity).toFixed(2)} ${esc(r.unit)}</td>
      <td>${esc(r.source_type)} #${r.source_id}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-secondary">No movements.</td></tr>';

    const alerts = summary.filter(x => x.item_type !== 'FINISHED' && Number(x.balance) <= Number(x.reorder_level));
    document.getElementById('stockSummary').textContent =
      `Current balances: ${summary.map(x => `${x.name}: ${Number(x.balance)} ${x.base_unit}`).join(' · ')}`;
    const banner = document.getElementById('lowStockBanner');
    banner.textContent = alerts.length
      ? `⚠ Low stock alerts: ${alerts.map(x => `${x.name} (${x.balance} ${x.base_unit})`).join(', ')}`
      : '✓ All raw & packaging items are above reorder levels.';
    banner.className = alerts.length ? 'small text-danger fw-bold' : 'small text-success';

    document.getElementById('batchesBody').innerHTML = batches.length ? batches.map(b => {
      const days = b.days_to_expiry;
      const cls = days !== null && days <= 15 ? 'text-danger fw-bold' : '';
      return `<tr>
        <td><code>${esc(b.batch_no)}</code></td>
        <td>${esc(b.item_name)}</td>
        <td>${esc(b.item_type)}</td>
        <td>${Number(b.remaining_qty).toFixed(2)} ${esc(b.unit)}</td>
        <td>${b.expiry_date ? String(b.expiry_date).slice(0, 10) : '—'}</td>
        <td class="${cls}">${days !== null ? `${days}d` : '—'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="text-secondary">No tracked batches yet.</td></tr>';

    document.getElementById('adjustBody').innerHTML = adjusts.length ? adjusts.map(a => `<tr>
      <td>#${a.id}</td>
      <td>${esc(a.item_name)}</td>
      <td>${esc(a.direction)}</td>
      <td>${Number(a.quantity).toFixed(2)} ${esc(a.unit)}</td>
      <td>${esc(a.reason || '—')}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${a.status === 'PENDING' && ['ADMIN', 'OWNER'].includes(user.role) ? `
        <button class="btn btn-sm btn-outline-success btn-adj-approve" data-id="${a.id}">Approve</button>
        <button class="btn btn-sm btn-outline-danger btn-adj-reject" data-id="${a.id}">Reject</button>
      ` : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-secondary">No stock adjustments requested.</td></tr>';

    const adjSel = document.getElementById('adjItemSelect');
    if (adjSel) {
      adjSel.innerHTML = summary.map(x => `<option value="${x.item_type}:${x.id}:${esc(x.base_unit)}">${esc(x.name)} (${esc(x.item_type)})</option>`).join('');
    }
  } catch (e) {
    body.innerHTML = '<tr><td colspan="6" class="text-danger">Could not load inventory.</td></tr>';
    errEl.textContent = e.message;
  }
}

document.getElementById('newAdjustBtn').addEventListener('click', () => {
  new bootstrap.Modal(document.getElementById('adjustModal')).show();
});

document.getElementById('adjustForm').addEventListener('submit', async e => {
  e.preventDefault();
  const [itemType, itemId, unit] = document.getElementById('adjItemSelect').value.split(':');
  try {
    await api('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({
        itemType,
        itemId: Number(itemId),
        direction: document.getElementById('adjDir').value,
        quantity: Number(document.getElementById('adjQty').value),
        unit,
        reason: document.getElementById('adjReason').value
      })
    });
    bootstrap.Modal.getInstance(document.getElementById('adjustModal')).hide();
    toast('Adjustment request submitted for approval.', 'success');
    loadLedger();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('adjustBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-adj-approve')) {
    const ok = await confirmAction('Approve Stock Adjustment', `Approve adjustment #${id} and post to stock ledger?`);
    if (!ok) return;
    await api(`/api/inventory/adjustments/${id}/approve`, { method: 'POST', body: '{}' }).then(() => { toast('Adjustment approved.', 'success'); loadLedger(); }).catch(err => toast(err.message, 'error'));
  } else if (btn.classList.contains('btn-adj-reject')) {
    await api(`/api/inventory/adjustments/${id}/reject`, { method: 'POST', body: '{}' }).then(() => { toast('Adjustment rejected.', 'info'); loadLedger(); }).catch(err => toast(err.message, 'error'));
  }
});

document.getElementById('refreshLedger').addEventListener('click', loadLedger);
loadLedger();
