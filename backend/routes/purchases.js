'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { movement, audit, balance } = require('../services/ledger');
const { convert } = require('../utils/units');

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])$/;

function validateSupplierTax(gstin, stateCode) {
  let cleanGstin = null;
  if (gstin) {
    cleanGstin = String(gstin).trim().toUpperCase();
    if (!GSTIN_RE.test(cleanGstin)) {
      throw Object.assign(new Error('Invalid supplier GSTIN format (expected 15-char Indian GSTIN)'), { status: 400 });
    }
  }
  let cleanState = null;
  if (stateCode) {
    cleanState = String(stateCode).trim().padStart(2, '0');
    if (!STATE_CODE_RE.test(cleanState)) {
      throw Object.assign(new Error('Invalid GST state code (01–38)'), { status: 400 });
    }
  }
  return { cleanGstin, cleanState };
}

router.use(authenticate, allowRoles('ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'));

router.get('/suppliers', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1';
    const [r] = await db.query(
      includeInactive
        ? 'SELECT * FROM suppliers ORDER BY is_active DESC, name ASC'
        : 'SELECT * FROM suppliers WHERE is_active=1 ORDER BY name ASC'
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/suppliers', allowRoles('ADMIN', 'OWNER', 'PRODUCTION'), async (req, res, next) => {
  try {
    const { name, gstin, stateCode, phone, address } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Supplier name is required' });
    const { cleanGstin, cleanState } = validateSupplierTax(gstin, stateCode);
    const [r] = await db.execute(
      'INSERT INTO suppliers(name, gstin, state_code, phone, address) VALUES(?,?,?,?,?)',
      [String(name).trim(), cleanGstin, cleanState, phone || null, address || null]
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREATE', 'SUPPLIER', r.insertId, JSON.stringify({ name, gstin: cleanGstin, stateCode: cleanState }), req.ip]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/suppliers/:id', allowRoles('ADMIN', 'OWNER', 'PRODUCTION'), async (req, res, next) => {
  try {
    const { name, gstin, stateCode, phone, address, isActive } = req.body;
    const { cleanGstin, cleanState } = validateSupplierTax(
      gstin !== undefined ? gstin : null,
      stateCode !== undefined ? stateCode : null
    );
    const [r] = await db.execute(
      `UPDATE suppliers SET
        name=COALESCE(?, name),
        gstin=${gstin !== undefined ? '?' : 'gstin'},
        state_code=${stateCode !== undefined ? '?' : 'state_code'},
        phone=${phone !== undefined ? '?' : 'phone'},
        address=${address !== undefined ? '?' : 'address'},
        is_active=COALESCE(?, is_active)
       WHERE id=?`,
      [
        name ? String(name).trim() : null,
        ...(gstin !== undefined ? [cleanGstin] : []),
        ...(stateCode !== undefined ? [cleanState] : []),
        ...(phone !== undefined ? [phone || null] : []),
        ...(address !== undefined ? [address || null] : []),
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        req.params.id
      ]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'UPDATE', 'SUPPLIER', req.params.id, JSON.stringify({ name, isActive }), req.ip]
    );
    res.json({ message: 'Supplier updated' });
  } catch (e) { next(e); }
});

router.get('/suppliers/:id/history', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT p.id, p.invoice_number, p.purchase_date, p.total_amount, p.status,
              pi.item_id, ii.name AS item_name, pi.quantity, pi.unit, pi.rate
       FROM purchases p
       JOIN purchase_items pi ON pi.purchase_id=p.id
       JOIN inventory_items ii ON ii.id=pi.item_id
       WHERE p.supplier_id=?
       ORDER BY p.purchase_date DESC, p.id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/suppliers/:id/payments', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT sp.*, u.name AS created_by_name, p.invoice_number
       FROM supplier_payments sp
       LEFT JOIN users u ON u.id=sp.created_by
       LEFT JOIN purchases p ON p.id=sp.purchase_id
       WHERE sp.supplier_id=?
       ORDER BY sp.payment_date DESC, sp.id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/suppliers/:id/payments', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { purchaseId, amount, paymentDate, mode, referenceNo, notes } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Payment amount must be positive' });
    }
    const [r] = await db.execute(
      'INSERT INTO supplier_payments(supplier_id, purchase_id, amount, payment_date, mode, reference_no, notes, created_by) VALUES(?,?,?,?,?,?,?,?)',
      [req.params.id, purchaseId || null, amt.toFixed(2), paymentDate || new Date().toISOString().slice(0, 10), mode || 'Bank transfer', referenceNo || null, notes || null, req.user.id]
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'SUPPLIER_PAYMENT', 'SUPPLIER', req.params.id, JSON.stringify({ paymentId: r.insertId, amount: amt }), req.ip]
    );
    res.status(201).json({ paymentId: r.insertId });
  } catch (e) { next(e); }
});

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.supplier_id, s.name AS supplier_name, p.invoice_number, p.purchase_date, p.total_amount, p.status,
              pi.item_id, ii.name AS item_name, pi.quantity, pi.unit, pi.rate
       FROM purchases p
       JOIN suppliers s ON s.id=p.supplier_id
       JOIN purchase_items pi ON pi.purchase_id=p.id
       JOIN inventory_items ii ON ii.id=pi.item_id
       ORDER BY p.purchase_date DESC, p.id DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', allowRoles('ADMIN', 'OWNER', 'PRODUCTION'), async (req, res) => {
  const c = await db.getConnection();
  try {
    const { supplierId, invoiceNumber, purchaseDate, items } = req.body;
    if (!supplierId || !Array.isArray(items) || !items.length) {
      throw Error('Supplier and purchase items are required');
    }
    await c.beginTransaction();
    let totalPaise = 0;
    const normalized = [];
    for (const x of items) {
      const purchaseQty = Number(x.quantity);
      const purchaseRate = Number(x.rate);
      if (!Number.isFinite(purchaseQty) || purchaseQty <= 0 || !Number.isFinite(purchaseRate) || purchaseRate < 0) {
        throw Error('Invalid purchase quantity or rate');
      }
      const [[it]] = await c.execute('SELECT item_type, base_unit FROM inventory_items WHERE id=?', [x.itemId]);
      if (!it || !['RAW', 'PACKAGING'].includes(it.item_type)) {
        throw Error('Purchase item must be a raw material or packaging item');
      }
      const baseQty = convert(purchaseQty, x.unit, it.base_unit);
      const factor = baseQty / purchaseQty;
      const baseRate = purchaseRate / factor;
      const linePaise = Math.round(purchaseQty * purchaseRate * 100);
      if (!Number.isSafeInteger(linePaise) || !Number.isSafeInteger(totalPaise + linePaise)) {
        throw Error('Purchase value exceeds the supported monetary range');
      }
      totalPaise += linePaise;
      normalized.push({
        ...x,
        itemType: it.item_type,
        baseUnit: it.base_unit,
        baseQty,
        baseRate,
        batchNo: x.batchNo || `PUR-${Date.now().toString().slice(-6)}`,
        expiryDate: x.expiryDate || null
      });
    }
    const total = totalPaise / 100;
    const [p] = await c.execute(
      'INSERT INTO purchases(supplier_id, invoice_number, purchase_date, total_amount, created_by) VALUES(?,?,?,?,?)',
      [supplierId, invoiceNumber || null, purchaseDate || new Date().toISOString().slice(0, 10), total.toFixed(2), req.user.id]
    );
    for (const x of normalized) {
      await c.execute('SELECT id FROM stock_ledger WHERE item_type=? AND item_id=? FOR UPDATE', [x.itemType, x.itemId]);
      await c.execute(
        'INSERT INTO purchase_items(purchase_id, item_id, quantity, unit, rate) VALUES(?,?,?,?,?)',
        [p.insertId, x.itemId, x.baseQty, x.baseUnit, x.baseRate]
      );
      await movement(c, {
        type: x.itemType,
        id: x.itemId,
        kind: 'RECEIPT',
        qty: x.baseQty,
        unit: x.baseUnit,
        cost: x.baseRate,
        source: 'PURCHASE',
        sourceId: p.insertId
      }, req.user.id);
      await c.execute(
        `INSERT INTO stock_batches(item_type, item_id, batch_no, expiry_date, initial_qty, remaining_qty, unit, unit_cost, source_type, source_id)
         VALUES(?,?,?,?,?,?,?,?,'PURCHASE',?)`,
        [x.itemType, x.itemId, x.batchNo, x.expiryDate, x.baseQty, x.baseQty, x.baseUnit, x.baseRate, p.insertId]
      );
    }
    await audit(c, req.user.id, 'POST', 'PURCHASE', p.insertId, { supplierId, items, total }, req.ip);
    await c.commit();
    res.status(201).json({ purchaseId: p.insertId, total: total.toFixed(2) });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.post('/:id/return', allowRoles('ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    const { itemId, quantity, reason } = req.body;
    const qty = Number(quantity);
    if (!itemId || !Number.isFinite(qty) || qty <= 0) {
      throw Error('Item ID and positive return quantity are required');
    }
    await c.beginTransaction();
    const [[purchase]] = await c.execute("SELECT id, supplier_id FROM purchases WHERE id=? AND status='POSTED'", [req.params.id]);
    if (!purchase) throw Error('Purchase not found');
    const [[pi]] = await c.execute(
      'SELECT pi.quantity, pi.unit, pi.rate, ii.item_type FROM purchase_items pi JOIN inventory_items ii ON ii.id=pi.item_id WHERE pi.purchase_id=? AND pi.item_id=?',
      [req.params.id, itemId]
    );
    if (!pi) throw Error('Item not found in this purchase');
    if (qty > Number(pi.quantity)) throw Error('Return quantity exceeds purchased quantity');
    const avail = await balance(c, pi.item_type, itemId);
    if (avail < qty) throw Error(`Insufficient stock (${avail} ${pi.unit}) to return ${qty} ${pi.unit}`);

    const [r] = await c.execute(
      'INSERT INTO purchase_returns(purchase_id, item_id, quantity, unit, reason, created_by) VALUES(?,?,?,?,?,?)',
      [req.params.id, itemId, qty, pi.unit, reason || 'Purchase return', req.user.id]
    );
    await movement(c, {
      type: pi.item_type,
      id: itemId,
      kind: 'ADJUSTMENT_OUT',
      qty,
      unit: pi.unit,
      cost: Number(pi.rate),
      source: 'PURCHASE_RETURN',
      sourceId: r.insertId,
      notes: reason || 'Purchase return'
    }, req.user.id);
    await audit(c, req.user.id, 'RETURN', 'PURCHASE', req.params.id, { returnId: r.insertId, itemId, qty, reason }, req.ip);
    await c.commit();
    res.status(201).json({ returnId: r.insertId, message: 'Purchase return recorded' });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

module.exports = router;
