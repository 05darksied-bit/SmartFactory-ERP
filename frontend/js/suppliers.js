'use strict';
let allSuppliers = [];

function renderSuppliers() {
  const q = (document.getElementById('supSearch')?.value || '').trim().toLowerCase();
  const list = q ? allSuppliers.filter(s => s.name.toLowerCase().includes(q) || (s.gstin || '').toLowerCase().includes(q)) : allSuppliers;
  const tbody = document.getElementById('suppliersBody');
  tbody.innerHTML = list.length ? list.map(s => `<tr>
    <td>#${s.id}</td>
    <td><strong>${esc(s.name)}</strong><div class="small text-secondary">${esc(s.phone || '')}</div></td>
    <td>${esc(s.gstin || '—')}</td>
    <td>${esc(s.state_code || '—')}</td>
    <td>${s.is_active ? '<span class="badge-passed">Active</span>' : '<span class="badge-rejected">Inactive</span>'}</td>
    <td class="text-nowrap">
      <button class="btn btn-sm btn-outline-secondary btn-hist" data-id="${s.id}" data-name="${esc(s.name)}">History</button>
      <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${s.id}">Edit</button>
      <button class="btn btn-sm btn-outline-${s.is_active ? 'danger' : 'success'} btn-toggle" data-id="${s.id}" data-active="${s.is_active ? 1 : 0}">${s.is_active ? 'Deactivate' : 'Activate'}</button>
    </td>
  </tr>`).join('') : '<tr><td colspan="6" class="text-center text-secondary py-3">No suppliers found.</td></tr>';
}

async function loadSuppliers() {
  try {
    allSuppliers = await api('/api/purchases/suppliers?all=1');
    renderSuppliers();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadHistory(id, name) {
  document.getElementById('historyTitle').textContent = `Purchase history — ${name}`;
  const tbody = document.getElementById('supHistoryBody');
  try {
    const rows = await api(`/api/purchases/suppliers/${id}/history`);
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${String(r.purchase_date).slice(0, 10)}</td>
      <td>${esc(r.invoice_number || '#' + r.id)}</td>
      <td>${esc(r.item_name)}</td>
      <td>${Number(r.quantity).toFixed(2)} ${esc(r.unit)}</td>
      <td>${money(r.total_amount)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="text-secondary small">No purchases recorded for this supplier.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

document.getElementById('addSupplierBtn').addEventListener('click', () => {
  document.getElementById('supModalTitle').textContent = 'Add Supplier';
  document.getElementById('supplierForm').reset();
  document.getElementById('supId').value = '';
  new bootstrap.Modal(document.getElementById('supplierModal')).show();
});

document.getElementById('supplierForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('supId').value;
  const body = {
    name: document.getElementById('supName').value.trim(),
    gstin: document.getElementById('supGstin').value.trim() || null,
    stateCode: document.getElementById('supStateCode').value.trim() || null,
    phone: document.getElementById('supPhone').value.trim() || null,
    address: document.getElementById('supAddress').value.trim() || null
  };
  try {
    if (id) await api(`/api/purchases/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/purchases/suppliers', { method: 'POST', body: JSON.stringify(body) });
    bootstrap.Modal.getInstance(document.getElementById('supplierModal')).hide();
    toast(id ? 'Supplier updated.' : 'Supplier added.', 'success');
    loadSuppliers();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('suppliersBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-hist')) loadHistory(id, btn.dataset.name);
  else if (btn.classList.contains('btn-edit')) {
    const s = allSuppliers.find(x => String(x.id) === String(id));
    if (!s) return;
    document.getElementById('supModalTitle').textContent = `Edit Supplier #${s.id}`;
    document.getElementById('supId').value = s.id;
    document.getElementById('supName').value = s.name;
    document.getElementById('supGstin').value = s.gstin || '';
    document.getElementById('supStateCode').value = s.state_code || '';
    document.getElementById('supPhone').value = s.phone || '';
    document.getElementById('supAddress').value = s.address || '';
    new bootstrap.Modal(document.getElementById('supplierModal')).show();
  } else if (btn.classList.contains('btn-toggle')) {
    const active = btn.dataset.active === '1';
    const ok = await confirmAction(active ? 'Deactivate Supplier' : 'Activate Supplier', `Confirm ${active ? 'deactivating' : 'activating'} this supplier?`);
    if (!ok) return;
    await api(`/api/purchases/suppliers/${id}`, { method: 'PUT', body: JSON.stringify({ isActive: !active }) });
    toast('Supplier status updated.', 'success');
    loadSuppliers();
  }
});

document.getElementById('supSearch').addEventListener('input', renderSuppliers);
loadSuppliers();
