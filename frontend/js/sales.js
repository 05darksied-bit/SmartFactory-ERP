'use strict';
const queueKey = 'sf_offline_orders';
let products = [];
let customers = [];
let cartItems = [];
let syncing = false;

function generateIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `sf-${user.id || 0}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pending() {
  return JSON.parse(localStorage.getItem(queueKey) || '[]');
}

function savePending(a) {
  localStorage.setItem(queueKey, JSON.stringify(a));
  const el = document.getElementById('pendingQueue');
  if (el) {
    el.textContent = a.length ? `${a.length} offline order(s) waiting to sync.` : 'No offline orders waiting.';
    el.className = a.length ? 'small text-warning fw-semibold' : 'small text-secondary';
  }
}

function renderCustomers(filterText = '') {
  const sel = document.getElementById('customerId');
  const q = filterText.trim().toLowerCase();
  const list = q
    ? customers.filter(x => x.name.toLowerCase().includes(q) || String(x.state_code).includes(q) || x.customer_type.toLowerCase().includes(q))
    : customers;
  sel.innerHTML = list.length
    ? list.map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(x.customer_type)} · ${esc(x.state_code)}</option>`).join('')
    : '<option value="">No matching customers</option>';
  loadCustomerDetails();
}

async function loadCustomerDetails() {
  const cid = document.getElementById('customerId')?.value;
  const box = document.getElementById('customerBalanceBox');
  const hist = document.getElementById('custHistoryBody');
  if (!cid) {
    if (box) box.textContent = 'Select a customer.';
    return;
  }
  if (!navigator.onLine) {
    if (box) box.textContent = 'Offline mode: balance check unavailable.';
    return;
  }
  try {
    const [bal, orders] = await Promise.all([
      api(`/api/masters/customers/${cid}/outstanding`),
      api(`/api/masters/customers/${cid}/orders`)
    ]);
    if (box) {
      box.innerHTML = `<strong>Outstanding:</strong> <span class="${Number(bal.outstanding) > 0 ? 'text-danger fw-bold' : 'text-success fw-bold'}">${money(bal.outstanding)}</span> · <strong>Credit limit:</strong> ${money(bal.credit_limit)} · <strong>Invoiced:</strong> ${money(bal.total_invoiced)}`;
    }
    if (hist) {
      hist.innerHTML = orders.length
        ? orders.slice(0, 5).map(o => `<tr><td>#${o.id}</td><td>${statusBadge(o.status)}</td><td>${money(o.total_amount)}</td><td class="small">${new Date(o.created_at).toLocaleDateString('en-IN')}</td></tr>`).join('')
        : '<tr><td colspan="4" class="text-secondary small">No prior orders</td></tr>';
    }
  } catch (e) {
    if (box) box.textContent = 'Could not load customer balance.';
  }
}

async function loadMasters() {
  try {
    [customers, products] = await Promise.all([api('/api/masters/customers'), api('/api/masters/products')]);
    localStorage.setItem('sf_masters', JSON.stringify({ customers, products, updatedAt: new Date().toISOString() }));
  } catch (e) {
    const cached = JSON.parse(localStorage.getItem('sf_masters') || 'null');
    if (!cached) throw e;
    customers = cached.customers;
    products = cached.products;
  }
  renderCustomers();
  const prodSel = document.getElementById('productId');
  prodSel.innerHTML = products.map(x => `<option value="${x.id}" data-price="${x.selling_price}">${esc(x.name)} · ${esc(x.pack_size)} · ₹${x.selling_price}</option>`).join('');
  if (['ADMIN', 'OWNER'].includes(user.role)) document.getElementById('unitPrice').readOnly = false;
  prodSel.dispatchEvent(new Event('change'));
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  const totalEl = document.getElementById('cartTotal');
  if (!cartItems.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-secondary py-3">Cart is empty. Add products above.</td></tr>';
    totalEl.textContent = money(0);
    return;
  }
  let total = 0;
  tbody.innerHTML = cartItems.map((item, idx) => {
    const p = products.find(x => x.id === item.productId);
    const lineTotal = item.quantity * item.unitPrice;
    total += lineTotal;
    return `<tr>
      <td>${esc(p ? `${p.name} (${p.pack_size})` : `Product #${item.productId}`)}</td>
      <td>${item.quantity}</td>
      <td>${money(item.unitPrice)}</td>
      <td><strong>${money(lineTotal)}</strong></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger btn-rm-cart" data-idx="${idx}">✕</button></td>
    </tr>`;
  }).join('');
  totalEl.textContent = money(total);
}

function addToCart() {
  const pid = Number(document.getElementById('productId').value);
  const qty = Number(document.getElementById('quantity').value);
  const price = Number(document.getElementById('unitPrice').value);
  if (!pid || !Number.isInteger(qty) || qty <= 0) {
    toast('Enter a positive whole packet quantity.', 'warning');
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    toast('Invalid unit price.', 'warning');
    return;
  }
  const existing = cartItems.find(x => x.productId === pid);
  if (existing) existing.quantity += qty;
  else cartItems.push({ productId: pid, quantity: qty, unitPrice: price });
  document.getElementById('quantity').value = '1';
  renderCart();
}

async function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const q = pending();
  if (!q.length) return;
  syncing = true;
  const left = [];
  let syncedCount = 0;
  try {
    for (const entry of q) {
      if (entry.ownerId && entry.ownerId !== user.id) { left.push(entry); continue; }
      const payload = entry.order || entry;
      if (!payload.idempotencyKey) payload.idempotencyKey = entry.idempotencyKey || generateIdempotencyKey();
      try {
        await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
        syncedCount++;
      } catch (e) {
        if (e.isNetwork) left.push(entry);
        else {
          toast(`Offline order failed: ${e.message}`, 'error');
        }
      }
    }
    savePending(left);
    if (syncedCount > 0) toast(`Synced ${syncedCount} offline order(s) without duplicates.`, 'success');
    await loadMine();
  } finally {
    syncing = false;
  }
}

async function loadMine() {
  try {
    const [rows, totals] = await Promise.all([api('/api/orders'), api('/api/orders/my-customer-sales')]);
    document.getElementById('customerSales').textContent =
      totals.map(x => `${x.customer}: ${x.order_count} orders · ${money(x.order_value)}`).join(' | ') || 'No customer sales yet.';
    document.getElementById('myOrders').innerHTML = rows.slice(0, 10).map(x => `<tr>
      <td>#${x.id}</td><td>${esc(x.customer_name)}</td><td>${statusBadge(x.status)}</td><td>${money(x.total_amount)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-secondary">No orders yet.</td></tr>';

    const totalAchieved = rows.filter(r => r.status !== 'REJECTED').reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const target = Number(user.sales_target || 50000);
    const pct = Math.min(100, Math.round((totalAchieved / Math.max(target, 1)) * 100));
    document.getElementById('targetLabel').textContent = `${money(totalAchieved)} / ${money(target)} (${pct}%)`;
    document.getElementById('targetBar').style.width = `${pct}%`;
  } catch (e) { /* offline */ }
}

document.getElementById('customerSearch').addEventListener('input', e => renderCustomers(e.target.value));
document.getElementById('customerId').addEventListener('change', loadCustomerDetails);
document.getElementById('productId').addEventListener('change', () => {
  document.getElementById('unitPrice').value = document.querySelector('#productId option:checked')?.dataset.price || '';
});
document.getElementById('addToCartBtn').addEventListener('click', addToCart);
document.getElementById('cartBody').addEventListener('click', e => {
  const btn = e.target.closest('.btn-rm-cart');
  if (!btn) return;
  cartItems.splice(Number(btn.dataset.idx), 1);
  renderCart();
});

document.getElementById('salesForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!cartItems.length) {
    toast('Add at least one product to the cart.', 'warning');
    return;
  }
  const customerId = Number(document.getElementById('customerId').value);
  if (!customerId) {
    toast('Select a customer.', 'warning');
    return;
  }
  const idempotencyKey = generateIdempotencyKey();
  const order = { customerId, items: cartItems, idempotencyKey };
  const msg = document.getElementById('salesMessage');
  try {
    await api('/api/orders', { method: 'POST', body: JSON.stringify(order) });
    msg.textContent = 'Order submitted to factory.';
    msg.className = 'small mt-2 message-success';
    toast('Order submitted to factory.', 'success');
    cartItems = [];
    renderCart();
    await loadMine();
    await loadCustomerDetails();
  } catch (err) {
    if (!navigator.onLine || err.isNetwork) {
      savePending([...pending(), { ownerId: user.id, idempotencyKey, order }]);
      msg.textContent = 'Offline: order saved locally with idempotency key and will sync automatically.';
      msg.className = 'small mt-2 text-warning';
      toast('Saved to offline queue.', 'warning');
      cartItems = [];
      renderCart();
    } else {
      msg.textContent = err.message;
      msg.className = 'small mt-2 message-error';
      toast(err.message, 'error');
    }
  }
});

document.getElementById('syncOrders').onclick = syncQueue;
window.addEventListener('offline', () => { document.getElementById('networkStatus').textContent = '● Offline'; });
window.addEventListener('online', () => { document.getElementById('networkStatus').textContent = '● Online'; syncQueue(); });

async function loadVisits() {
  try {
    const rows = await api('/api/visits');
    const tbody = document.getElementById('visitsBody');
    if (tbody) {
      tbody.innerHTML = rows.length ? rows.slice(0, 5).map(v => `<tr>
        <td>${esc(v.customer_name)}</td>
        <td class="small"><code>${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}</code></td>
        <td class="small">${new Date(v.visited_at).toLocaleTimeString('en-IN')}</td>
      </tr>`).join('') : '<tr><td colspan="3" class="text-secondary small">No visits logged yet.</td></tr>';
    }
  } catch (e) { /* offline */ }
}

document.getElementById('btnGpsCheckIn')?.addEventListener('click', async () => {
  const customerId = Number(document.getElementById('customerId')?.value);
  if (!customerId) { toast('Select a customer first.', 'warning'); return; }
  const notes = document.getElementById('gpsNotes')?.value.trim() || null;

  const submitVisit = async (latitude, longitude, accuracyM = null) => {
    try {
      await api('/api/visits', { method: 'POST', body: JSON.stringify({ customerId, latitude, longitude, accuracyM, notes }) });
      toast('GPS visit check-in recorded.', 'success');
      document.getElementById('gpsNotes').value = '';
      loadVisits();
    } catch (err) { toast(err.message, 'error'); }
  };

  const manualLat = document.getElementById('gpsLat').value;
  const manualLng = document.getElementById('gpsLng').value;
  if (manualLat && manualLng) {
    await submitVisit(Number(manualLat), Number(manualLng));
    return;
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById('gpsLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('gpsLng').value = pos.coords.longitude.toFixed(6);
        submitVisit(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      () => toast('GPS unavailable; enter Latitude/Longitude manually to check in.', 'warning'),
      { timeout: 6000 }
    );
  } else {
    toast('Geolocation not supported; enter coordinates manually.', 'warning');
  }
});

savePending(pending());
loadMasters().then(() => Promise.all([loadMine(), loadVisits()])).catch(e => { document.getElementById('salesMessage').textContent = e.message; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
