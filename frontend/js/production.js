'use strict';
let bomItems = [];
let currentProduct = null;

document.getElementById('productionDate').value = new Date().toISOString().slice(0, 10);

async function loadProducts() {
  try {
    const prods = await api('/api/masters/products');
    const sel = document.getElementById('productId');
    sel.innerHTML = prods.length
      ? prods.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.pack_size)}</option>`).join('')
      : '<option value="">No products</option>';
    if (prods.length) await loadBom(prods[0].id);
  } catch (e) {
    toast('Failed to load products: ' + e.message, 'error');
  }
}

async function loadBom(productId) {
  const container = document.getElementById('bomInputs');
  if (!productId) {
    bomItems = [];
    container.textContent = 'Select a product.';
    return;
  }
  try {
    const data = await api(`/api/production/bom/${productId}`);
    currentProduct = data.product;
    bomItems = data.items || [];
    renderBomInputs();
  } catch (e) {
    bomItems = [];
    container.textContent = 'Active BOM not found for this product.';
  }
}

function renderBomInputs() {
  const container = document.getElementById('bomInputs');
  const batchCount = Number(document.getElementById('batchCount').value) || 1;
  const expected = currentProduct ? Number(currentProduct.expected_yield) * batchCount : 0;
  document.getElementById('expectedYieldBadge').textContent = `Expected output: ${expected} packets`;

  const actualOut = Number(document.getElementById('actualOutput').value) || 0;
  const wastage = Math.max(0, expected - actualOut);
  document.getElementById('actualWastage').value = wastage;
  const yieldVar = expected > 0 ? (((actualOut - expected) / expected) * 100).toFixed(2) : '0.00';
  document.getElementById('liveYieldPreview').textContent = `Calculated wastage: ${wastage} pkts · Yield variance: ${yieldVar}%`;

  if (!bomItems.length) {
    container.textContent = 'No BOM items configured for this product.';
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm mb-0 align-middle">
        <thead><tr><th>Material</th><th>Type</th><th>Available Stock</th><th>Planned Qty</th><th>Actual Used</th><th>Unit</th></tr></thead>
        <tbody>
          ${bomItems.map(line => {
            const planned = Number((Number(line.quantity_per_batch) * batchCount).toFixed(4));
            const avail = Number(line.current_balance || 0);
            const lowCls = avail < planned ? 'text-danger fw-bold' : 'text-success';
            return `<tr>
              <td><strong>${esc(line.item_name)}</strong></td>
              <td><span class="badge text-bg-light">${esc(line.item_type)}</span></td>
              <td class="${lowCls}">${avail.toFixed(2)} ${esc(line.base_unit)}</td>
              <td>${planned}</td>
              <td><input type="number" step="0.001" min="0" class="form-control form-control-sm bom-actual" data-item-id="${line.item_id}" value="${planned}" style="width:110px"></td>
              <td>${esc(line.unit)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadAnalyticsAndRuns() {
  try {
    const [stats, rows] = await Promise.all([
      api('/api/production/analytics'),
      api('/api/production/runs')
    ]);
    document.getElementById('statRuns').textContent = stats.total_runs || 0;
    document.getElementById('statOutput').textContent = `${Number(stats.total_output || 0)} pkts`;
    document.getElementById('statWastage').textContent = `${Number(stats.total_wastage || 0)} pkts`;
    document.getElementById('statAvgCost').textContent = money(stats.avg_cost_per_packet || 0);

    document.getElementById('productionRuns').innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td>#${r.id}</td>
          <td><code>${esc(r.batch_number || '—')}</code></td>
          <td>${r.production_date ? String(r.production_date).slice(0, 10) : new Date(r.created_at).toLocaleDateString('en-IN')}</td>
          <td>${esc(r.product_name)}</td>
          <td>${r.expected_output}</td>
          <td><strong>${r.actual_output}</strong></td>
          <td>${r.actual_wastage}</td>
          <td>${money(r.cost_per_packet)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="9" class="text-center text-secondary py-3">No production runs yet.</td></tr>';
  } catch (e) {
    document.getElementById('productionRuns').textContent = e.message;
  }
}

document.getElementById('productId').addEventListener('change', e => loadBom(e.target.value));
document.getElementById('batchCount').addEventListener('input', renderBomInputs);
document.getElementById('actualOutput').addEventListener('input', renderBomInputs);

document.getElementById('productionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const ok = await confirmAction('Post Production Run', 'Confirm raw material consumption and finished-goods receipt?');
  if (!ok) return;
  const out = document.getElementById('productionMessage');
  out.textContent = 'Posting production run…';
  out.className = 'mt-3 small text-secondary';
  try {
    const actualConsumption = {};
    document.querySelectorAll('.bom-actual').forEach(inp => {
      actualConsumption[inp.dataset.itemId] = Number(inp.value);
    });
    const result = await api('/api/production/runs', {
      method: 'POST',
      body: JSON.stringify({
        productId: Number(document.getElementById('productId').value),
        batchNumber: document.getElementById('batchNumber').value.trim() || undefined,
        productionDate: document.getElementById('productionDate').value,
        batchCount: Number(document.getElementById('batchCount').value),
        actualOutput: Number(document.getElementById('actualOutput').value),
        actualWastage: Number(document.getElementById('actualWastage').value),
        damagedPouches: Number(document.getElementById('damagedPouches').value),
        labourCost: Number(document.getElementById('labourCost').value),
        utilityCost: Number(document.getElementById('utilityCost').value),
        actualConsumption
      })
    });
    out.className = 'mt-3 small message-success';
    out.textContent = `Run #${result.runId} (${result.batchNumber}) posted. Expected ${result.expectedOutput}; actual ${result.actualOutput}; yield ${result.yieldVariancePercent.toFixed(2)}%; materials ₹${result.materialCost.toFixed(2)}; total cost ₹${result.totalCost.toFixed(2)}; cost/packet ₹${result.costPerPacket.toFixed(2)}.`;
    toast(`Production run #${result.runId} posted!`, 'success');
    await loadBom(document.getElementById('productId').value);
    await loadAnalyticsAndRuns();
  } catch (err) {
    out.className = 'mt-3 small message-error';
    out.textContent = err.message;
    toast(err.message, 'error');
  }
});

loadProducts();
loadAnalyticsAndRuns();
