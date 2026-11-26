'use strict';
let allOrders = [];
let statusFilter = 'ALL';
let editingOrder = null;
let dispatchingOrder = null;
let rejectingOrderId = null;

function renderOrders() {
  const body = document.getElementById('ordersBody');
  const q = (document.getElementById('orderSearch')?.value || '').trim().toLowerCase();
  const filtered = allOrders.filter(o => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
    if (q && !String(o.id).includes(q) && !String(o.customer_name || '').toLowerCase().includes(q)) return false;
    return true;
  });

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" class="text-center text-secondary py-4">No matching orders found.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(o => {
    let actions = `<button class="btn btn-sm btn-outline-secondary me-1 btn-detail" data-id="${o.id}">Details</button>`;
    if (['ADMIN', 'OWNER'].includes(user.role)) {
      if (o.status === 'SUBMITTED') {
        actions += `<button class="btn btn-sm btn-outline-secondary me-1 btn-edit" data-id="${o.id}">Edit</button>`;
        actions += `<button class="btn btn-sm btn-outline-primary me-1 btn-verify" data-id="${o.id}">Verify</button>`;
        actions += `<button class="btn btn-sm btn-outline-danger me-1 btn-reject" data-id="${o.id}">Reject</button>`;
      }
      if (o.status === 'APPROVED') {
        actions += `<button class="btn btn-sm btn-primary me-1 btn-invoice" data-id="${o.id}">GST invoice</button>`;
      }
      if (o.status === 'INVOICED') {
        actions += `<button class="btn btn-sm btn-outline-success me-1 btn-dispatch" data-id="${o.id}">Dispatch</button>`;
      }
    }
    if (o.invoice_number && o.invoice_id) {
      actions += `<button class="btn btn-sm btn-outline-secondary me-1 btn-pdf" data-inv-id="${o.invoice_id}" data-inv-num="${esc(o.invoice_number)}">PDF</button>`;
      actions += `<button class="btn btn-sm btn-outline-primary me-1 btn-einv" data-inv-id="${o.invoice_id}">e-Invoice</button>`;
      actions += `<button class="btn btn-sm btn-outline-success me-1 btn-wa" data-inv-num="${esc(o.invoice_number)}" data-cust="${esc(o.customer_name)}" data-total="${Number(o.total_amount).toFixed(2)}">Share</button>`;
      if (['ADMIN', 'OWNER'].includes(user.role) && o.status === 'INVOICED') {
        actions += `<button class="btn btn-sm btn-outline-danger btn-cn" data-inv-id="${o.invoice_id}" data-inv-num="${esc(o.invoice_number)}">Cancel Inv</button>`;
      }
    }
    return `<tr>
      <td><strong>#${o.id}</strong></td>
      <td>${esc(o.customer_name)}</td>
      <td>${esc(o.salesman_name)}</td>
      <td>${statusBadge(o.status)}</td>
      <td><strong>${money(o.total_amount)}</strong></td>
      <td class="text-nowrap">${actions}</td>
    </tr>`;
  }).join('');
}

async function loadOrders() {
  const body = document.getElementById('ordersBody');
  body.innerHTML = '<tr><td colspan="6" class="text-secondary"><span class="sf-spin"></span>Loading orders…</td></tr>';
  try {
    allOrders = await api('/api/orders');
    renderOrders();
  } catch (e) {
    body.innerHTML = '<tr><td colspan="6" class="text-danger">Could not load orders.</td></tr>';
    document.getElementById('ordersMessage').textContent = e.message;
  }
}

async function showOrderDetail(id) {
  try {
    const o = await api(`/api/orders/${id}`);
    document.getElementById('detailTitle').textContent = `Order #${o.id} — ${o.customer_name}`;
    document.getElementById('detailBody').innerHTML = `
      <div class="row g-2 mb-3 small">
        <div class="col-md-4"><strong>Status:</strong> ${statusBadge(o.status)}</div>
        <div class="col-md-4"><strong>Total:</strong> ${money(o.total_amount)}</div>
        <div class="col-md-4"><strong>Credit limit:</strong> ${money(o.credit_limit)}</div>
      </div>
      <h6 class="fw-bold">Line Items</h6>
      <table class="table table-sm mb-3">
        <thead><tr><th>Product</th><th>Ordered</th><th>Dispatched</th><th>Remaining</th><th>Price</th></tr></thead>
        <tbody>${o.items.map(i => `<tr>
          <td>${esc(i.product_name)}</td>
          <td>${i.quantity}</td>
          <td>${i.dispatched_qty || 0}</td>
          <td>${i.quantity - (i.dispatched_qty || 0)}</td>
          <td>${money(i.unit_price)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <h6 class="fw-bold">Dispatches (${(o.dispatches || []).length})</h6>
      <ul class="small mb-3">${(o.dispatches || []).length ? o.dispatches.map(d => `<li>Dispatch #${d.id} on ${String(d.dispatch_date).slice(0, 10)} (${esc(d.reference_no || 'No ref')})</li>`).join('') : '<li class="text-secondary">No dispatches yet</li>'}</ul>
      <h6 class="fw-bold">Edit &amp; Audit History</h6>
      <ul class="small mb-0">${(o.history || []).length ? o.history.map(h => `<li><code>${esc(h.action)}</code> by ${esc(h.user_name || 'System')} on ${new Date(h.created_at).toLocaleString('en-IN')}</li>`).join('') : '<li class="text-secondary">No history</li>'}</ul>
    `;
    new bootstrap.Modal(document.getElementById('orderDetailModal')).show();
  } catch (e) { toast(e.message, 'error'); }
}

async function openEditModal(id) {
  try {
    editingOrder = await api(`/api/orders/${id}`);
    document.getElementById('editOrderId').textContent = id;
    document.getElementById('editOrderLines').innerHTML = editingOrder.items.map((x, idx) => `
      <div class="border rounded p-2 mb-2">
        <div class="fw-semibold small mb-2">${esc(x.product_name)}</div>
        <div class="row g-2">
          <div class="col-6"><label class="form-label small">Quantity</label><input type="number" min="1" step="1" class="form-control form-control-sm edit-qty" data-idx="${idx}" value="${x.quantity}" required></div>
          <div class="col-6"><label class="form-label small">Unit Price (₹)</label><input type="number" min="0" step="0.01" class="form-control form-control-sm edit-price" data-idx="${idx}" value="${x.unit_price}" required></div>
        </div>
      </div>
    `).join('');
    new bootstrap.Modal(document.getElementById('editOrderModal')).show();
  } catch (e) { toast(e.message, 'error'); }
}

document.getElementById('editOrderForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!editingOrder) return;
  try {
    const items = editingOrder.items.map((x, idx) => ({
      productId: x.product_id,
      quantity: Number(document.querySelector(`.edit-qty[data-idx="${idx}"]`).value),
      unitPrice: Number(document.querySelector(`.edit-price[data-idx="${idx}"]`).value)
    }));
    await api(`/api/orders/${editingOrder.id}`, { method: 'PATCH', body: JSON.stringify({ items }) });
    bootstrap.Modal.getInstance(document.getElementById('editOrderModal')).hide();
    toast('Order updated.', 'success');
    loadOrders();
  } catch (err) { toast(err.message, 'error'); }
});

async function verifyOrder(id) {
  const ok = await confirmAction('Verify & Approve Order', `Verify finished-goods stock and approve Order #${id}?`);
  if (!ok) return;
  try {
    const r = await api(`/api/orders/${id}/verify`, { method: 'POST', body: '{}' });
    toast(r.creditWarning ? `Approved (Warning: ${r.creditWarning})` : 'Order verified and approved.', r.creditWarning ? 'warning' : 'success');
    loadOrders();
  } catch (e) {
    const shortages = e.data?.shortages || [];
    const msg = shortages.length ? `${e.message}: ${shortages.map(x => `product ${x.productId} short by ${x.shortage} packets`).join('; ')}` : e.message;
    toast(msg, 'error', 6000);
    document.getElementById('ordersMessage').textContent = msg;
  }
}

function openRejectModal(id) {
  rejectingOrderId = id;
  document.getElementById('rejectOrderId').textContent = id;
  document.getElementById('rejectReason').value = '';
  new bootstrap.Modal(document.getElementById('rejectModal')).show();
}

document.getElementById('rejectForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api(`/api/orders/${rejectingOrderId}/reject`, { method: 'POST', body: JSON.stringify({ reason: document.getElementById('rejectReason').value }) });
    bootstrap.Modal.getInstance(document.getElementById('rejectModal')).hide();
    toast('Order rejected.', 'info');
    loadOrders();
  } catch (err) { toast(err.message, 'error'); }
});

async function makeInvoice(id) {
  const ok = await confirmAction('Generate GST Invoice', `Generate GST Tax Invoice for Order #${id}?`);
  if (!ok) return;
  try {
    const r = await api(`/api/orders/${id}/invoice`, { method: 'POST', body: '{}' });
    toast(`Invoice ${r.invoiceNumber} generated (${money(r.total)}).`, 'success');
    loadOrders();
  } catch (e) { toast(e.message, 'error'); }
}

async function openDispatchModal(id) {
  try {
    dispatchingOrder = await api(`/api/orders/${id}`);
    document.getElementById('dispatchOrderId').textContent = id;
    document.getElementById('dispatchDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('dispatchRef').value = '';
    document.getElementById('dispatchLines').innerHTML = dispatchingOrder.items.map(x => {
      const rem = x.quantity - (x.dispatched_qty || 0);
      return `<div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-center">
        <div><div class="fw-semibold small">${esc(x.product_name)}</div><div class="small text-secondary">Remaining: ${rem} pkts</div></div>
        <input type="number" min="0" max="${rem}" step="1" class="form-control form-control-sm disp-qty" data-pid="${x.product_id}" value="${rem}" style="width:100px">
      </div>`;
    }).join('');
    new bootstrap.Modal(document.getElementById('dispatchModal')).show();
  } catch (e) { toast(e.message, 'error'); }
}

document.getElementById('dispatchForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!dispatchingOrder) return;
  try {
    const quantities = {};
    document.querySelectorAll('.disp-qty').forEach(inp => { quantities[inp.dataset.pid] = Number(inp.value); });
    const r = await api(`/api/orders/${dispatchingOrder.id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        dispatchDate: document.getElementById('dispatchDate').value,
        referenceNo: document.getElementById('dispatchRef').value,
        quantities
      })
    });
    bootstrap.Modal.getInstance(document.getElementById('dispatchModal')).hide();
    toast(`Dispatch #${r.dispatchId} posted (${r.dispatched} pkts; ${r.remaining} remaining).`, 'success');
    loadOrders();
  } catch (err) { toast(err.message, 'error'); }
});

async function cancelInvoice(invId, invNum) {
  const ok = await confirmAction('Issue Credit Note', `Cancel invoice ${invNum} and issue a Credit Note?`);
  if (!ok) return;
  try {
    const r = await api(`/api/invoices/${invId}/credit-note`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled via Order Management' }) });
    toast(`Credit note ${r.creditNoteNumber} issued.`, 'success');
    loadOrders();
  } catch (e) { toast(e.message, 'error'); }
}

document.getElementById('ordersBody').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('btn-detail')) showOrderDetail(id);
  else if (btn.classList.contains('btn-edit')) openEditModal(id);
  else if (btn.classList.contains('btn-verify')) verifyOrder(id);
  else if (btn.classList.contains('btn-reject')) openRejectModal(id);
  else if (btn.classList.contains('btn-invoice')) makeInvoice(id);
  else if (btn.classList.contains('btn-dispatch')) openDispatchModal(id);
  else if (btn.classList.contains('btn-pdf')) downloadBlob(`/api/invoices/${btn.dataset.invId}/pdf`, `${btn.dataset.invNum.replaceAll('/', '-')}.pdf`).catch(err => toast(err.message, 'error'));
  else if (btn.classList.contains('btn-einv')) openEinvoice(btn.dataset.invId);
  else if (btn.classList.contains('btn-wa')) {
    const text = `SmartFactory Foods Tax Invoice ${btn.dataset.invNum} for ${btn.dataset.cust} (Order Total: Rs. ${btn.dataset.total}).`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  else if (btn.classList.contains('btn-cn')) cancelInvoice(btn.dataset.invId, btn.dataset.invNum);
});

async function openEinvoice(invId) {
  try {
    const method = ['ADMIN', 'OWNER'].includes(user.role) ? 'POST' : 'GET';
    const data = await api(`/api/invoices/${invId}/e-invoice`, { method, body: method === 'POST' ? '{}' : undefined });
    document.getElementById('einvoiceBody').innerHTML = `
      <div class="alert alert-success small">
        <div><strong>IRN:</strong> <code>${esc(data.irn)}</code></div>
        <div><strong>Ack No:</strong> ${esc(data.ackNo)} · <strong>e-Way Bill No:</strong> ${esc(data.ewbNo)}</div>
      </div>
      <pre class="report-output mb-0">${esc(JSON.stringify(data.payload, null, 2))}</pre>`;
    new bootstrap.Modal(document.getElementById('einvoiceModal')).show();
  } catch (e) { toast(e.message, 'error'); }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-outline-secondary'); });
    btn.classList.remove('btn-outline-secondary'); btn.classList.add('btn-primary');
    statusFilter = btn.dataset.status;
    renderOrders();
  });
});

document.getElementById('orderSearch')?.addEventListener('input', renderOrders);
document.getElementById('refreshOrders').addEventListener('click', loadOrders);
loadOrders();
