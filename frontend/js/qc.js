'use strict';
document.getElementById('qcDate').value = new Date().toISOString().slice(0, 10);

async function loadQcData() {
  try {
    const [runs, inspections] = await Promise.all([
      api('/api/production/runs'),
      api('/api/qc/inspections')
    ]);
    const runSel = document.getElementById('qcRunId');
    runSel.innerHTML = runs.length
      ? runs.map(r => `<option value="${r.id}">#${r.id} · ${esc(r.batch_number || 'No batch')} · ${esc(r.product_name)} (${r.actual_output} pkts)</option>`).join('')
      : '<option value="">No production runs available</option>';

    const tbody = document.getElementById('qcBody');
    tbody.innerHTML = inspections.length ? inspections.map(i => `<tr>
      <td>#${i.id}</td>
      <td>${String(i.inspection_date).slice(0, 10)}</td>
      <td><code>${esc(i.batch_number || '#' + i.run_id)}</code><div class="small text-secondary">${esc(i.product_name)}</div></td>
      <td>${statusBadge(i.status)}</td>
      <td>${i.rejected_qty} pkts</td>
      <td>${esc(i.defect_type || '—')}</td>
      <td>${esc(i.corrective_action || '—')}</td>
      <td>${esc(i.inspector_name)}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="text-center text-secondary py-3">No inspections recorded yet.</td></tr>';
  } catch (e) {
    toast(e.message, 'error');
  }
}

document.getElementById('qcForm').addEventListener('submit', async e => {
  e.preventDefault();
  const checklist = {};
  document.querySelectorAll('.qc-check').forEach(cb => { checklist[cb.value] = cb.checked; });
  try {
    await api('/api/qc/inspections', {
      method: 'POST',
      body: JSON.stringify({
        runId: Number(document.getElementById('qcRunId').value),
        inspectionDate: document.getElementById('qcDate').value,
        status: document.getElementById('qcStatus').value,
        rejectedQty: Number(document.getElementById('qcRejected').value || 0),
        defectType: document.getElementById('qcDefect').value.trim() || null,
        correctiveAction: document.getElementById('qcAction').value.trim() || null,
        checklist
      })
    });
    toast('Quality inspection recorded.', 'success');
    document.getElementById('qcDefect').value = '';
    document.getElementById('qcAction').value = '';
    document.getElementById('qcRejected').value = '0';
    loadQcData();
  } catch (err) { toast(err.message, 'error'); }
});

loadQcData();
