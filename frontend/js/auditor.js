'use strict';
function getDates() {
  return {
    from: document.getElementById('dateFrom')?.value || '',
    to: document.getElementById('dateTo')?.value || ''
  };
}

function queryStr(extra = {}) {
  const { from, to } = getDates();
  const q = new URLSearchParams(extra);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return q.toString();
}

async function loadGst() {
  const tbody = document.getElementById('gstBody');
  try {
    const rows = await api('/api/reports/gst-summary?' + queryStr());
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${esc(r.financial_year)}</td><td>${r.invoice_count}</td>
      <td>${money(r.taxable)}</td><td>${money(r.cgst)}</td>
      <td>${money(r.sgst)}</td><td>${money(r.igst)}</td><td><strong>${money(r.gross)}</strong></td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-secondary">No invoices in period.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadReceivables() {
  const tbody = document.getElementById('receivablesBody');
  try {
    const rows = await api('/api/reports/receivables?' + queryStr());
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${esc(r.customer)}</td><td>${esc(r.invoice_number)}</td>
      <td>${money(r.invoiced)}</td><td>${money(r.collected)}</td>
      <td class="${Number(r.outstanding) > 0 ? 'text-danger fw-bold' : 'text-success fw-bold'}">${money(r.outstanding)}</td>
      <td>${r.age_days}d</td><td><span class="badge text-bg-secondary">${esc(r.ageing_bucket)}</span></td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-secondary">No receivables in period.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadCollections() {
  const tbody = document.getElementById('collectionsBody');
  try {
    const rows = await api('/api/reports/collections?' + queryStr());
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${String(r.payment_date).slice(0, 10)}</td><td>${esc(r.customer)}</td>
      <td>${esc(r.invoice_number)}</td><td><strong>${money(r.amount)}</strong></td>
      <td>${esc(r.mode || '—')}</td><td>${esc(r.reference_no || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-secondary">No collections in period.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadUserActivity() {
  const tbody = document.getElementById('userActivityBody');
  try {
    const rows = await api('/api/audit/user-activity');
    tbody.innerHTML = rows.map(u => `<tr>
      <td>${esc(u.name)}</td><td><span class="badge text-bg-light">${esc(u.role)}</span></td>
      <td><strong>${u.total_actions}</strong></td>
      <td class="small text-secondary">${u.last_activity ? new Date(u.last_activity).toLocaleString('en-IN') : '—'}</td>
    </tr>`).join('');
  } catch (e) { console.error(e); }
}

async function loadAuditLogs() {
  const tbody = document.getElementById('auditBody');
  const entityType = document.getElementById('auditEntityFilter')?.value || '';
  try {
    const rows = await api('/api/audit/logs?' + queryStr({ limit: '150', ...(entityType ? { entityType } : {}) }));
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td class="small text-nowrap">${new Date(r.created_at).toLocaleString('en-IN')}</td>
      <td>${esc(r.user_name || 'System')}</td>
      <td><code>${esc(r.action)}</code></td>
      <td>${esc(r.entity_type)}</td>
      <td>#${r.entity_id}</td>
      <td class="small text-secondary">${esc(r.ip_address || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-secondary">No audit logs in period.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

function loadAll() {
  loadGst();
  loadReceivables();
  loadCollections();
  loadUserActivity();
  loadAuditLogs();
}

document.querySelectorAll('.btn-exp-pdf').forEach(btn => {
  btn.addEventListener('click', () => downloadBlob(`/api/reports/${btn.dataset.report}/pdf?${queryStr()}`, `${btn.dataset.report}.pdf`).catch(e => toast(e.message, 'error')));
});
document.querySelectorAll('.btn-exp-xls').forEach(btn => {
  btn.addEventListener('click', () => downloadBlob(`/api/reports/${btn.dataset.report}/excel?${queryStr()}`, `${btn.dataset.report}.csv`).catch(e => toast(e.message, 'error')));
});

const today = new Date();
const ago90 = new Date(today); ago90.setDate(ago90.getDate() - 90);
document.getElementById('dateFrom').value = ago90.toISOString().slice(0, 10);
document.getElementById('dateTo').value = today.toISOString().slice(0, 10);
document.getElementById('applyDates').addEventListener('click', loadAll);
document.getElementById('tallyXmlBtn')?.addEventListener('click', () => {
  downloadBlob(`/api/reports/tally/xml?${queryStr()}`, 'tally-sales-vouchers.xml').catch(e => toast(e.message, 'error'));
});
document.getElementById('auditEntityFilter').addEventListener('change', loadAuditLogs);
loadAll();
