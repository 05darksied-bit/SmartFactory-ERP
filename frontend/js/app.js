'use strict';
const token = localStorage.getItem('sf_token');
if (!token) location.href = '/';
const user = JSON.parse(localStorage.getItem('sf_user') || '{}');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function money(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));
}

function statusBadge(status) {
  const key = String(status || 'SUBMITTED').toLowerCase();
  const known = ['submitted', 'approved', 'invoiced', 'dispatched', 'rejected', 'passed', 'failed', 'conditional', 'pending', 'posted'];
  const cls = known.includes(key) ? key : 'submitted';
  return `<span class="badge-${cls}">${esc(status)}</span>`;
}

function toast(message, type = 'info', duration = 4200) {
  let container = document.getElementById('sf-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sf-toast-container';
    container.className = 'sf-toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `sf-toast ${type}`;
  const icon = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ';
  const iconSpan = document.createElement('span');
  iconSpan.textContent = icon;
  const msgSpan = document.createElement('span');
  msgSpan.textContent = String(message || '');
  t.appendChild(iconSpan);
  t.appendChild(msgSpan);
  container.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, duration);
}

function confirmAction(title, message) {
  return new Promise(resolve => {
    if (typeof bootstrap === 'undefined') {
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    let modalEl = document.getElementById('sfConfirmModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'sfConfirmModal';
      modalEl.className = 'modal fade';
      modalEl.tabIndex = -1;
      modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title" id="sfConfirmTitle"></h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body" id="sfConfirmBody"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" id="sfConfirmCancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="sfConfirmOk">Confirm</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modalEl);
    }
    document.getElementById('sfConfirmTitle').textContent = title;
    document.getElementById('sfConfirmBody').textContent = message;
    const modal = new bootstrap.Modal(modalEl);
    let settled = false;
    const okBtn = document.getElementById('sfConfirmOk');
    const onOk = () => { settled = true; modal.hide(); resolve(true); };
    const onHide = () => { if (!settled) resolve(false); okBtn.removeEventListener('click', onOk); modalEl.removeEventListener('hidden.bs.modal', onHide); };
    okBtn.addEventListener('click', onOk);
    modalEl.addEventListener('hidden.bs.modal', onHide);
    modal.show();
  });
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
  } catch (networkErr) {
    const err = new Error('Network unavailable. Check your connection.');
    err.isNetwork = true;
    throw err;
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem('sf_token');
    localStorage.removeItem('sf_user');
    location.href = '/';
    throw new Error('Session expired');
  }
  if (!response.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function downloadBlob(url, filename) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Download failed');
  }
  const blob = await response.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
}

// Role-based navigation & page guard
(function initNavigation() {
  const ROLE_NAV = {
    OWNER: [
      { href: '/dashboard.html', icon: '▦', label: 'Overview', ta: 'மேற்பார்வை' },
      { href: '/masters.html', icon: '⚙', label: 'Masters & Users', ta: 'முதன்மை தரவு' },
      { href: '/orders.html', icon: '⇄', label: 'Sales orders', ta: 'விற்பனை ஆர்டர்கள்' },
      { href: '/sales.html', icon: '＋', label: 'New order', ta: 'புதிய ஆர்டர்' },
      { href: '/production.html', icon: '⚙', label: 'Production', ta: 'உற்பத்தி' },
      { href: '/qc.html', icon: '✓', label: 'Quality control', ta: 'தரக் கட்டுப்பாடு' },
      { href: '/purchases.html', icon: '＋', label: 'Purchases', ta: 'கொள்முதல்' },
      { href: '/suppliers.html', icon: '▤', label: 'Suppliers', ta: 'சப்ளையர்கள்' },
      { href: '/inventory.html', icon: '▤', label: 'Inventory', ta: 'சரக்கு இருப்பு' },
      { href: '/payments.html', icon: '₹', label: 'Collections', ta: 'வசூல்' },
      { href: '/reports.html', icon: '▥', label: 'Reports', ta: 'அறிக்கைகள்' },
      { href: '/auditor.html', icon: '⚿', label: 'Audit & Logs', ta: 'தணிக்கை' }
    ],
    ADMIN: [
      { href: '/dashboard.html', icon: '▦', label: 'Overview', ta: 'மேற்பார்வை' },
      { href: '/masters.html', icon: '⚙', label: 'Masters', ta: 'முதன்மை தரவு' },
      { href: '/orders.html', icon: '⇄', label: 'Sales orders', ta: 'விற்பனை ஆர்டர்கள்' },
      { href: '/production.html', icon: '⚙', label: 'Production', ta: 'உற்பத்தி' },
      { href: '/qc.html', icon: '✓', label: 'Quality control', ta: 'தரக் கட்டுப்பாடு' },
      { href: '/purchases.html', icon: '＋', label: 'Purchases', ta: 'கொள்முதல்' },
      { href: '/suppliers.html', icon: '▤', label: 'Suppliers', ta: 'சப்ளையர்கள்' },
      { href: '/inventory.html', icon: '▤', label: 'Inventory', ta: 'சரக்கு இருப்பு' },
      { href: '/payments.html', icon: '₹', label: 'Collections', ta: 'வசூல்' },
      { href: '/reports.html', icon: '▥', label: 'Reports', ta: 'அறிக்கைகள்' },
      { href: '/auditor.html', icon: '⚿', label: 'Audit & Logs', ta: 'தணிக்கை' }
    ],
    SALESMAN: [
      { href: '/sales.html', icon: '＋', label: 'New order', ta: 'புதிய ஆர்டர்' },
      { href: '/orders.html', icon: '⇄', label: 'My orders', ta: 'என் ஆர்டர்கள்' }
    ],
    PRODUCTION: [
      { href: '/production.html', icon: '⚙', label: 'Production', ta: 'உற்பத்தி' },
      { href: '/masters.html', icon: '▤', label: 'Masters (View)', ta: 'முதன்மை தரவு' },
      { href: '/qc.html', icon: '✓', label: 'Quality control', ta: 'தரக் கட்டுப்பாடு' },
      { href: '/purchases.html', icon: '＋', label: 'Purchases', ta: 'கொள்முதல்' },
      { href: '/suppliers.html', icon: '▤', label: 'Suppliers', ta: 'சப்ளையர்கள்' },
      { href: '/inventory.html', icon: '▤', label: 'Inventory', ta: 'சரக்கு இருப்பு' }
    ],
    ACCOUNTANT: [
      { href: '/auditor.html', icon: '⚿', label: 'Audit & Logs', ta: 'தணிக்கை' },
      { href: '/reports.html', icon: '▥', label: 'Reports', ta: 'அறிக்கைகள்' },
      { href: '/masters.html', icon: '▤', label: 'Masters (View)', ta: 'முதன்மை தரவு' },
      { href: '/dashboard.html', icon: '▦', label: 'Overview', ta: 'மேற்பார்வை' },
      { href: '/inventory.html', icon: '▤', label: 'Inventory', ta: 'சரக்கு இருப்பு' },
      { href: '/payments.html', icon: '₹', label: 'Collections', ta: 'வசூல்' }
    ]
  };

  const lang = localStorage.getItem('sf_lang') || 'en';
  const links = ROLE_NAV[user.role] || ROLE_NAV.ADMIN;
  const currentPath = location.pathname;
  if (currentPath !== '/' && currentPath !== '/index.html' && !links.some(l => l.href === currentPath)) {
    location.href = links[0].href;
    return;
  }

  const ROLE_TA = {
    OWNER: 'உரிமையாளர்',
    ADMIN: 'நிர்வாகம்',
    SALESMAN: 'விற்பனையாளர்',
    PRODUCTION: 'உற்பத்தி',
    ACCOUNTANT: 'தணிக்கையாளர்'
  };

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    const homeHref = links[0].href;
    sidebar.innerHTML = `
      <a class="brand" href="${homeHref}"><span class="brand-mark">SF</span><span>SmartFactory</span></a>
      <div class="nav-label">${esc(lang === 'ta' ? (ROLE_TA[user.role] || 'பணிமனை') : (user.role || 'WORKSPACE'))}</div>
      ${links.map(l => `<a class="nav-link${l.href === currentPath ? ' active' : ''}" href="${l.href}">${l.icon} &nbsp; ${esc(lang === 'ta' ? l.ta : l.label)}</a>`).join('')}
      <div class="sidebar-bottom">
        <button id="langToggleBtn" class="btn btn-outline-light btn-sm w-100 mb-2">${lang === 'ta' ? '🌐 English' : '🌐 தமிழ் (Tamil)'}</button>
        <div id="userInfo" class="small text-white-50 mb-3"></div>
        <button id="logoutBtn" class="btn btn-outline-light btn-sm w-100">${lang === 'ta' ? 'வெளியேறு' : 'Sign out'}</button>
      </div>`;
  }

  document.getElementById('langToggleBtn')?.addEventListener('click', () => {
    localStorage.setItem('sf_lang', lang === 'ta' ? 'en' : 'ta');
    location.reload();
  });

  if (lang === 'ta') {
    const TA_DICT = {
      // Common & Topbar
      '● Online': '● இணைப்பில் உள்ளது',
      '● Offline': '● இணையம் இல்லை',
      '● System operational': '● அமைப்பு செயல்படுகிறது',
      '↻ Refresh': '↻ புதுப்பி',
      'Refresh': 'புதுப்பி',
      'Cancel': 'ரத்து செய்',
      'Confirm': 'உறுதிப்படுத்து',
      'Save': 'சேமி',
      'Edit': 'திருத்து',
      'Delete': 'நீக்கு',
      'Details': 'விவரம்',
      'History': 'வரலாறு',
      'Actions': 'செயல்கள்',
      'Action': 'செயல்',
      'Status': 'நிலை',
      'Date': 'தேதி',
      'Time': 'நேரம்',
      'Total': 'மொத்தம்',
      'Loading…': 'ஏற்றுகிறது…',
      'Loading...': 'ஏற்றுகிறது…',
      'Activate': 'செயல்படுத்து',
      'Deactivate': 'முடக்கு',
      'Approve': 'அங்கீகரி',
      'Prev': 'முந்தைய',
      'Next': 'அடுத்த',
      'Close': 'மூடு',
      'Record': 'பதிவு செய்',
      'Return': 'திருப்பி அனுப்பு',

      // Dashboard (dashboard.html)
      'FACTORY OPERATIONS': 'தொழிற்சாலை செயல்பாடுகள்',
      'Overview': 'மேற்பார்வை',
      'Owner Overview': 'உரிமையாளர் மேற்பார்வை',
      'Admin Overview': 'நிர்வாக மேற்பார்வை',
      'Finance Overview': 'நிதி மேற்பார்வை',
      "Today's orders": 'இன்றைய ஆர்டர்கள்',
      "Today's order value": 'இன்றைய ஆர்டர் மதிப்பு',
      'Orders received today': 'இன்று பெற்ற ஆர்டர்கள்',
      'Submitted order value': 'சமர்ப்பித்த ஆர்டர் மதிப்பு',
      'Active products': 'செயலில் உள்ள பொருட்கள்',
      'Product catalogue': 'பொருள் பட்டியல்',
      'Pending workflow': 'நிலுவை பணிகள்',
      'Awaiting next action': 'அடுத்த நடவடிக்கைக்காக காத்திருக்கிறது',
      'Variance alerts': 'வேறுபாடு எச்சரிக்கைகள்',
      'Yield / material > 3%': 'மகசூல் / மூலப்பொருள் > 3%',
      'Receivables outstanding': 'வரவேண்டிய நிலுவை',
      'Uncollected invoices': 'வசூலிக்கப்படாத பில்கள்',
      'Low-stock alerts': 'குறைந்த சரக்கு எச்சரிக்கைகள்',
      'At or below reorder': 'மறு ஆர்டர் அளவிற்கு கீழ்',
      'Latest cost / packet': 'சமீபத்திய விலை / பாக்கெட்',
      'Manufacturing unit cost': 'உற்பத்தி அலகு செலவு',
      'REVENUE ANALYTICS': 'வருவாய் பகுப்பாய்வு',
      'Sales trend': 'விற்பனை போக்கு',
      'Daily': 'தினசரி',
      'Weekly': 'வாராந்திர',
      'Monthly': 'மாதாந்திர',
      'TOP CUSTOMERS': 'முதன்மை வாடிக்கையாளர்கள்',
      'Revenue leaders': 'அதிக வருவாய் தருபவர்கள்',
      'Orders': 'ஆர்டர்கள்',
      'Revenue': 'வருவாய்',
      'No sales yet': 'இன்னும் விற்பனை இல்லை',
      'INVENTORY ALERTS': 'சரக்கு எச்சரிக்கைகள்',
      'Low-stock items': 'குறைந்த சரக்கு பொருட்கள்',
      'View ledger': 'பேரேடு பார்',
      'Item': 'பொருள்',
      'Balance': 'இருப்பு',
      'Reorder': 'மறு ஆர்டர்',
      'All stock levels are healthy ✓': 'அனைத்து சரக்கு இருப்புகளும் சரியாக உள்ளன ✓',
      'WORKFLOW QUEUE': 'பணி வரிசை',
      'Pending orders': 'நிலுவை ஆர்டர்கள்',
      'Manage orders': 'ஆர்டர்களை நிர்வகி',
      'Value': 'மதிப்பு',
      'No pending orders': 'நிலுவை ஆர்டர்கள் இல்லை',
      'PROFIT & COST ANALYSIS': 'லாபம் & செலவு பகுப்பாய்வு',
      'Production performance': 'உற்பத்தி செயல்திறன்',
      'Batch': 'பேட்ச்',
      'Output': 'உற்பத்தி',
      'Yield Var': 'மகசூல் வேறுபாடு',
      'Cost/Pkt': 'செலவு/பாக்கெட்',
      'Margin/Pkt': 'லாபம்/பாக்கெட்',
      'No production runs yet': 'இன்னும் உற்பத்தி பதிவுகள் இல்லை',
      'EMPLOYEE ACTIVITY': 'பணியாளர் செயல்பாடு',
      'Recent system actions': 'சமீபத்திய செயல்பாடுகள்',
      'User': 'பயனர்',
      'Entity': 'பிரிவு',
      'No recent activity': 'சமீபத்திய செயல்பாடு இல்லை',

      // Salesman Workspace (sales.html)
      'FIELD SALES': 'கள விற்பனை',
      'Salesman workspace': 'விற்பனையாளர் பணிமனை',
      'MONTHLY SALES TARGET PROGRESS': 'மாதாந்திர விற்பனை இலக்கு',
      'Create multi-product order': 'புதிய ஆர்டர் உருவாக்கு',
      'Search customer': 'வாடிக்கையாளர் தேடல்',
      'Filter by name or state…': 'பெயர் அல்லது மாநிலம் மூலம் தேடு…',
      'Customer': 'வாடிக்கையாளர்',
      'Select a customer to view outstanding balance & credit limit.': 'நிலுவைத் தொகை மற்றும் கடன் வரம்பை பார்க்க வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும்.',
      'Outstanding': 'நிலுவை',
      'Credit limit': 'கடன் வரம்பு',
      'Invoiced': 'பில் தொகை',
      'Product': 'பொருள்',
      'Qty (packets)': 'அளவு (பாக்கெட்)',
      'Price (₹)': 'விலை (₹)',
      '+ Add': '+ சேர்',
      'Qty': 'அளவு',
      'Price': 'விலை',
      'Line Total': 'வரி மொத்தம்',
      'Cart is empty. Add products above.': 'கூடை காலியாக உள்ளது. மேலே பொருட்களைச் சேர்க்கவும்.',
      'ORDER TOTAL': 'ஆர்டர் மொத்தம்',
      'Submit order →': 'ஆர்டர் சமர்ப்பி →',
      'Offline sync queue': 'ஆஃப்லைன் ஒத்திசைவு வரிசை',
      '↻ Sync now': '↻ ஒத்திசை',
      'No offline orders waiting.': 'ஆஃப்லைன் ஆர்டர்கள் எதுவும் இல்லை.',
      'Selected customer order history': 'தேர்ந்தெடுத்த வாடிக்கையாளர் ஆர்டர் வரலாறு',
      'Order': 'ஆர்டர்',
      'Select a customer': 'வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும்',
      'No prior orders': 'முந்தைய ஆர்டர்கள் இல்லை',
      'GPS route check-in': 'GPS வருகைப் பதிவு',
      'Latitude (auto)': 'அட்சரேகை (தானியங்கி)',
      'Longitude (auto)': 'தீர்க்கரேகை (தானியங்கி)',
      'Visit notes (optional)': 'வருகை குறிப்பு (விருப்பம்)',
      '📍 Check In': '📍 பதிவு செய்',
      'Coordinates': 'ஆயத்தொலைவுகள்',
      'No visits logged yet.': 'இதுவரை வருகை பதிவு இல்லை.',
      'My recent orders': 'என் சமீபத்திய ஆர்டர்கள்',
      'No customer sales yet.': 'இன்னும் வாடிக்கையாளர் விற்பனை இல்லை.',
      'No orders yet.': 'இன்னும் ஆர்டர்கள் இல்லை.',

      // Orders (orders.html)
      'SALES MANAGEMENT': 'விற்பனை மேலாண்மை',
      'Sales orders': 'விற்பனை ஆர்டர்கள்',
      'Order-to-Dispatch Workflow': 'ஆர்டர் முதல் அனுப்புதல் வரை',
      'All': 'அனைத்தும்',
      'Submitted': 'சமர்ப்பிக்கப்பட்டது',
      'Approved': 'அங்கீகரிக்கப்பட்டது',
      'Invoiced': 'பில் செய்யப்பட்டது',
      'Dispatched': 'அனுப்பப்பட்டது',
      'Rejected': 'நிராகரிக்கப்பட்டது',
      'Search customer or #order': 'வாடிக்கையாளர் அல்லது #ஆர்டர் தேடு',
      'Salesman': 'விற்பனையாளர்',
      'Verify': 'சரிபார்',
      'Reject': 'நிராகரி',
      'GST invoice': 'GST பில்',
      'Dispatch': 'அனுப்பு',
      'PDF': 'PDF',
      'e-Invoice': 'e-பில்',
      'Share': 'பகிர்',
      'Cancel Inv': 'பில் ரத்து',
      'No matching orders found.': 'பொருந்தும் ஆர்டர்கள் இல்லை.',
      'Order Details': 'ஆர்டர் விவரங்கள்',
      'Save Changes': 'மாற்றங்களைச் சேமி',
      'Dispatch date': 'அனுப்பும் தேதி',
      'Reference / LR no.': 'குறிப்பு / LR எண்',
      'Post Dispatch': 'அனுப்புதலைப் பதிவு செய்',
      'Rejection reason': 'நிராகரிப்பு காரணம்',
      'Confirm Rejection': 'நிராகரிப்பை உறுதிப்படுத்து',
      'e-Invoice & e-Way Bill (NIC Mock)': 'e-பில் & e-வே பில் (NIC மாதிரி)',

      // Production (production.html)
      'MANUFACTURING': 'உற்பத்தி',
      'Production run': 'உற்பத்தி பதிவு',
      'BOM-driven & Batch-tracked': 'BOM & பேட்ச் கண்காணிப்பு',
      'Total Runs': 'மொத்த உற்பத்தி',
      'Total Good Output': 'நல்ல உற்பத்தி',
      'Total Wastage': 'மொத்த கழிவு',
      'Avg Cost / Packet': 'சராசரி விலை / பாக்கெட்',
      'Record a production run': 'புதிய உற்பத்தி பதிவு செய்',
      'Select a product to load its active BOM, review planned raw-material quantities against live stock, and post output & costing in one atomic transaction.': 'பொருளைத் தேர்ந்தெடுத்து BOM மற்றும் மூலப்பொருள் இருப்பை சரிபார்த்து உற்பத்தி மற்றும் செலவை பதிவு செய்யவும்.',
      'Batch count': 'பேட்ச் எண்ணிக்கை',
      'Batch number': 'பேட்ச் எண்',
      'Auto-generated if blank': 'காலியாக விட்டால் தானாக உருவாகும்',
      'Production date': 'உற்பத்தி தேதி',
      'ACTIVE BOM & ACTUAL MATERIAL CONSUMPTION': 'செயலில் உள்ள BOM & மூலப்பொருள் பயன்பாடு',
      'Select a product to load BOM…': 'BOM ஏற்ற பொருளைத் தேர்ந்தெடுக்கவும்…',
      'Good output (packets)': 'நல்ல உற்பத்தி (பாக்கெட்)',
      'Yield loss / wastage (pkts)': 'உற்பத்தி இழப்பு / கழிவு',
      'Damaged pouches': 'சேதமான பைகள்',
      'Labour cost (₹)': 'தொழிலாளர் செலவு (₹)',
      'Gas / power (₹)': 'எரிவாயு / மின்சாரம் (₹)',
      'Post production run': 'உற்பத்தியை பதிவு செய்',
      'Recent production runs': 'சமீபத்திய உற்பத்தி விவரங்கள்',
      'Run': 'ஓட்டம்',
      'Expected': 'எதிர்பார்த்தது',
      'Actual': 'உண்மையானது',
      'Wastage': 'கழிவு',
      'Cost / packet': 'விலை / பாக்கெட்',
      'Material': 'மூலப்பொருள்',
      'Type': 'வகை',
      'Available Stock': 'கிடைக்கும் இருப்பு',
      'Planned Qty': 'திட்டமிட்ட அளவு',
      'Actual Used': 'பயன்படுத்திய அளவு',
      'Unit': 'அலகு',

      // Quality Control (qc.html)
      'QUALITY ASSURANCE': 'தர உறுதி',
      'Quality control & inspections': 'தரக் கட்டுப்பாடு & ஆய்வுகள்',
      'Food Safety & Defect Tracking': 'உணவு பாதுகாப்பு & குறைபாடு கண்காணிப்பு',
      'Record production quality inspection': 'தர ஆய்வு பதிவு செய்',
      'Production run': 'உற்பத்தி பதிவு',
      'Inspection date': 'ஆய்வு தேதி',
      'Rejected qty (packets)': 'நிராகரிக்கப்பட்ட அளவு',
      'Quality checklist': 'தர சரிபார்ப்பு பட்டியல்',
      'Pouch seal integrity': 'பை சீல் உறுதித்தன்மை',
      'Net weight (200g ± 2g)': 'நிகர எடை (200g ± 2g)',
      'Texture & crispness': 'தன்மை & மொறுமொறுப்பு',
      'Batch & expiry print legible': 'பேட்ச் & காலாவதி அச்சு தெளிவு',
      'Defect type (if any)': 'குறைபாடு வகை',
      'Corrective action': 'திருத்த நடவடிக்கை',
      'Save Inspection': 'ஆய்வை சேமி',
      'Inspection & corrective action history': 'ஆய்வு & திருத்த நடவடிக்கை வரலாறு',
      'Batch / Product': 'பேட்ச் / பொருள்',
      'Rejected': 'நிராகரிக்கப்பட்டது',
      'Defect': 'குறைபாடு',
      'Corrective Action': 'திருத்த நடவடிக்கை',
      'Inspector': 'ஆய்வாளர்',

      // Inventory (inventory.html)
      'STOCK CONTROL': 'சரக்கு கட்டுப்பாடு',
      'Inventory, batches & adjustments': 'சரக்கு இருப்பு & பேட்ச் விவரம்',
      'Batch & expiry tracking (FEFO order)': 'பேட்ச் & காலாவதி கண்காணிப்பு (FEFO)',
      'First-Expired-First-Out': 'முதலில் காலாவதியாகும் பொருள் முதலில்',
      'Remaining': 'மீதம்',
      'Expiry Date': 'காலாவதி தேதி',
      'Days Left': 'மீதமுள்ள நாட்கள்',
      'Stock adjustments (approval workflow)': 'சரக்கு திருத்தங்கள் (அனுமதி)',
      '+ Request Adjustment': '+ திருத்தம் கோரு',
      'Direction': 'திசை',
      'Reason': 'காரணம்',
      'Latest stock movements': 'சமீபத்திய சரக்கு நகர்வுகள்',
      'Movement': 'நகர்வு',
      'Quantity': 'அளவு',
      'Source': 'ஆதாரம்',
      'Request Stock Adjustment': 'சரக்கு திருத்தம் கோரு',
      'Submit Request': 'கோரிக்கையை சமர்ப்பி',

      // Purchases & Suppliers (purchases.html, suppliers.html)
      'PROCUREMENT': 'கொள்முதல்',
      'Purchases & returns': 'கொள்முதல் & திருப்பி அனுப்புதல்',
      'Manage Suppliers →': 'சப்ளையர்களை நிர்வகி →',
      'Record purchase receipt': 'கொள்முதல் ரசீது பதிவு செய்',
      'Supplier': 'சப்ளையர்',
      'Supplier invoice no.': 'சப்ளையர் பில் எண்',
      'Purchase date': 'கொள்முதல் தேதி',
      'Inventory item': 'சரக்கு பொருள்',
      'Rate (₹)': 'விலை (₹)',
      'Batch no.': 'பேட்ச் எண்',
      'Expiry date (FEFO)': 'காலாவதி தேதி',
      'Post purchase': 'கொள்முதலைப் பதிவு செய்',
      'Recent purchases': 'சமீபத்திய கொள்முதல்',
      'Invoice': 'பில்',
      'Supplier management': 'சப்ளையர் மேலாண்மை',
      '+ Add Supplier': '+ சப்ளையர் சேர்',
      'Supplier purchase history': 'சப்ளையர் கொள்முதல் வரலாறு',
      'Save Supplier': 'சப்ளையரை சேமி',

      // Payments (payments.html)
      'ACCOUNTS RECEIVABLE': 'வரவேண்டிய கணக்குகள்',
      'Record collection': 'வசூல் பதிவு செய்',
      'Amount (₹)': 'தொகை (₹)',
      'Mode': 'முறை',
      'Record payment': 'பணம் பதிவு செய்',
      'Payment history': 'பணம் செலுத்திய வரலாறு',
      'Amount': 'தொகை',

      // Reports & Auditor (reports.html, auditor.html)
      'FINANCE & COMPLIANCE': 'நிதி & தணிக்கை',
      'Monthly audit reports': 'மாதாந்திர தணிக்கை அறிக்கைகள்',
      'Open Auditor View →': 'தணிக்கையாளர் பார்வை →',
      'From': 'முதல்',
      'To': 'வரை',
      'to': 'வரை',
      'Apply': 'பயன்படுத்து',
      'Load': 'ஏற்று',
      'Excel': 'எக்செல்',
      'Export PDF': 'PDF ஏற்றுமதி',
      'Export Tally XML': 'Tally XML ஏற்றுமதி',
      'Sales register': 'விற்பனை பதிவேடு',
      'GST outward supplies summary': 'GST விற்பனை சுருக்கம்',
      'Purchase register': 'கொள்முதல் பதிவேடு',
      'Stock ledger': 'சரக்கு பேரேடு',
      'Production variance & costing': 'உற்பத்தி வேறுபாடு & செலவு',
      'Receivables & ageing': 'வரவேண்டிய தொகை & வயது',
      'Cost per packet & margin': 'பாக்கெட் செலவு & லாபம்',
      'Stock summary': 'சரக்கு சுருக்கம்',
      'Payments & collections': 'பணம் & வசூல்',
      'Not loaded.': 'ஏற்றப்படவில்லை.',
      'Auditor control centre': 'தணிக்கையாளர் கட்டுப்பாட்டு மையம்',
      'GST summary': 'GST சுருக்கம்',
      'User-wise activity': 'பயனர் செயல்பாடு',
      'All roles': 'அனைத்து பதவிகள்',
      'Last Active': 'கடைசி செயல்பாடு',
      'Invoice register & receivables ageing': 'பில் பதிவேடு & நிலுவை',
      'Collected': 'வசூலிக்கப்பட்டது',
      'Age': 'வயது',
      'Bucket': 'பிரிவு',
      'Payment collections': 'பணம் வசூல்',
      'Ref': 'குறிப்பு',
      'Complete audit logs': 'முழு தணிக்கை பதிவுகள்',
      'All entities': 'அனைத்து பிரிவுகள்',

      // Masters (masters.html)
      'MASTER DATA CENTRE': 'முதன்மை தரவு மையம்',
      'Customers, Products, Inventory, BOM & Suppliers': 'வாடிக்கையாளர்கள், பொருட்கள், சரக்கு, BOM & சப்ளையர்கள்',
      'Master Control': 'முதன்மை கட்டுப்பாடு',
      'Customers': 'வாடிக்கையாளர்கள்',
      'Products': 'பொருட்கள்',
      'Inventory': 'சரக்கு இருப்பு',
      'BOM Management': 'BOM மேலாண்மை',
      'Suppliers': 'சப்ளையர்கள்',
      'Users': 'பயனர்கள்',
      'All types': 'அனைத்து வகைகள்',
      'Retailer': 'சில்லறை',
      'Distributor': 'விநியோகஸ்தர்',
      'Show inactive': 'முடக்கப்பட்டவை காட்டு',
      '+ Add Customer': '+ வாடிக்கையாளர் சேர்',
      'Name': 'பெயர்',
      'State': 'மாநிலம்',
      'Contact': 'தொடர்பு',
      'Limit': 'வரம்பு',
      '+ Add Product': '+ பொருள் சேர்',
      'Pack': 'அளவு',
      'Yield': 'மகசூல்',
      'HSN / GST': 'HSN / GST',
      'Finished Stock': 'தயார் சரக்கு',
      'All materials': 'அனைத்து பொருட்கள்',
      'Raw materials': 'மூலப்பொருட்கள்',
      'Packaging': 'பேக்கிங்',
      'Low-stock only': 'குறைந்த சரக்கு மட்டும்',
      'Movement History': 'நகர்வு வரலாறு',
      'Stock Adjustment': 'சரக்கு திருத்தம்',
      '+ Add Material': '+ பொருள் சேர்',
      'Reorder Level': 'மறு ஆர்டர் அளவு',
      'Health': 'நிலை',
      'Bill of Materials Editor': 'BOM பதிப்பாசிரியர்',
      'Select a product and configure components per batch': 'பொருளைத் தேர்ந்தெடுத்து ஒரு பேட்ச் கூறுகளை அமைக்கவும்',
      'Effective date': 'செயல்படும் தேதி',
      'Version notes': 'பதிப்பு குறிப்பு',
      'BOM COMPONENTS (PER 1 BATCH)': 'BOM கூறுகள் (1 பேட்ச்)',
      '+ Add Component': '+ கூறு சேர்',
      'Save New BOM Version': 'புதிய BOM பதிப்பை சேமி',
      'BOM Version History': 'BOM பதிப்பு வரலாறு',
      'User management (Owner only)': 'பயனர் மேலாண்மை (உரிமையாளர் மட்டும்)',
      '+ Add User': '+ பயனர் சேர்',
      'Email': 'மின்னஞ்சல்',
      'Role': 'பதவி',
      'Sales Target': 'விற்பனை இலக்கு',

      // Status badges
      'SUBMITTED': 'சமர்ப்பிக்கப்பட்டது',
      'APPROVED': 'அங்கீகரிக்கப்பட்டது',
      'INVOICED': 'பில் செய்யப்பட்டது',
      'DISPATCHED': 'அனுப்பப்பட்டது',
      'REJECTED': 'நிராகரிக்கப்பட்டது',
      'PASSED': 'தேர்ச்சி',
      'FAILED': 'தோல்வி',
      'CONDITIONAL': 'நிபந்தனை',
      'PENDING': 'நிலுவை',
      'POSTED': 'பதிவு செய்யப்பட்டது',
      'Active': 'செயலில்',
      'Inactive': 'முடக்கப்பட்டது',
      'Healthy': 'நன்று',
      'Low Stock': 'குறைந்த இருப்பு'
    };

    const TA_PHRASES = [
      ['Salt and spice mix', 'உப்பு மற்றும் மசாலா கலவை'],
      ['Carton (20 packets)', 'அட்டைப்பெட்டி (20 பாக்கெட்)'],
      ['200 g pouch', '200 கிராம் பை'],
      ['Cooking oil', 'சமையல் எண்ணெய்'],
      ['Tamil Nadu Flour Mills', 'தமிழ்நாடு மாவு ஆலை'],
      ['Retailer A', 'சில்லறை விற்பனையாளர் A'],
      ['Distributor B', 'விநியோகஸ்தர் B'],
      ['DISTRIBUTOR', 'விநியோகஸ்தர்'],
      ['RETAILER', 'சில்லறை'],
      ['Murukku', 'முறுக்கு'],
      ['Flour', 'மாவு'],
      ['200 g', '200 கிராம்'],
      ['packets', 'பாக்கெட்'],
      ['packet', 'பாக்கெட்'],
      ['carton', 'அட்டைப்பெட்டி'],
      ['litre', 'லிட்டர்'],
      ['piece', 'எண்ணிக்கை'],
      ['kg', 'கிலோ'],
      ['Expected output:', 'எதிர்பார்க்கப்படும் உற்பத்தி:'],
      ['Calculated wastage:', 'கணக்கிடப்பட்ட கழிவு:'],
      ['Yield variance:', 'மகசூல் வேறுபாடு:'],
      ['Planned 1-batch requirement →', 'திட்டமிட்ட 1-பேட்ச் தேவை →']
    ];

    const translateNode = root => {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const raw = node.nodeValue;
        if (!raw) continue;
        const normalized = raw.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        if (TA_DICT[normalized]) {
          node.nodeValue = TA_DICT[normalized];
        } else if (normalized.endsWith(':') && TA_DICT[normalized.slice(0, -1).trim()]) {
          node.nodeValue = `${TA_DICT[normalized.slice(0, -1).trim()]}:`;
        } else {
          let updated = raw;
          for (const [en, ta] of TA_PHRASES) {
            if (updated.includes(en)) updated = updated.split(en).join(ta);
          }
          if (updated !== raw) node.nodeValue = updated;
        }
      }
      if (root.querySelectorAll) {
        root.querySelectorAll('[placeholder]').forEach(el => {
          const ph = (el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
          if (TA_DICT[ph]) el.setAttribute('placeholder', TA_DICT[ph]);
        });
      }
    };

    const mainEl = document.querySelector('.main-content');
    translateNode(mainEl);
    document.querySelectorAll('.modal').forEach(translateNode);

    if (mainEl && typeof MutationObserver !== 'undefined') {
      let translating = false;
      const obs = new MutationObserver(() => {
        if (translating) return;
        translating = true;
        try {
          translateNode(mainEl);
          document.querySelectorAll('.modal').forEach(translateNode);
        } finally {
          translating = false;
        }
      });
      obs.observe(mainEl, { childList: true, subtree: true });
    }
  }

  const info = document.getElementById('userInfo');
  if (info) info.textContent = `${user.name || 'User'} · ${user.role || ''}`;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    localStorage.removeItem('sf_token');
    localStorage.removeItem('sf_user');
    location.href = '/';
  });
})();
