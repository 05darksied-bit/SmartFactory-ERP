'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { balance, movement, audit } = require('../services/ledger');
const { toPaise } = require('../services/tax');

router.post('/', authenticate, allowRoles('SALESMAN', 'ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    const { customerId, items, idempotencyKey } = req.body;
    if (!customerId || !Array.isArray(items) || !items.length) {
      throw Error('Customer and order lines are required');
    }

    const cleanKey = idempotencyKey ? String(idempotencyKey).trim().slice(0, 64) : null;

    await c.beginTransaction();

    if (cleanKey) {
      const [[existing]] = await c.execute(
        'SELECT id, total_amount, status FROM sales_orders WHERE idempotency_key=? LIMIT 1',
        [cleanKey]
      );
      if (existing) {
        await c.rollback();
        return res.status(200).json({
          orderId: existing.id,
          total: Number(existing.total_amount).toFixed(2),
          status: existing.status,
          duplicate: true
        });
      }
    }

    const [[customer]] = await c.execute('SELECT id FROM customers WHERE id=? AND is_active=1', [customerId]);
    if (!customer) throw Error('Customer not found');

    let totalPaise = 0;
    const clean = [];
    for (const line of items) {
      const qty = Number(line.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw Error('Quantity must be a positive whole packet count');
      const [[p]] = await c.execute('SELECT id, selling_price FROM products WHERE id=? AND is_active=1', [line.productId]);
      if (!p) throw Error('Product not found');
      const price = req.user.role === 'SALESMAN' ? Number(p.selling_price) : Number(line.unitPrice ?? p.selling_price);
      if (!Number.isFinite(price) || price < 0) throw Error('Invalid price');
      const pricePaise = toPaise(price);
      const linePaise = qty * pricePaise;
      if (!Number.isSafeInteger(linePaise) || !Number.isSafeInteger(totalPaise + linePaise)) {
        throw Error('Order value exceeds the supported monetary range');
      }
      totalPaise += linePaise;
      clean.push({ id: p.id, qty, pricePaise });
    }

    const [o] = await c.execute(
      "INSERT INTO sales_orders(customer_id, salesman_id, idempotency_key, status, total_amount) VALUES(?,?,?,'SUBMITTED',?)",
      [customerId, req.user.id, cleanKey, (totalPaise / 100).toFixed(2)]
    );
    for (const x of clean) {
      await c.execute(
        'INSERT INTO sales_order_items(order_id, product_id, quantity, unit_price) VALUES(?,?,?,?)',
        [o.insertId, x.id, x.qty, (x.pricePaise / 100).toFixed(2)]
      );
    }
    await audit(c, req.user.id, 'CREATE', 'SALES_ORDER', o.insertId, { customerId, items: clean, totalPaise, idempotencyKey: cleanKey }, req.ip);
    await c.commit();
    res.status(201).json({ orderId: o.insertId, total: (totalPaise / 100).toFixed(2), status: 'SUBMITTED' });
  } catch (e) {
    await c.rollback();
    if (e.code === 'ER_DUP_ENTRY' && req.body?.idempotencyKey) {
      const [[existing]] = await db.execute(
        'SELECT id, total_amount, status FROM sales_orders WHERE idempotency_key=? LIMIT 1',
        [String(req.body.idempotencyKey).trim().slice(0, 64)]
      ).catch(() => [[]]);
      if (existing) {
        return res.status(200).json({
          orderId: existing.id,
          total: Number(existing.total_amount).toFixed(2),
          status: existing.status,
          duplicate: true
        });
      }
    }
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const own = req.user.role === 'SALESMAN';
    const [r] = await db.execute(
      `SELECT so.*, c.name customer_name, c.state_code customer_state, c.credit_limit,
              u.name salesman_name, i.invoice_number, i.id invoice_id
       FROM sales_orders so
       JOIN customers c ON c.id=so.customer_id
       JOIN users u ON u.id=so.salesman_id
       LEFT JOIN invoices i ON i.order_id=so.id AND i.status='POSTED'
       ${own ? 'WHERE so.salesman_id=?' : ''}
       ORDER BY so.created_at DESC`,
      own ? [req.user.id] : []
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/my-customer-sales', authenticate, allowRoles('SALESMAN', 'ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const [r] = await db.execute(
      `SELECT c.id customer_id, c.name customer, COUNT(DISTINCT so.id) order_count, COALESCE(SUM(so.total_amount),0) order_value
       FROM sales_orders so
       JOIN customers c ON c.id=so.customer_id
       WHERE so.salesman_id=?
       GROUP BY c.id, c.name
       ORDER BY order_value DESC`,
      [req.user.id]
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const [[o]] = await db.execute(
      'SELECT so.*, c.name customer_name, c.state_code, c.gstin, c.address, c.credit_limit FROM sales_orders so JOIN customers c ON c.id=so.customer_id WHERE so.id=?',
      [req.params.id]
    );
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role === 'SALESMAN' && o.salesman_id !== req.user.id) return res.sendStatus(403);
    const [items] = await db.execute(
      `SELECT soi.*, p.name product_name, p.hsn_code, p.gst_rate,
              COALESCE((SELECT SUM(di.quantity) FROM dispatches d JOIN dispatch_items di ON di.dispatch_id=d.id WHERE d.order_id=soi.order_id AND di.product_id=soi.product_id), 0) AS dispatched_qty
       FROM sales_order_items soi
       JOIN products p ON p.id=soi.product_id
       WHERE soi.order_id=?`,
      [o.id]
    );
    const [dispatches] = await db.execute(
      `SELECT d.id, d.dispatch_date, d.reference_no, d.created_at, u.name AS created_by_name
       FROM dispatches d LEFT JOIN users u ON u.id=d.created_by WHERE d.order_id=? ORDER BY d.created_at DESC`,
      [o.id]
    );
    const [history] = await db.execute(
      `SELECT a.action, a.after_data, a.created_at, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.entity_type='SALES_ORDER' AND a.entity_id=? ORDER BY a.created_at DESC`,
      [o.id]
    );
    res.json({ ...o, items, dispatches, history });
  } catch (e) { next(e); }
});

router.post('/:id/verify', authenticate, allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[o]] = await c.execute('SELECT * FROM sales_orders WHERE id=? FOR UPDATE', [req.params.id]);
    if (!o || o.status !== 'SUBMITTED') throw Error('Only submitted orders can be verified');
    const [items] = await c.execute('SELECT * FROM sales_order_items WHERE order_id=?', [o.id]);
    const shortages = [];
    for (const x of items) {
      await c.execute("SELECT id FROM stock_ledger WHERE item_type='FINISHED' AND item_id=? FOR UPDATE", [x.product_id]);
      const b = await balance(c, 'FINISHED', x.product_id);
      if (b < x.quantity) shortages.push({ productId: x.product_id, available: b, requested: x.quantity, shortage: x.quantity - b });
    }
    if (shortages.length) {
      await c.rollback();
      await db.execute(
        'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
        [req.user.id, 'SHORTAGE_BLOCKED', 'SALES_ORDER', o.id, JSON.stringify({ shortages }), req.ip]
      );
      return res.status(409).json({ error: 'Insufficient finished-goods stock', shortages });
    }

    // Check customer credit limit for advisory warning
    const [[cust]] = await c.execute('SELECT credit_limit FROM customers WHERE id=?', [o.customer_id]);
    const [[rec]] = await c.execute(
      `SELECT COALESCE(SUM(i.total_amount),0) - COALESCE(SUM(COALESCE(p.paid,0)),0) AS outstanding
       FROM invoices i JOIN sales_orders so ON so.id=i.order_id
       LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id
       WHERE so.customer_id=? AND i.status='POSTED'`,
      [o.customer_id]
    );
    const projectedExposure = Number(rec.outstanding || 0) + Number(o.total_amount || 0);
    const creditWarning = cust && Number(cust.credit_limit) > 0 && projectedExposure > Number(cust.credit_limit)
      ? `Customer exposure ₹${projectedExposure.toFixed(2)} exceeds credit limit ₹${Number(cust.credit_limit).toFixed(2)}`
      : null;

    await c.execute("UPDATE sales_orders SET status='APPROVED', approved_by=?, approved_at=NOW() WHERE id=?", [req.user.id, o.id]);
    await audit(c, req.user.id, 'APPROVE', 'SALES_ORDER', o.id, { stockVerified: true, creditWarning }, req.ip);
    await c.commit();
    res.json({ message: 'Order approved; stock verified', creditWarning });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.post('/:id/reject', authenticate, allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  try {
    const [r] = await db.execute("UPDATE sales_orders SET status='REJECTED' WHERE id=? AND status='SUBMITTED'", [req.params.id]);
    if (!r.affectedRows) throw Error('Order cannot be rejected');
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'REJECT', 'SALES_ORDER', req.params.id, JSON.stringify({ reason: req.body.reason || '' }), req.ip]
    );
    res.json({ message: 'Order rejected' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/invoice', authenticate, allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[o]] = await c.execute(
      'SELECT so.*, c.state_code FROM sales_orders so JOIN customers c ON c.id=so.customer_id WHERE so.id=? FOR UPDATE',
      [req.params.id]
    );
    if (!o || o.status !== 'APPROVED') throw Error('Order must be approved before invoicing');
    const [items] = await c.execute(
      'SELECT soi.*, p.gst_rate FROM sales_order_items soi JOIN products p ON p.id=soi.product_id WHERE order_id=?',
      [o.id]
    );
    let taxablePaise = 0;
    const rate = Number(items[0]?.gst_rate);
    if (!items.length) throw Error('Cannot invoice an order without line items');
    for (const x of items) {
      if (Number(x.gst_rate) !== rate) throw Error('Mixed GST rates in one invoice are not supported in this prototype');
      const linePaise = toPaise(x.unit_price) * Number(x.quantity);
      if (!Number.isSafeInteger(linePaise) || !Number.isSafeInteger(taxablePaise + linePaise)) {
        throw Error('Invoice value exceeds the supported monetary range');
      }
      taxablePaise += linePaise;
    }
    const { calculateGst } = require('../services/tax');
    const intra = o.state_code === (process.env.FACTORY_STATE_CODE || '33');
    const tax = calculateGst(taxablePaise, rate, intra);
    const cgstPaise = tax.cgstPaise, sgstPaise = tax.sgstPaise, igstPaise = tax.igstPaise;
    const taxable = taxablePaise / 100, cgst = cgstPaise / 100, sgst = sgstPaise / 100, igst = igstPaise / 100;
    const d = new Date();
    const fy = d.getMonth() >= 3
      ? `${d.getFullYear()}-${String(d.getFullYear() + 1).slice(-2)}`
      : `${d.getFullYear() - 1}-${String(d.getFullYear()).slice(-2)}`;

    await c.execute(
      'INSERT INTO invoice_sequences(financial_year, last_number) VALUES(?,0) ON DUPLICATE KEY UPDATE financial_year=VALUES(financial_year)',
      [fy]
    );
    const [[sequence]] = await c.execute('SELECT last_number FROM invoice_sequences WHERE financial_year=? FOR UPDATE', [fy]);
    const nextNumber = Number(sequence.last_number) + 1;
    await c.execute('UPDATE invoice_sequences SET last_number=? WHERE financial_year=?', [nextNumber, fy]);
    const inv = `SF/${fy}/${String(nextNumber).padStart(4, '0')}`;
    const totalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
    if (!Number.isSafeInteger(totalPaise)) throw Error('Invoice total exceeds the supported monetary range');
    const total = totalPaise / 100;

    const [r] = await c.execute(
      'INSERT INTO invoices(order_id, invoice_number, financial_year, taxable_value, cgst, sgst, igst, total_amount, created_by) VALUES(?,?,?,?,?,?,?,?,?)',
      [o.id, inv, fy, taxable.toFixed(2), cgst.toFixed(2), sgst.toFixed(2), igst.toFixed(2), total.toFixed(2), req.user.id]
    );
    await c.execute("UPDATE sales_orders SET status='INVOICED' WHERE id=?", [o.id]);
    await audit(c, req.user.id, 'CREATE', 'INVOICE', r.insertId, { invoiceNumber: inv, taxable, cgst, sgst, igst, total }, req.ip);
    await c.commit();
    res.status(201).json({ invoiceId: r.insertId, invoiceNumber: inv, taxable, cgst, sgst, igst, total });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.post('/:id/dispatch', authenticate, allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[o]] = await c.execute('SELECT * FROM sales_orders WHERE id=? FOR UPDATE', [req.params.id]);
    if (!o || !['INVOICED', 'DISPATCHED'].includes(o.status)) {
      throw Error('An invoiced order is required before dispatch');
    }
    const [lines] = await c.execute(
      `SELECT soi.product_id, soi.quantity, COALESCE(SUM(di.quantity),0) dispatched
       FROM sales_order_items soi
       LEFT JOIN dispatches d ON d.order_id=soi.order_id
       LEFT JOIN dispatch_items di ON di.dispatch_id=d.id AND di.product_id=soi.product_id
       WHERE soi.order_id=?
       GROUP BY soi.product_id, soi.quantity`,
      [o.id]
    );
    const [d] = await c.execute(
      'INSERT INTO dispatches(order_id, dispatch_date, reference_no, created_by) VALUES(?,?,?,?)',
      [o.id, req.body.dispatchDate || new Date().toISOString().slice(0, 10), req.body.referenceNo || null, req.user.id]
    );
    let dispatched = 0;
    for (const l of lines) {
      const remaining = Number(l.quantity) - Number(l.dispatched);
      const qty = Number(req.body.quantities?.[l.product_id] ?? remaining);
      if (!Number.isInteger(qty) || qty < 0 || qty > remaining) {
        throw Error(`Dispatch quantity must be a whole packet count within the remaining order for product ${l.product_id}`);
      }
      if (qty === 0) continue;
      await c.execute("SELECT id FROM stock_ledger WHERE item_type='FINISHED' AND item_id=? FOR UPDATE", [l.product_id]);
      const b = await balance(c, 'FINISHED', l.product_id);
      if (b < qty) throw Error(`Insufficient stock for product ${l.product_id}`);
      await c.execute('INSERT INTO dispatch_items(dispatch_id, product_id, quantity) VALUES(?,?,?)', [d.insertId, l.product_id, qty]);
      await movement(c, { type: 'FINISHED', id: l.product_id, kind: 'SALE', qty, unit: 'packet', source: 'DISPATCH', sourceId: d.insertId }, req.user.id);
      dispatched += qty;
    }
    if (dispatched === 0) throw Error('Enter at least one positive dispatch quantity');
    const [[left]] = await c.execute(
      `SELECT SUM(soi.quantity - COALESCE(x.qty, 0)) remaining
       FROM sales_order_items soi
       LEFT JOIN (
         SELECT di.product_id, SUM(di.quantity) qty
         FROM dispatches d JOIN dispatch_items di ON di.dispatch_id=d.id
         WHERE d.order_id=? GROUP BY di.product_id
       ) x ON x.product_id=soi.product_id
       WHERE soi.order_id=?`,
      [o.id, o.id]
    );
    if (Number(left.remaining) === 0) {
      await c.execute("UPDATE sales_orders SET status='DISPATCHED' WHERE id=?", [o.id]);
    }
    await audit(c, req.user.id, 'DISPATCH', 'DISPATCH', d.insertId, { orderId: o.id, dispatched }, req.ip);
    await c.commit();
    res.status(201).json({ dispatchId: d.insertId, dispatched, remaining: Number(left.remaining) });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.patch('/:id', authenticate, allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) throw Error('Order lines are required');
    await c.beginTransaction();
    const [[o]] = await c.execute("SELECT * FROM sales_orders WHERE id=? AND status='SUBMITTED' FOR UPDATE", [req.params.id]);
    if (!o) throw Error('Only submitted orders can be edited');
    const [prevItems] = await c.execute('SELECT product_id, quantity, unit_price FROM sales_order_items WHERE order_id=?', [o.id]);
    await c.execute('DELETE FROM sales_order_items WHERE order_id=?', [o.id]);
    let totalPaise = 0;
    for (const x of items) {
      const qty = Number(x.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw Error('Invalid quantity or price');
      const pricePaise = toPaise(x.unitPrice);
      const linePaise = qty * pricePaise;
      if (!Number.isSafeInteger(linePaise) || !Number.isSafeInteger(totalPaise + linePaise)) {
        throw Error('Order value exceeds the supported monetary range');
      }
      const [[product]] = await c.execute('SELECT id FROM products WHERE id=? AND is_active=1', [x.productId]);
      if (!product) throw Error('Product not found');
      await c.execute(
        'INSERT INTO sales_order_items(order_id, product_id, quantity, unit_price) VALUES(?,?,?,?)',
        [o.id, x.productId, qty, (pricePaise / 100).toFixed(2)]
      );
      totalPaise += linePaise;
    }
    const total = totalPaise / 100;
    await c.execute('UPDATE sales_orders SET total_amount=? WHERE id=?', [total.toFixed(2), o.id]);
    await c.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, before_data, after_data, ip_address) VALUES(?,?,?,?,?,?,?)',
      [req.user.id, 'EDIT', 'SALES_ORDER', o.id, JSON.stringify({ items: prevItems, total: o.total_amount }), JSON.stringify({ items, totalPaise }), req.ip]
    );
    await c.commit();
    res.json({ message: 'Order updated', total: total.toFixed(2) });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

module.exports = router;
