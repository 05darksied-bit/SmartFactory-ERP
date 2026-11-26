'use strict';
const cache = {};
const endpoints = {
  sales: 'sales-register',
  stock: 'stock-ledger',
  production: 'production',
  purchases: 'purchases',
  gst: 'gst-summary',
  receivables: 'receivables',
  costing: 'costing',
  stockSummary: 'stock-summary',
  collections: 'collections'
};

function dateParams() {
  const from = document.getElementById('fromDate')?.value || '';
  const to = document.getElementById('toDate')?.value || '';
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return q;
}

async function loadReport(key) {
  const q = dateParams();
  cache[key] = await api(`/api/reports/${endpoints[key]}?${q}`);
  document.getElementById('report_' + key).textContent = JSON.stringify(cache[key], null, 2);
}

for (const key of Object.keys(endpoints)) {
  const b = document.getElementById('btn_' + key);
  if (b) {
    b.onclick = () => loadReport(key).catch(e => {
      document.getElementById('report_' + key).textContent = e.message;
      toast(e.message, 'error');
    });
  }
  const d = document.getElementById('csv_' + key);
  if (d) {
    d.onclick = () => downloadBlob(`/api/reports/${endpoints[key]}/excel?${dateParams()}`, `${endpoints[key]}.csv`)
      .catch(e => toast(e.message, 'error'));
  }
}

document.getElementById('tallyXmlBtn')?.addEventListener('click', () => {
  downloadBlob(`/api/reports/tally/xml?${dateParams()}`, 'tally-sales-vouchers.xml').catch(e => toast(e.message, 'error'));
});

document.querySelectorAll('[data-report-pdf]').forEach(a => a.addEventListener('click', async e => {
  e.preventDefault();
  try {
    const q = dateParams();
    const url = a.getAttribute('href').split('?')[0] + (q.toString() ? '?' + q.toString() : '');
    await downloadBlob(url, `${url.split('/').at(-2)}.pdf`);
  } catch (err) { toast(err.message, 'error'); }
}));
