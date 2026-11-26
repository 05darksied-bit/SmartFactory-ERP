'use strict';
const canEditMasters = ['ADMIN', 'OWNER'].includes(user.role);
let customersData = [];
let productsData = [];
let inventoryData = [];
let suppliersData = [];
let custPage = 1;
let prodPage = 1;
const PAGE_SIZE = 10;

// Hide write controls for read-only roles (backend also enforces)
if (!canEditMasters) {
  document.querySelectorAll('.admin-only').forEach(el => el.classList.add('d-none'));
  document.getElementById('roleBadge').textContent = `${user.role} (Read-only)`;
}
if (user.role === 'SALESMAN') {
  // Salesman only views Customers & Products
  document.querySelector('[data-bs-target="#tabInventory"]')?.parentElement?.classList.add('d-none');
  document.querySelector('[data-bs-target="#tabBom"]')?.parentElement?.classList.add('d-none');
  document.querySelector('[data-bs-target="#tabSuppliers"]')?.parentElement?.classList.add('d-none');
}

function compatibleUnits(baseUnit) {
  if (baseUnit === 'kg' || baseUnit === 'g') return ['kg', 'g'];
  if (baseUnit === 'litre' || baseUnit === 'ml') return ['litre', 'ml'];
  if (baseUnit === 'piece' || baseUnit === 'packet' || baseUnit === 'carton') return ['piece', 'packet', 'carton'];
  return [baseUnit];
}

// ── 1. CUSTOMERS ───────────────────────────────────────────────────────────────
async function loadCustomers() {
  const showAll = document.getElementById('custShowInactive').checked && canEditMasters ? '1' : '0';
  const type = document.getElementById('custTypeFilter').value;
  const q = document.getElementById('custSearch').value.trim();
  const params = new URLSearchParams({ all: showAll });
  if (type) params.set('type', type);
  if (q) params.set('q', q);
  customersData = await api(`/api/masters/customers?${params}`);
  custPage = 1;
  renderCustomers();
}

function renderCustomers() {
  const tbody = document.getElementById('custBody');
  const start = (custPage - 1) * PAGE_SIZE;
  const slice = customersData.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = slice.length ? slice.map(c => `<tr>
    <td>#${c.id}</td>
    <td><strong>${esc(c.name)}</strong><div class="small text-secondary">${esc(c.address || '')}</div></td>
    <td><span class="badge text-bg-light">${esc(c.customer_type)}</span></td>
    <td>${esc(c.state_code)}</td>
    <td><code>${esc(c.gstin || '—')}</code></td>
    <td class="small">${esc(c.phone || '—')}<div class="text-secondary">${esc(c.email || '')}</div></td>
    <td class="${Number(c.outstanding) > 0 ? 'text-danger fw-bold' : 'text-success'}">${money(c.outstanding)}</td>
    <td>${money(c.credit_limit)}</td>
    <td>${c.is_active ? '<span class="badge-passed">Active</span>' : '<span class="badge-rejected">Inactive</span>'}</td>
    <td class="text-nowrap">
      <button class="btn btn-sm btn-outline-secondary btn-cust-hist" data-id="${c.id}" data-name="${esc(c.name)}">History</button>
      ${canEditMasters ? `
        <button class="btn btn-sm btn-outline-primary btn-cust-edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-sm btn-outline-${c.is_active ? 'danger' : 'success'} btn-cust-toggle" data-id="${c.id}" data-active="${c.is_active ? 1 : 0}">${c.is_active ? 'Deactivate' : 'Activate'}</button>
      ` : ''}
    </td>
  </tr>`).join('') : '<tr><td colspan="10" class="text-center text-secondary py-3">No matching customers found.</td></tr>';

  const pages = Math.max(1, Math.ceil(customersData.length / PAGE_SIZE));
  document.getElementById('custPager').innerHTML = `
    <span>Showing ${slice.length} of ${customersData.length} customer(s)</span>
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" ${custPage <= 1 ? 'disabled' : ''} id="custPrev">Prev</button>
      <span class="btn btn-light disabled">Page ${custPage} / ${pages}</span>
      <button class="btn btn-outline-secondary" ${custPage >= pages ? 'disabled' : ''} id="custNext">Next</button>
    </div>`;
  document.getElementById('custPrev')?.addEventListener('click', () => { custPage--; renderCustomers(); });
  document.getElementById('custNext')?.addEventListener('click', () => { custPage++; renderCustomers(); });
}

document.getElementById('btnNewCustomer')?.addEventListener('click', () => {
  document.getElementById('custModalTitle').textContent = 'Add Customer';
  document.getElementById('customerForm').reset();
  document.getElementById('cId').value = '';
  document.getElementById('cCreditLimit').value = '100000';
  new bootstrap.Modal(document.getElementById('customerModal')).show();
});

document.getElementById('customerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('cId').value;
  const payload = {
    name: document.getElementById('cName').value.trim(),
    customerType: document.getElementById('cType').value,
    stateCode: document.getElementById('cState').value.trim(),
    gstin: document.getElementById('cGstin').value.trim() || null,
    phone: document.getElementById('cPhone').value.trim() || null,
    email: document.getElementById('cEmail').value.trim() || null,
    creditLimit: Number(document.getElementById('cCreditLimit').value || 100000),
    address: document.getElementById('cAddress').value.trim() || null
  };
  try {
    if (id) await api(`/api/masters/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/masters/customers', { method: 'POST', body: JSON.stringify(payload) });
    bootstrap.Modal.getInstance(document.getElementById('customerModal')).hide();
    toast(id ? 'Customer updated.' : 'Customer created.', 'success');
    loadCustomers();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('custBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-cust-edit')) {
    const c = customersData.find(x => String(x.id) === String(id));
    if (!c) return;
    document.getElementById('custModalTitle').textContent = `Edit Customer #${c.id}`;
    document.getElementById('cId').value = c.id;
    document.getElementById('cName').value = c.name;
    document.getElementById('cType').value = c.customer_type;
    document.getElementById('cState').value = c.state_code;
    document.getElementById('cGstin').value = c.gstin || '';
    document.getElementById('cPhone').value = c.phone || '';
    document.getElementById('cEmail').value = c.email || '';
    document.getElementById('cCreditLimit').value = c.credit_limit;
    document.getElementById('cAddress').value = c.address || '';
    new bootstrap.Modal(document.getElementById('customerModal')).show();
  } else if (btn.classList.contains('btn-cust-toggle')) {
    const active = btn.dataset.active === '1';
    const ok = await confirmAction(active ? 'Deactivate Customer' : 'Activate Customer', `Confirm ${active ? 'deactivating' : 'activating'} this customer?`);
    if (!ok) return;
    await api(`/api/masters/customers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) });
    toast('Customer status updated.', 'success');
    loadCustomers();
  } else if (btn.classList.contains('btn-cust-hist')) {
    const [bal, orders] = await Promise.all([
      api(`/api/masters/customers/${id}/outstanding`),
      api(`/api/masters/customers/${id}/orders`)
    ]);
    document.getElementById('historyModalTitle').textContent = `Customer History — ${btn.dataset.name}`;
    document.getElementById('historyModalBody').innerHTML = `
      <div class="alert alert-light border small mb-3">
        <strong>Total Invoiced:</strong> ${money(bal.total_invoiced)} ·
        <strong>Collected:</strong> ${money(bal.total_collected)} ·
        <strong>Outstanding:</strong> <span class="text-danger fw-bold">${money(bal.outstanding)}</span>
      </div>
      <table class="table table-sm">
        <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Invoice</th><th>Amount</th></tr></thead>
        <tbody>${orders.length ? orders.map(o => `<tr><td>#${o.id}</td><td>${new Date(o.created_at).toLocaleDateString('en-IN')}</td><td>${statusBadge(o.status)}</td><td>${esc(o.invoice_number || '—')}</td><td>${money(o.total_amount)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-secondary">No orders yet.</td></tr>'}</tbody>
      </table>`;
    new bootstrap.Modal(document.getElementById('historyModal')).show();
  }
});

// ── 2. PRODUCTS ────────────────────────────────────────────────────────────────
async function loadProducts() {
  const showAll = document.getElementById('prodShowInactive').checked && canEditMasters ? '1' : '0';
  const q = document.getElementById('prodSearch').value.trim();
  const params = new URLSearchParams({ all: showAll });
  if (q) params.set('q', q);
  productsData = await api(`/api/masters/products?${params}`);
  prodPage = 1;
  renderProducts();
  refreshBomProductSelect();
}

function renderProducts() {
  const tbody = document.getElementById('prodBody');
  const start = (prodPage - 1) * PAGE_SIZE;
  const slice = productsData.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = slice.length ? slice.map(p => {
    const imgHtml = p.image_url && /^(https?:\/\/|\/)/i.test(p.image_url)
      ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;margin-right:8px">`
      : '';
    return `<tr>
      <td><code>${esc(p.sku)}</code></td>
      <td>${imgHtml}<strong>${esc(p.name)}</strong></td>
      <td>${esc(p.pack_size)}</td>
      <td>${Number(p.expected_yield)} pkts</td>
      <td><strong>${money(p.selling_price)}</strong></td>
      <td>${esc(p.hsn_code)} (${Number(p.gst_rate)}%)</td>
      <td><strong>${Number(p.finished_stock || 0)}</strong> pkts</td>
      <td>${p.is_active ? '<span class="badge-passed">Active</span>' : '<span class="badge-rejected">Inactive</span>'}</td>
      <td class="text-nowrap">
        ${user.role !== 'SALESMAN' ? `<button class="btn btn-sm btn-outline-secondary btn-prod-hist" data-id="${p.id}" data-name="${esc(p.name)}">History</button>` : ''}
        ${canEditMasters ? `
          <button class="btn btn-sm btn-outline-primary btn-prod-edit" data-id="${p.id}">Edit</button>
          <button class="btn btn-sm btn-outline-${p.is_active ? 'danger' : 'success'} btn-prod-toggle" data-id="${p.id}" data-active="${p.is_active ? 1 : 0}">${p.is_active ? 'Deactivate' : 'Activate'}</button>
        ` : ''}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="text-center text-secondary py-3">No products found.</td></tr>';
}

document.getElementById('btnNewProduct')?.addEventListener('click', () => {
  document.getElementById('prodModalTitle').textContent = 'Add Product';
  document.getElementById('productForm').reset();
  document.getElementById('pId').value = '';
  document.getElementById('pSku').disabled = false;
  document.getElementById('pGst').value = '5';
  new bootstrap.Modal(document.getElementById('productModal')).show();
});

document.getElementById('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('pId').value;
  const payload = {
    sku: document.getElementById('pSku').value.trim(),
    name: document.getElementById('pName').value.trim(),
    packSize: document.getElementById('pPack').value.trim(),
    expectedYield: Number(document.getElementById('pYield').value),
    sellingPrice: Number(document.getElementById('pPrice').value),
    hsnCode: document.getElementById('pHsn').value.trim(),
    gstRate: Number(document.getElementById('pGst').value),
    imageUrl: document.getElementById('pImage').value.trim() || null
  };
  try {
    if (id) await api(`/api/masters/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/masters/products', { method: 'POST', body: JSON.stringify(payload) });
    bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
    toast(id ? 'Product updated.' : 'Product created.', 'success');
    loadProducts();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('prodBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-prod-edit')) {
    const p = productsData.find(x => String(x.id) === String(id));
    if (!p) return;
    document.getElementById('prodModalTitle').textContent = `Edit Product — ${p.sku}`;
    document.getElementById('pId').value = p.id;
    document.getElementById('pSku').value = p.sku;
    document.getElementById('pSku').disabled = true;
    document.getElementById('pName').value = p.name;
    document.getElementById('pPack').value = p.pack_size;
    document.getElementById('pYield').value = p.expected_yield;
    document.getElementById('pPrice').value = p.selling_price;
    document.getElementById('pHsn').value = p.hsn_code;
    document.getElementById('pGst').value = p.gst_rate;
    document.getElementById('pImage').value = p.image_url || '';
    new bootstrap.Modal(document.getElementById('productModal')).show();
  } else if (btn.classList.contains('btn-prod-toggle')) {
    const active = btn.dataset.active === '1';
    const ok = await confirmAction(active ? 'Deactivate Product' : 'Activate Product', `Confirm ${active ? 'deactivating' : 'activating'} this product?`);
    if (!ok) return;
    await api(`/api/masters/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) });
    toast('Product status updated.', 'success');
    loadProducts();
  } else if (btn.classList.contains('btn-prod-hist')) {
    const h = await api(`/api/masters/products/${id}/history`);
    document.getElementById('historyModalTitle').textContent = `Product History — ${btn.dataset.name}`;
    document.getElementById('historyModalBody').innerHTML = `
      <h6 class="fw-bold">Recent Sales Orders</h6>
      <table class="table table-sm mb-3">
        <thead><tr><th>Order</th><th>Customer</th><th>Qty</th><th>Price</th><th>Status</th></tr></thead>
        <tbody>${h.sales.length ? h.sales.map(s => `<tr><td>#${s.order_id}</td><td>${esc(s.customer_name)}</td><td>${s.quantity}</td><td>${money(s.unit_price)}</td><td>${statusBadge(s.status)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-secondary">No sales yet.</td></tr>'}</tbody>
      </table>
      <h6 class="fw-bold">Recent Production Runs</h6>
      <table class="table table-sm mb-0">
        <thead><tr><th>Run</th><th>Batch</th><th>Output</th><th>Wastage</th><th>Cost/Pkt</th></tr></thead>
        <tbody>${h.production.length ? h.production.map(r => `<tr><td>#${r.id}</td><td><code>${esc(r.batch_number || '—')}</code></td><td>${r.actual_output}</td><td>${r.actual_wastage}</td><td>${money(r.cost_per_packet)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-secondary">No production runs yet.</td></tr>'}</tbody>
      </table>`;
    new bootstrap.Modal(document.getElementById('historyModal')).show();
  }
});

// ── 3. INVENTORY ───────────────────────────────────────────────────────────────
async function loadInventory() {
  if (user.role === 'SALESMAN') return;
  inventoryData = await api('/api/masters/inventory-items');
  renderInventory();
  const adjSel = document.getElementById('adjItem');
  if (adjSel) {
    adjSel.innerHTML = inventoryData.map(i => `<option value="${i.item_type}:${i.id}:${esc(i.base_unit)}">${esc(i.name)} (${esc(i.base_unit)})</option>`).join('');
  }
}

function renderInventory() {
  const q = document.getElementById('invSearch').value.trim().toLowerCase();
  const tf = document.getElementById('invTypeFilter').value;
  const list = inventoryData.filter(i => {
    if (tf === 'RAW' && i.item_type !== 'RAW') return false;
    if (tf === 'PACKAGING' && i.item_type !== 'PACKAGING') return false;
    if (tf === 'LOW' && Number(i.balance) > Number(i.reorder_level)) return false;
    if (q && !i.name.toLowerCase().includes(q) && !(i.sku || '').toLowerCase().includes(q)) return false;
    return true;
  });
  document.getElementById('invBody').innerHTML = list.length ? list.map(i => {
    const low = Number(i.balance) <= Number(i.reorder_level);
    return `<tr class="${low ? 'table-warning' : ''}">
      <td><code>${esc(i.sku || '—')}</code></td>
      <td><strong>${esc(i.name)}</strong></td>
      <td><span class="badge text-bg-light">${esc(i.item_type)}</span></td>
      <td><strong>${Number(i.balance).toFixed(2)} ${esc(i.base_unit)}</strong></td>
      <td>${Number(i.reorder_level).toFixed(2)} ${esc(i.base_unit)}</td>
      <td>${low ? '<span class="badge-rejected">Low Stock</span>' : '<span class="badge-passed">Healthy</span>'}</td>
      <td>${canEditMasters ? `<button class="btn btn-sm btn-outline-primary btn-inv-edit" data-id="${i.id}">Edit</button>` : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-secondary py-3">No matching materials.</td></tr>';
}

document.getElementById('btnNewInvItem')?.addEventListener('click', () => {
  document.getElementById('invModalTitle').textContent = 'Add Inventory Material';
  document.getElementById('itemForm').reset();
  document.getElementById('iId').value = '';
  document.getElementById('iSku').disabled = false;
  document.getElementById('iType').disabled = false;
  document.getElementById('iUnit').disabled = false;
  document.getElementById('iOpeningWrap').classList.remove('d-none');
  new bootstrap.Modal(document.getElementById('invItemModal')).show();
});

document.getElementById('invBody').addEventListener('click', e => {
  const btn = e.target.closest('.btn-inv-edit');
  if (!btn) return;
  const item = inventoryData.find(x => String(x.id) === String(btn.dataset.id));
  if (!item) return;
  document.getElementById('invModalTitle').textContent = `Edit Material — ${item.name}`;
  document.getElementById('iId').value = item.id;
  document.getElementById('iSku').value = item.sku || '';
  document.getElementById('iSku').disabled = true;
  document.getElementById('iName').value = item.name;
  document.getElementById('iType').value = item.item_type;
  document.getElementById('iType').disabled = true;
  document.getElementById('iUnit').value = item.base_unit;
  document.getElementById('iUnit').disabled = true;
  document.getElementById('iOpeningWrap').classList.add('d-none');
  document.getElementById('iReorder').value = item.reorder_level;
  new bootstrap.Modal(document.getElementById('invItemModal')).show();
});

document.getElementById('itemForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('iId').value;
  try {
    if (id) {
      await api(`/api/masters/inventory-items/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: document.getElementById('iName').value.trim(), reorderLevel: Number(document.getElementById('iReorder').value) })
      });
    } else {
      await api('/api/masters/inventory-items', {
        method: 'POST',
        body: JSON.stringify({
          sku: document.getElementById('iSku').value.trim(),
          name: document.getElementById('iName').value.trim(),
          itemType: document.getElementById('iType').value,
          baseUnit: document.getElementById('iUnit').value,
          opening: Number(document.getElementById('iOpening').value),
          reorderLevel: Number(document.getElementById('iReorder').value)
        })
      });
    }
    bootstrap.Modal.getInstance(document.getElementById('invItemModal')).hide();
    toast(id ? 'Material updated.' : 'Inventory material created.', 'success');
    loadInventory();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('btnReqAdjust')?.addEventListener('click', () => {
  new bootstrap.Modal(document.getElementById('adjModal')).show();
});

document.getElementById('adjForm').addEventListener('submit', async e => {
  e.preventDefault();
  const [itemType, itemId, unit] = document.getElementById('adjItem').value.split(':');
  try {
    await api('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({
        itemType,
        itemId: Number(itemId),
        direction: document.getElementById('adjDir').value,
        quantity: Number(document.getElementById('adjQty').value),
        unit,
        reason: document.getElementById('adjReason').value.trim()
      })
    });
    bootstrap.Modal.getInstance(document.getElementById('adjModal')).hide();
    toast('Stock adjustment submitted for approval.', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('btnViewLedger')?.addEventListener('click', async () => {
  const rows = await api('/api/inventory/ledger?limit=50');
  document.getElementById('historyModalTitle').textContent = 'Latest Stock Movements (50)';
  document.getElementById('historyModalBody').innerHTML = `
    <table class="table table-sm">
      <thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Qty</th><th>Source</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="small">${new Date(r.created_at).toLocaleString('en-IN')}</td><td>${esc(r.item_name)}</td><td><code>${esc(r.movement_type)}</code></td><td>${Number(r.quantity).toFixed(2)} ${esc(r.unit)}</td><td>${esc(r.source_type)} #${r.source_id}</td></tr>`).join('')}</tbody>
    </table>`;
  new bootstrap.Modal(document.getElementById('historyModal')).show();
});

// ── 4. DYNAMIC BOM MANAGEMENT (NO JSON) ────────────────────────────────────────
function refreshBomProductSelect() {
  const sel = document.getElementById('bomProduct');
  if (!sel) return;
  const activeProds = productsData.filter(p => p.is_active);
  sel.innerHTML = activeProds.map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(x.pack_size)}</option>`).join('');
  if (activeProds.length) loadBomVersions(activeProds[0].id);
}

function addBomRow(selectedItemId = '', qty = '', unit = '') {
  if (!inventoryData.length) return;
  const tbody = document.getElementById('bomRowsBody');
  const tr = document.createElement('tr');
  const optionsHtml = inventoryData.map(i => `<option value="${i.id}" data-unit="${esc(i.base_unit)}" data-type="${esc(i.item_type)}" ${String(i.id) === String(selectedItemId) ? 'selected' : ''}>${esc(i.name)} (${esc(i.item_type)})</option>`).join('');
  tr.innerHTML = `
    <td><select class="form-select form-select-sm bom-item-sel" ${!canEditMasters ? 'disabled' : ''}>${optionsHtml}</select></td>
    <td><input type="number" step="0.0001" min="0.0001" class="form-control form-control-sm bom-qty-inp" value="${esc(qty)}" placeholder="Qty" required ${!canEditMasters ? 'readonly' : ''}></td>
    <td><select class="form-select form-select-sm bom-unit-sel" ${!canEditMasters ? 'disabled' : ''}></select></td>
    <td>${canEditMasters ? '<button type="button" class="btn btn-sm btn-outline-danger btn-rm-bom">✕</button>' : ''}</td>`;
  tbody.appendChild(tr);

  const itemSel = tr.querySelector('.bom-item-sel');
  const unitSel = tr.querySelector('.bom-unit-sel');
  const updateUnits = () => {
    const base = itemSel.selectedOptions[0]?.dataset.unit || 'kg';
    const units = compatibleUnits(base);
    unitSel.innerHTML = units.map(u => `<option value="${u}" ${u === (unit || base) ? 'selected' : ''}>${u}</option>`).join('');
    updateBomPreview();
  };
  itemSel.addEventListener('change', updateUnits);
  tr.querySelector('.bom-qty-inp').addEventListener('input', updateBomPreview);
  unitSel.addEventListener('change', updateBomPreview);
  updateUnits();
}

function updateBomPreview() {
  const rows = [...document.querySelectorAll('#bomRowsBody tr')];
  if (!rows.length) {
    document.getElementById('bomPreviewBox').textContent = 'Add at least one component to see planned batch requirements.';
    return;
  }
  const summary = rows.map(r => {
    const name = r.querySelector('.bom-item-sel')?.selectedOptions[0]?.textContent.split(' (')[0] || '';
    const q = r.querySelector('.bom-qty-inp')?.value || '0';
    const u = r.querySelector('.bom-unit-sel')?.value || '';
    return `${name}: ${q} ${u}`;
  }).join(' · ');
  document.getElementById('bomPreviewBox').textContent = `Planned 1-batch requirement → ${summary}`;
}

async function loadBomVersions(productId) {
  if (user.role === 'SALESMAN' || !productId) return;
  const versions = await api(`/api/masters/boms/${productId}/versions`);
  const active = versions.find(v => v.is_active);
  document.getElementById('activeBomBadge').textContent = active ? `Active: v${active.version_no}` : 'No active BOM';

  const tbody = document.getElementById('bomRowsBody');
  tbody.innerHTML = '';
  if (active && active.items.length) {
    active.items.forEach(x => addBomRow(x.item_id, Number(x.quantity_per_batch), x.unit));
  } else if (canEditMasters) {
    addBomRow();
  }
  updateBomPreview();

  const histEl = document.getElementById('bomVersionsList');
  histEl.innerHTML = versions.length ? versions.map(v => `
    <div class="border rounded p-2 mb-2 ${v.is_active ? 'border-primary bg-light' : ''}">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong>Version ${v.version_no} ${v.is_active ? '<span class="badge-passed ms-1">Active</span>' : ''}</strong>
        <span class="text-secondary">${v.effective_date ? String(v.effective_date).slice(0, 10) : new Date(v.created_at).toLocaleDateString('en-IN')}</span>
      </div>
      ${v.notes ? `<div class="text-secondary mb-1">${esc(v.notes)}</div>` : ''}
      <ul class="mb-0 ps-3">${v.items.map(i => `<li>${esc(i.item_name)}: ${Number(i.quantity_per_batch)} ${esc(i.unit)}</li>`).join('')}</ul>
    </div>
  `).join('') : 'No BOM versions created yet for this product.';
}

document.getElementById('bomProduct')?.addEventListener('change', e => loadBomVersions(e.target.value));
document.getElementById('btnAddBomRow')?.addEventListener('click', () => addBomRow());
document.getElementById('bomRowsBody')?.addEventListener('click', e => {
  if (e.target.classList.contains('btn-rm-bom')) {
    e.target.closest('tr').remove();
    updateBomPreview();
  }
});

document.getElementById('bomDynamicForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const rows = [...document.querySelectorAll('#bomRowsBody tr')];
  if (!rows.length) { toast('Add at least one BOM component.', 'warning'); return; }

  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const sel = r.querySelector('.bom-item-sel');
    const itemId = Number(sel.value);
    if (seen.has(itemId)) {
      toast('Duplicate component detected. Each material can only appear once.', 'error');
      return;
    }
    seen.add(itemId);
    const qty = Number(r.querySelector('.bom-qty-inp').value);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast('All BOM quantities must be positive.', 'error');
      return;
    }
    items.push({
      itemId,
      itemType: sel.selectedOptions[0].dataset.type,
      quantityPerBatch: qty,
      unit: r.querySelector('.bom-unit-sel').value
    });
  }

  const ok = await confirmAction('Save New BOM Version', 'This will activate a new BOM version for the selected product. Continue?');
  if (!ok) return;

  try {
    const res = await api('/api/masters/boms', {
      method: 'POST',
      body: JSON.stringify({
        productId: Number(document.getElementById('bomProduct').value),
        effectiveDate: document.getElementById('bomEffectiveDate').value || undefined,
        notes: document.getElementById('bomNotes').value.trim() || undefined,
        items
      })
    });
    toast(`BOM Version ${res.versionNo} saved and activated.`, 'success');
    loadBomVersions(document.getElementById('bomProduct').value);
  } catch (err) { toast(err.message, 'error'); }
});

// ── 5. SUPPLIERS ───────────────────────────────────────────────────────────────
async function loadSuppliers() {
  if (user.role === 'SALESMAN') return;
  const showAll = document.getElementById('supShowInactive').checked ? '1' : '0';
  suppliersData = await api(`/api/purchases/suppliers?all=${showAll}`);
  renderSuppliers();
}

function renderSuppliers() {
  const q = document.getElementById('supSearch').value.trim().toLowerCase();
  const list = q ? suppliersData.filter(s => s.name.toLowerCase().includes(q) || (s.gstin || '').toLowerCase().includes(q)) : suppliersData;
  document.getElementById('supBody').innerHTML = list.length ? list.map(s => `<tr>
    <td>#${s.id}</td>
    <td><strong>${esc(s.name)}</strong><div class="small text-secondary">${esc(s.address || '')}</div></td>
    <td><code>${esc(s.gstin || '—')}</code></td>
    <td>${esc(s.state_code || '—')}</td>
    <td>${esc(s.phone || '—')}</td>
    <td>${s.is_active ? '<span class="badge-passed">Active</span>' : '<span class="badge-rejected">Inactive</span>'}</td>
    <td class="text-nowrap">
      <button class="btn btn-sm btn-outline-secondary btn-sup-hist" data-id="${s.id}" data-name="${esc(s.name)}">History</button>
      ${canEditMasters ? `
        <button class="btn btn-sm btn-outline-primary btn-sup-edit" data-id="${s.id}">Edit</button>
        <button class="btn btn-sm btn-outline-${s.is_active ? 'danger' : 'success'} btn-sup-toggle" data-id="${s.id}" data-active="${s.is_active ? 1 : 0}">${s.is_active ? 'Deactivate' : 'Activate'}</button>
      ` : ''}
    </td>
  </tr>`).join('') : '<tr><td colspan="7" class="text-center text-secondary py-3">No suppliers found.</td></tr>';
}

document.getElementById('btnNewSupplier')?.addEventListener('click', () => {
  document.getElementById('supModalTitle').textContent = 'Add Supplier';
  document.getElementById('supplierForm').reset();
  document.getElementById('sId').value = '';
  new bootstrap.Modal(document.getElementById('supplierModal')).show();
});

document.getElementById('supplierForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('sId').value;
  const payload = {
    name: document.getElementById('sName').value.trim(),
    gstin: document.getElementById('sGstin').value.trim() || null,
    stateCode: document.getElementById('sState').value.trim() || null,
    phone: document.getElementById('sPhone').value.trim() || null,
    address: document.getElementById('sAddress').value.trim() || null
  };
  try {
    if (id) await api(`/api/purchases/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/purchases/suppliers', { method: 'POST', body: JSON.stringify(payload) });
    bootstrap.Modal.getInstance(document.getElementById('supplierModal')).hide();
    toast(id ? 'Supplier updated.' : 'Supplier created.', 'success');
    loadSuppliers();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('supBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-sup-edit')) {
    const s = suppliersData.find(x => String(x.id) === String(id));
    if (!s) return;
    document.getElementById('supModalTitle').textContent = `Edit Supplier #${s.id}`;
    document.getElementById('sId').value = s.id;
    document.getElementById('sName').value = s.name;
    document.getElementById('sGstin').value = s.gstin || '';
    document.getElementById('sState').value = s.state_code || '';
    document.getElementById('sPhone').value = s.phone || '';
    document.getElementById('sAddress').value = s.address || '';
    new bootstrap.Modal(document.getElementById('supplierModal')).show();
  } else if (btn.classList.contains('btn-sup-toggle')) {
    const active = btn.dataset.active === '1';
    const ok = await confirmAction(active ? 'Deactivate Supplier' : 'Activate Supplier', `Confirm ${active ? 'deactivating' : 'activating'} this supplier?`);
    if (!ok) return;
    await api(`/api/purchases/suppliers/${id}`, { method: 'PUT', body: JSON.stringify({ isActive: !active }) });
    toast('Supplier status updated.', 'success');
    loadSuppliers();
  } else if (btn.classList.contains('btn-sup-hist')) {
    const [purchases, payments] = await Promise.all([
      api(`/api/purchases/suppliers/${id}/history`),
      api(`/api/purchases/suppliers/${id}/payments`)
    ]);
    document.getElementById('historyModalTitle').textContent = `Supplier History — ${btn.dataset.name}`;
    document.getElementById('historyModalBody').innerHTML = `
      <h6 class="fw-bold">Purchase History</h6>
      <table class="table table-sm mb-3">
        <thead><tr><th>Date</th><th>Invoice</th><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
        <tbody>${purchases.length ? purchases.map(p => `<tr><td>${String(p.purchase_date).slice(0, 10)}</td><td>${esc(p.invoice_number || '#' + p.id)}</td><td>${esc(p.item_name)}</td><td>${Number(p.quantity).toFixed(2)} ${esc(p.unit)}</td><td>${money(p.total_amount)}</td></tr>`).join('') : '<tr><td colspan="5" class="text-secondary">No purchases yet.</td></tr>'}</tbody>
      </table>
      <h6 class="fw-bold">Supplier Payments</h6>
      <table class="table table-sm mb-3">
        <thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Reference</th></tr></thead>
        <tbody>${payments.length ? payments.map(p => `<tr><td>${String(p.payment_date).slice(0, 10)}</td><td><strong>${money(p.amount)}</strong></td><td>${esc(p.mode || '—')}</td><td>${esc(p.reference_no || '—')}</td></tr>`).join('') : '<tr><td colspan="4" class="text-secondary">No supplier payments recorded.</td></tr>'}</tbody>
      </table>
      ${canEditMasters ? `
      <form id="supPayForm" class="row g-2 border-top pt-3">
        <div class="col-12 small fw-bold">Record Supplier Payment</div>
        <div class="col-3"><input type="number" step="0.01" min="0.01" id="spAmt" class="form-control form-control-sm" placeholder="Amount ₹" required></div>
        <div class="col-3"><input type="date" id="spDate" class="form-control form-control-sm" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="col-3"><select id="spMode" class="form-select form-select-sm"><option>Bank transfer</option><option>UPI</option><option>Cheque</option><option>Cash</option></select></div>
        <div class="col-3"><button type="submit" class="btn btn-sm btn-primary w-100">Record</button></div>
      </form>` : ''}`;
    document.getElementById('supPayForm')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      await api(`/api/purchases/suppliers/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(document.getElementById('spAmt').value), paymentDate: document.getElementById('spDate').value, mode: document.getElementById('spMode').value })
      });
      toast('Supplier payment recorded.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('historyModal')).hide();
    });
    new bootstrap.Modal(document.getElementById('historyModal')).show();
  }
});

// ── 6. USERS (OWNER ONLY) ──────────────────────────────────────────────────────
async function loadUsersTable() {
  if (user.role !== 'OWNER') return;
  document.getElementById('usersTabNav').classList.remove('d-none');
  const rows = await api('/api/masters/users');
  document.getElementById('usersTableBody').innerHTML = rows.map(u => `<tr>
    <td>#${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
    <td><span class="badge text-bg-light">${esc(u.role)}</span></td>
    <td>${money(u.sales_target)}</td>
    <td>${u.is_active ? '<span class="badge-passed">Active</span>' : '<span class="badge-rejected">Inactive</span>'}</td>
    <td>${u.id !== user.id ? `<button class="btn btn-sm btn-outline-${u.is_active ? 'danger' : 'success'} btn-user-toggle" data-id="${u.id}" data-active="${u.is_active ? 1 : 0}">${u.is_active ? 'Deactivate' : 'Activate'}</button>` : '—'}</td>
  </tr>`).join('');
}

document.getElementById('createUserForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/masters/users', {
      method: 'POST',
      body: JSON.stringify({ name: document.getElementById('uName').value, email: document.getElementById('uEmail').value, password: document.getElementById('uPass').value, role: document.getElementById('uRole').value })
    });
    toast('User created.', 'success');
    document.getElementById('createUserForm').reset();
    loadUsersTable();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('usersTableBody')?.addEventListener('click', async e => {
  const btn = e.target.closest('.btn-user-toggle');
  if (!btn) return;
  const active = btn.dataset.active === '1';
  const ok = await confirmAction(active ? 'Deactivate User' : 'Activate User', 'Confirm updating user access?');
  if (!ok) return;
  await api(`/api/masters/users/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) });
  toast('User status updated.', 'success');
  loadUsersTable();
});

// Filters & listeners
document.getElementById('custSearch').addEventListener('input', loadCustomers);
document.getElementById('custTypeFilter').addEventListener('change', loadCustomers);
document.getElementById('custShowInactive').addEventListener('change', loadCustomers);
document.getElementById('prodSearch').addEventListener('input', loadProducts);
document.getElementById('prodShowInactive').addEventListener('change', loadProducts);
document.getElementById('invSearch').addEventListener('input', renderInventory);
document.getElementById('invTypeFilter').addEventListener('change', renderInventory);
document.getElementById('supSearch').addEventListener('input', renderSuppliers);
document.getElementById('supShowInactive').addEventListener('change', loadSuppliers);
document.getElementById('bomEffectiveDate').value = new Date().toISOString().slice(0, 10);

// Initial load (inventory first so BOM dropdown has materials ready)
Promise.all([loadInventory(), loadCustomers(), loadSuppliers(), loadUsersTable()])
  .then(() => loadProducts())
  .catch(e => toast(e.message, 'error'));
