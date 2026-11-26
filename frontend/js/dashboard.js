'use strict';
let revChart = null;
let currentPeriod = 'daily';

document.getElementById('dashTitle').textContent = `${user.role === 'OWNER' ? 'Owner' : user.role === 'ACCOUNTANT' ? 'Finance' : 'Admin'} Overview`;

async function loadSummary() {
  try {
    const d = await api('/api/dashboard/summary');
    document.getElementById('todayOrders').textContent = d.todayOrders;
    document.getElementById('todayValue').textContent = money(d.todayOrderValue);
    document.getElementById('activeProducts').textContent = d.activeProducts;
    document.getElementById('pendingOrders').textContent = d.pendingOrders;
    document.getElementById('varianceAlerts').textContent = d.varianceAlerts;
    document.getElementById('lowStockAlerts').textContent = d.lowStockAlerts;
    document.getElementById('costPerPacket').textContent = money(d.latestCostPerPacket);
    document.getElementById('outstanding').textContent = money(d.outstanding);
    if (Number(d.lowStockAlerts) > 0) document.getElementById('lowStockAlerts').closest('.metric-card')?.classList.add('warning');
    if (Number(d.varianceAlerts) > 0) document.getElementById('varianceAlerts').closest('.metric-card')?.classList.add('danger');
    if (Number(d.outstanding) > 0) document.getElementById('outstanding').closest('.metric-card')?.classList.add('warning');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadRevenueChart(period = 'daily') {
  currentPeriod = period;
  try {
    const days = period === 'monthly' ? 365 : period === 'weekly' ? 90 : 30;
    const rows = await api(`/api/dashboard/revenue-chart?period=${encodeURIComponent(period)}&days=${days}`);
    const canvas = document.getElementById('revenueChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = rows.length ? rows.map(r => String(r.label).slice(0, 10)) : ['No data'];
    const values = rows.length ? rows.map(r => Number(r.revenue)) : [0];
    if (revChart) revChart.destroy();
    revChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Order Revenue (₹)',
          data: values,
          backgroundColor: 'rgba(49, 94, 251, 0.78)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  } catch (e) { console.error(e); }
}

async function loadTables() {
  try {
    const [inv, orders, topCust, prodPerf] = await Promise.all([
      api('/api/inventory/summary'),
      api('/api/orders'),
      api('/api/dashboard/top-customers?limit=5'),
      api('/api/dashboard/production-performance')
    ]);

    const low = inv.filter(x => x.item_type !== 'FINISHED' && Number(x.balance) <= Number(x.reorder_level));
    document.getElementById('lowStockTable').innerHTML = low.length
      ? low.map(x => `<tr><td>${esc(x.name)}</td><td><span class="badge-rejected">${Number(x.balance).toFixed(2)} ${esc(x.base_unit)}</span></td><td>${Number(x.reorder_level).toFixed(2)}</td><td><a href="/purchases.html" class="btn btn-sm btn-outline-primary">Reorder</a></td></tr>`).join('')
      : '<tr><td colspan="4" class="text-center text-secondary py-3">All stock levels are healthy ✓</td></tr>';

    const pending = orders.filter(o => ['SUBMITTED', 'APPROVED', 'INVOICED'].includes(o.status)).slice(0, 8);
    document.getElementById('pendingOrdersTable').innerHTML = pending.length
      ? pending.map(o => `<tr><td>#${o.id}</td><td>${esc(o.customer_name)}</td><td>${statusBadge(o.status)}</td><td>${money(o.total_amount)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="text-center text-secondary py-3">No pending orders</td></tr>';

    document.getElementById('topCustomersTable').innerHTML = topCust.length
      ? topCust.map(c => `<tr><td>${esc(c.name)}</td><td>${c.order_count}</td><td><strong>${money(c.revenue)}</strong></td></tr>`).join('')
      : '<tr><td colspan="3" class="text-center text-secondary py-3">No sales yet</td></tr>';

    document.getElementById('prodPerfTable').innerHTML = prodPerf.length
      ? prodPerf.slice(0, 6).map(r => `<tr>
          <td>${esc(r.batch_number || '#' + r.id)}</td>
          <td>${esc(r.product_name)}</td>
          <td>${r.actual_output} / ${r.expected_output}</td>
          <td class="${Math.abs(Number(r.yield_variance_pct)) > 3 ? 'text-danger fw-bold' : ''}">${Number(r.yield_variance_pct || 0).toFixed(1)}%</td>
          <td>${money(r.cost_per_packet)}</td>
          <td class="${Number(r.margin_per_packet) >= 0 ? 'text-success' : 'text-danger'} fw-bold">${money(r.margin_per_packet)}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="text-center text-secondary py-3">No production runs yet</td></tr>';
  } catch (e) { console.error(e); }

  if (['OWNER', 'ACCOUNTANT'].includes(user.role)) {
    try {
      const act = await api('/api/dashboard/employee-activity?limit=10');
      document.getElementById('activityTable').innerHTML = act.length
        ? act.map(a => `<tr><td>${esc(a.user_name || 'System')}</td><td><code>${esc(a.action)}</code></td><td>${esc(a.entity_type)} #${a.entity_id}</td><td class="small text-secondary">${new Date(a.created_at).toLocaleTimeString('en-IN')}</td></tr>`).join('')
        : '<tr><td colspan="4" class="text-center text-secondary py-3">No recent activity</td></tr>';
    } catch (e) { console.error(e); }
  } else {
    document.getElementById('activityCard')?.classList.add('d-none');
  }
}

document.querySelectorAll('.chart-period').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-period').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-outline-primary'); });
    btn.classList.remove('btn-outline-primary'); btn.classList.add('btn-primary');
    loadRevenueChart(btn.dataset.period);
  });
});

function refreshAll() {
  loadSummary();
  loadRevenueChart(currentPeriod);
  loadTables();
}

document.getElementById('refreshDashBtn')?.addEventListener('click', refreshAll);
refreshAll();
