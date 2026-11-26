'use strict';
const crypto = require('node:crypto');
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');

router.use(authenticate);

router.get('/', allowRoles('ADMIN', 'OWNER', 'ACCOUNTANT'), async (_req, res, next) => {
  try {
    const [r] = await db.query(
      "SELECT i.*, c.name customer_name, c.gstin, c.state_code FROM invoices i JOIN sales_orders so ON so.id=i.order_id JOIN customers c ON c.id=so.customer_id WHERE i.status='POSTED' ORDER BY i.created_at DESC"
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/:id/pdf', allowRoles('ADMIN', 'OWNER', 'ACCOUNTANT', 'SALESMAN'), async (req, res) => {
  try {
    const [[i]] = await db.execute(
      `SELECT i.*, c.name customer_name, c.gstin, c.state_code, c.address, so.salesman_id
       FROM invoices i JOIN sales_orders so ON so.id=i.order_id JOIN customers c ON c.id=so.customer_id WHERE i.id=?`,
      [req.params.id]
    );
    if (!i) return res.sendStatus(404);
    if (req.user.role === 'SALESMAN' && i.salesman_id !== req.user.id) return res.sendStatus(403);
    const [lines] = await db.execute(
      'SELECT soi.*, p.name, p.hsn_code FROM sales_order_items soi JOIN products p ON p.id=soi.product_id WHERE soi.order_id=?',
      [i.order_id]
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${i.invoice_number.replaceAll('/', '-')}.pdf`);
    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);
    doc.fontSize(22).fillColor('#172b4d').text(process.env.FACTORY_NAME || 'SMARTFACTORY FOODS', 48, 48);
    doc.fontSize(9).fillColor('#555').text(`GSTIN: ${process.env.FACTORY_GSTIN || '33AAAAA0000A1Z5'} · ${process.env.FACTORY_ADDRESS || 'Tamil Nadu, India'}`, 48, 77);
    doc.fontSize(18).fillColor('#111').text('TAX INVOICE', { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(11).text(`Invoice: ${i.invoice_number}`).text(`Date: ${new Date(i.created_at).toLocaleDateString('en-IN')}`).text(`Customer: ${i.customer_name}`).text(`GSTIN: ${i.gstin || 'Unregistered'}`).text(`Place of supply state code: ${i.state_code}`);
    if (i.irn) doc.fontSize(9).text(`IRN (Mock): ${i.irn}`).text(`Ack No: ${i.ack_no} | e-Way Bill: ${i.ewb_no}`);
    doc.moveDown().fontSize(11);
    doc.text('Description / HSN                         Qty             Rate             Taxable');
    for (const l of lines) {
      doc.text(`${l.name} / ${l.hsn_code}                    ${l.quantity}             ${Number(l.unit_price).toFixed(2)}             ${(l.quantity * l.unit_price).toFixed(2)}`);
    }
    doc.moveDown();
    doc.text(`Taxable value: Rs. ${Number(i.taxable_value).toFixed(2)}`)
      .text(`CGST: Rs. ${Number(i.cgst).toFixed(2)}`)
      .text(`SGST: Rs. ${Number(i.sgst).toFixed(2)}`)
      .text(`IGST: Rs. ${Number(i.igst).toFixed(2)}`)
      .fontSize(14).text(`Invoice total: Rs. ${Number(i.total_amount).toFixed(2)}`);
    doc.moveDown(2).fontSize(9).text('Computer-generated invoice. Verify business GST registration and invoice particulars before statutory use.');
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/e-invoice', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[i]] = await c.execute(
      `SELECT i.*, c.name customer_name, c.gstin customer_gstin, c.state_code customer_state, c.address customer_address
       FROM invoices i JOIN sales_orders so ON so.id=i.order_id JOIN customers c ON c.id=so.customer_id
       WHERE i.id=? AND i.status='POSTED' FOR UPDATE`,
      [req.params.id]
    );
    if (!i) throw Object.assign(new Error('Posted invoice not found'), { status: 404 });
    if (i.irn) {
      await c.rollback();
      return res.json({
        irn: i.irn,
        ackNo: i.ack_no,
        ackDate: i.ack_date,
        ewbNo: i.ewb_no,
        payload: typeof i.einvoice_json === 'string' ? JSON.parse(i.einvoice_json) : i.einvoice_json,
        cached: true
      });
    }

    const [lines] = await c.execute(
      'SELECT soi.*, p.name, p.hsn_code, p.gst_rate FROM sales_order_items soi JOIN products p ON p.id=soi.product_id WHERE soi.order_id=?',
      [i.order_id]
    );
    const sellerGstin = process.env.FACTORY_GSTIN || '33AAAAA0000A1Z5';
    const irn = crypto.createHash('sha256').update(`${sellerGstin}|${i.invoice_number}|${i.financial_year}`).digest('hex');
    const ackNo = `11${String(i.id).padStart(6, '0')}${String(Date.now()).slice(-7)}`;
    const ackDate = new Date();
    const ewbNo = `331${String(i.id).padStart(4, '0')}${String(Date.now()).slice(-5)}`;

    const payload = {
      Version: '1.1',
      MockNotice: 'Simulated NIC e-Invoice / e-Way Bill payload for prototype demonstration',
      Irn: irn,
      AckNo: ackNo,
      AckDt: ackDate.toISOString(),
      EwbNo: ewbNo,
      TranDtls: { TaxSch: 'GST', SupTyp: i.customer_gstin ? 'B2B' : 'B2C' },
      DocDtls: { Typ: 'INV', No: i.invoice_number, Dt: new Date(i.created_at).toLocaleDateString('en-GB') },
      SellerDtls: {
        Gstin: sellerGstin,
        LglNm: process.env.FACTORY_NAME || 'SmartFactory Foods',
        Loc: process.env.FACTORY_ADDRESS || 'Tamil Nadu',
        Stcd: process.env.FACTORY_STATE_CODE || '33'
      },
      BuyerDtls: {
        Gstin: i.customer_gstin || 'URP',
        LglNm: i.customer_name,
        Pos: i.customer_state,
        Addr1: i.customer_address || 'India',
        Stcd: i.customer_state
      },
      ItemList: lines.map((l, idx) => ({
        SlNo: String(idx + 1),
        PrdDesc: l.name,
        HsnCd: l.hsn_code,
        Qty: Number(l.quantity),
        Unit: 'PAC',
        UnitPrice: Number(l.unit_price),
        TotAmt: Number((l.quantity * l.unit_price).toFixed(2)),
        GstRt: Number(l.gst_rate)
      })),
      ValDtls: {
        AssVal: Number(i.taxable_value),
        CgstVal: Number(i.cgst),
        SgstVal: Number(i.sgst),
        IgstVal: Number(i.igst),
        TotInvVal: Number(i.total_amount)
      }
    };

    await c.execute(
      'UPDATE invoices SET irn=?, ack_no=?, ack_date=?, ewb_no=?, einvoice_json=? WHERE id=?',
      [irn, ackNo, ackDate, ewbNo, JSON.stringify(payload), i.id]
    );
    await c.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'GENERATE_EINVOICE', 'INVOICE', i.id, JSON.stringify({ irn, ackNo, ewbNo }), req.ip]
    );
    await c.commit();
    res.status(201).json({ irn, ackNo, ackDate, ewbNo, payload });
  } catch (e) {
    await c.rollback();
    next(e);
  } finally { c.release(); }
});

router.get('/:id/e-invoice', allowRoles('ADMIN', 'OWNER', 'ACCOUNTANT', 'SALESMAN'), async (req, res, next) => {
  try {
    const [[i]] = await db.execute('SELECT irn, ack_no, ack_date, ewb_no, einvoice_json FROM invoices WHERE id=?', [req.params.id]);
    if (!i) return res.status(404).json({ error: 'Invoice not found' });
    if (!i.irn) return res.status(404).json({ error: 'e-Invoice has not been generated for this invoice yet' });
    res.json({
      irn: i.irn,
      ackNo: i.ack_no,
      ackDate: i.ack_date,
      ewbNo: i.ewb_no,
      payload: typeof i.einvoice_json === 'string' ? JSON.parse(i.einvoice_json) : i.einvoice_json
    });
  } catch (e) { next(e); }
});

router.post('/:id/credit-note', allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[i]] = await c.execute("SELECT * FROM invoices WHERE id=? AND status='POSTED' FOR UPDATE", [req.params.id]);
    if (!i) throw Error('Only a posted invoice can be credited');
    const [[sent]] = await c.execute('SELECT COUNT(*) n FROM dispatches WHERE order_id=?', [i.order_id]);
    if (Number(sent.n) > 0) throw Error('A dispatched invoice cannot be cancelled until returned goods are recorded.');
    const [[paid]] = await c.execute('SELECT COUNT(*) n FROM payments WHERE invoice_id=?', [i.id]);
    if (Number(paid.n) > 0) throw Error('An invoice with recorded payments cannot be cancelled; issue an adjustment after review.');
    const reason = String(req.body.reason || 'Invoice cancellation').slice(0, 500);
    const cn = `CN/${i.financial_year}/${String(i.id).padStart(5, '0')}`;
    const [r] = await c.execute(
      'INSERT INTO credit_notes(invoice_id, credit_note_number, amount, reason, created_by) VALUES(?,?,?,?,?)',
      [i.id, cn, i.total_amount, reason, req.user.id]
    );
    await c.execute("UPDATE invoices SET status='CANCELLED' WHERE id=?", [i.id]);
    await c.execute("UPDATE sales_orders SET status='APPROVED' WHERE id=?", [i.order_id]);
    await c.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREDIT_NOTE', 'INVOICE', i.id, JSON.stringify({ creditNote: cn, amount: i.total_amount, reason }), req.ip]
    );
    await c.commit();
    res.status(201).json({ creditNoteId: r.insertId, creditNoteNumber: cn, creditedAmount: i.total_amount });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

module.exports = router;
