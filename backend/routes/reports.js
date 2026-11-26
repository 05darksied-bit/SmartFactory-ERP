'use strict';
const router = require('express').Router();
const db = require('../config/db');
const PDFDocument = require('pdfkit');
const { authenticate, allowRoles } = require('../middleware/auth');

router.use(authenticate, allowRoles('ACCOUNTANT', 'ADMIN', 'OWNER'));

function dates(req) {
  const from = req.query.from || '2000-01-01';
  const to = req.query.to || '2099-12-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw Object.assign(new Error('Invalid date format. Expected YYYY-MM-DD'), { status: 400 });
  }
  const dFrom = new Date(from);
  const dTo = new Date(to);
  if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) {
    throw Object.assign(new Error('Invalid calendar date'), { status: 400 });
  }
  if (dTo < dFrom) {
    throw Object.assign(new Error('End date must be on or after start date'), { status: 400 });
  }
  // If explicit dates were provided, enforce max 2-year span
  if (req.query.from && req.query.to) {
    const diffDays = (dTo - dFrom) / (1000 * 60 * 60 * 24);
    if (diffDays > 732) {
      throw Object.assign(new Error('Date range cannot exceed 2 years'), { status: 400 });
    }
  }
  return [from, to];
}

async function fetchReportData(key, from, to) {
  if (key === 'stock-summary') {
    const [rows] = await db.query(`
      SELECT i.id, i.name, i.item_type, i.base_unit, i.reorder_level,
             COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END),0) balance
      FROM inventory_items i LEFT JOIN stock_ledger s ON s.item_type=i.item_type AND s.item_id=i.id
      WHERE i.item_type<>'FINISHED' GROUP BY i.id
      UNION ALL
      SELECT p.id, p.name, 'FINISHED', 'packet', 0,
             COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END),0) balance
      FROM products p LEFT JOIN stock_ledger s ON s.item_type='FINISHED' AND s.item_id=p.id
      GROUP BY p.id`);
    return rows;
  }
  if (key === 'sales-register') {
    const [rows] = await db.execute(
      `SELECT so.id order_id, so.created_at, c.name customer, c.customer_type, p.name product, si.quantity, si.unit_price, (si.quantity*si.unit_price) taxable, so.status
       FROM sales_orders so JOIN customers c ON c.id=so.customer_id JOIN sales_order_items si ON si.order_id=so.id JOIN products p ON p.id=si.product_id
       WHERE DATE(so.created_at) BETWEEN ? AND ? ORDER BY so.created_at`,
      [from, to]
    );
    return rows;
  }
  if (key === 'stock-ledger') {
    const [rows] = await db.execute(
      `SELECT s.*, CASE WHEN s.item_type='FINISHED' THEN p.name ELSE i.name END item_name
       FROM stock_ledger s LEFT JOIN inventory_items i ON s.item_type<>'FINISHED' AND i.id=s.item_id LEFT JOIN products p ON s.item_type='FINISHED' AND p.id=s.item_id
       WHERE DATE(s.created_at) BETWEEN ? AND ? ORDER BY s.created_at DESC`,
      [from, to]
    );
    return rows;
  }
  if (key === 'production') {
    const [rows] = await db.execute(
      `SELECT pr.*, p.name product_name, pc.item_id, ii.name item_name, pc.planned_quantity, pc.actual_quantity, pc.variance_percent, pc.line_cost
       FROM production_runs pr JOIN products p ON p.id=pr.product_id LEFT JOIN production_consumption pc ON pc.run_id=pr.id LEFT JOIN inventory_items ii ON ii.id=pc.item_id
       WHERE DATE(pr.created_at) BETWEEN ? AND ? ORDER BY pr.created_at DESC`,
      [from, to]
    );
    return rows;
  }
  if (key === 'purchases') {
    const [rows] = await db.execute(
      `SELECT p.id, p.purchase_date, p.invoice_number, s.name supplier, ii.name item, pi.quantity, pi.unit, pi.rate, p.total_amount
       FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN purchase_items pi ON pi.purchase_id=p.id JOIN inventory_items ii ON ii.id=pi.item_id
       WHERE p.purchase_date BETWEEN ? AND ? ORDER BY p.purchase_date DESC`,
      [from, to]
    );
    return rows;
  }
  if (key === 'gst-summary') {
    const [rows] = await db.execute(
      `SELECT financial_year, COUNT(*) invoice_count, SUM(taxable_value) taxable, SUM(cgst) cgst, SUM(sgst) sgst, SUM(igst) igst, SUM(total_amount) gross
       FROM invoices WHERE DATE(created_at) BETWEEN ? AND ? AND status='POSTED' GROUP BY financial_year`,
      [from, to]
    );
    return rows;
  }
  if (key === 'receivables') {
    const [rows] = await db.execute(
      `SELECT c.id customer_id, c.name customer, i.invoice_number, i.total_amount invoiced, COALESCE(pay.paid,0) collected,
              i.total_amount-COALESCE(pay.paid,0) outstanding, DATEDIFF(CURDATE(),DATE(i.created_at)) age_days,
              CASE WHEN DATEDIFF(CURDATE(),DATE(i.created_at))<=30 THEN '0-30 days'
                   WHEN DATEDIFF(CURDATE(),DATE(i.created_at))<=60 THEN '31-60 days'
                   WHEN DATEDIFF(CURDATE(),DATE(i.created_at))<=90 THEN '61-90 days' ELSE '90+ days' END ageing_bucket
       FROM invoices i JOIN sales_orders so ON so.id=i.order_id JOIN customers c ON c.id=so.customer_id
       LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) pay ON pay.invoice_id=i.id
       WHERE i.status='POSTED' AND DATE(i.created_at) BETWEEN ? AND ? ORDER BY outstanding DESC`,
      [from, to]
    );
    return rows;
  }
  if (key === 'costing') {
    const [rows] = await db.execute(
      `SELECT pr.id run_id, p.name product, pr.actual_output, pr.material_cost, pr.labour_cost, pr.utility_cost, pr.total_cost, pr.cost_per_packet, p.selling_price, p.selling_price-pr.cost_per_packet margin_per_packet
       FROM production_runs pr JOIN products p ON p.id=pr.product_id
       WHERE pr.status='POSTED' AND DATE(pr.created_at) BETWEEN ? AND ? ORDER BY pr.created_at DESC`,
      [from, to]
    );
    return rows;
  }
  if (key === 'collections') {
    const [rows] = await db.execute(
      `SELECT p.id payment_id, p.payment_date, p.amount, p.mode, p.reference_no, i.invoice_number, c.name customer
       FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN sales_orders so ON so.id=i.order_id JOIN customers c ON c.id=so.customer_id
       WHERE p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date DESC`,
      [from, to]
    );
    return rows;
  }
  return null;
}

const REPORT_KEYS = ['sales-register', 'stock-ledger', 'stock-summary', 'production', 'purchases', 'gst-summary', 'receivables', 'costing', 'collections'];

for (const key of REPORT_KEYS) {
  router.get(`/${key}`, async (req, res, next) => {
    try {
      const [from, to] = dates(req);
      const rows = await fetchReportData(key, from, to);
      res.json(rows);
    } catch (e) { next(e); }
  });
}

router.get('/:report/pdf', async (req, res, next) => {
  try {
    const key = req.params.report;
    if (!REPORT_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown report' });
    const [from, to] = dates(req);
    const rows = await fetchReportData(key, from, to);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${key}.pdf`);
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(18).fillColor('#172b4d').text(`SmartFactory ERP - ${key.replaceAll('-', ' ').toUpperCase()}`);
    doc.fontSize(9).fillColor('#555').text(`Period: ${from} to ${to} | Generated: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown();
    for (const row of rows) {
      const line = Object.entries(row).map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : v}`).join(' | ');
      doc.fontSize(8).fillColor('#222').text(line, { width: 520 });
      doc.moveDown(0.35);
      if (doc.y > 740) doc.addPage();
    }
    if (!rows.length) doc.fontSize(10).text('No records for the selected period.');
    doc.end();
  } catch (e) { next(e); }
});

router.get('/:report/excel', async (req, res, next) => {
  try {
    const key = req.params.report;
    if (!REPORT_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown report' });
    const [from, to] = dates(req);
    const rows = await fetchReportData(key, from, to);

    const cols = rows.length ? Object.keys(rows[0]) : ['message'];
    const csvLines = [cols.join(',')];
    if (rows.length) {
      for (const r of rows) {
        csvLines.push(cols.map(k => {
          const val = r[k] instanceof Date ? r[k].toISOString().slice(0, 10) : (r[k] ?? '');
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(','));
      }
    } else {
      csvLines.push('"No records for the selected period"');
    }

    // UTF-8 BOM so Microsoft Excel opens currency & unicode cleanly
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${key}_${from}_to_${to}.csv`);
    res.send('\uFEFF' + csvLines.join('\r\n'));
  } catch (e) { next(e); }
});

function xmlEsc(s) {
  return String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// TallyPrime / Tally.ERP 9 compatible XML Sales Voucher Export
router.get('/tally/xml', async (req, res, next) => {
  try {
    const [from, to] = dates(req);
    const [rows] = await db.execute(
      `SELECT i.id, i.invoice_number, i.created_at, i.taxable_value, i.cgst, i.sgst, i.igst, i.total_amount,
              c.name AS customer_name, c.gstin AS customer_gstin, c.state_code
       FROM invoices i
       JOIN sales_orders so ON so.id=i.order_id
       JOIN customers c ON c.id=so.customer_id
       WHERE i.status='POSTED' AND DATE(i.created_at) BETWEEN ? AND ?
       ORDER BY i.created_at ASC`,
      [from, to]
    );
    const company = xmlEsc(process.env.FACTORY_NAME || 'SmartFactory Foods');
    const vouchers = rows.map(r => {
      const dt = new Date(r.created_at).toISOString().slice(0, 10).replaceAll('-', '');
      const cust = xmlEsc(r.customer_name);
      const invNo = xmlEsc(r.invoice_number);
      const total = Number(r.total_amount).toFixed(2);
      const taxable = Number(r.taxable_value).toFixed(2);
      const cgst = Number(r.cgst).toFixed(2);
      const sgst = Number(r.sgst).toFixed(2);
      const igst = Number(r.igst).toFixed(2);
      return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${dt}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${invNo}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${cust}</PARTYLEDGERNAME>
          <PARTYGSTIN>${xmlEsc(r.customer_gstin || '')}</PARTYGSTIN>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${cust}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${total}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>GST Sales</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${taxable}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>${Number(cgst) > 0 ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${cgst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>` : ''}${Number(sgst) > 0 ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${sgst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>` : ''}${Number(igst) > 0 ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output IGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${igst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>` : ''}
        </VOUCHER>
      </TALLYMESSAGE>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${vouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=tally-sales-${from}-to-${to}.xml`);
    res.send(xml);
  } catch (e) { next(e); }
});

module.exports = router;
