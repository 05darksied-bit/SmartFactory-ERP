'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { convert } = require('../utils/units');

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateGstin(gstin) {
  if (!gstin) return null;
  const clean = String(gstin).trim().toUpperCase();
  if (!GSTIN_RE.test(clean)) {
    throw Object.assign(new Error('Invalid GSTIN format (expected 15-character Indian GSTIN e.g. 33AAAAA0000A1Z5)'), { status: 400 });
  }
  return clean;
}

function validateStateCode(code, required = true) {
  if (!code) {
    if (required) throw Object.assign(new Error('GST state code is required (01–38)'), { status: 400 });
    return null;
  }
  const clean = String(code).trim().padStart(2, '0');
  if (!STATE_CODE_RE.test(clean)) {
    throw Object.assign(new Error('Invalid GST state code (must be 01 to 38)'), { status: 400 });
  }
  return clean;
}

function validateEmail(email) {
  if (!email) return null;
  const clean = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) {
    throw Object.assign(new Error('Invalid email address'), { status: 400 });
  }
  return clean;
}

function validateImageUrl(url) {
  if (!url) return null;
  const clean = String(url).trim();
  if (!/^(https?:\/\/|\/)/i.test(clean)) {
    throw Object.assign(new Error('Image URL must start with http://, https://, or /'), { status: 400 });
  }
  return clean.slice(0, 500);
}

router.use(authenticate);

// ── CUSTOMERS ──────────────────────────────────────────────────────────────────
router.get('/customers', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1' && ['ADMIN', 'OWNER', 'ACCOUNTANT'].includes(req.user.role);
    const typeFilter = ['RETAILER', 'DISTRIBUTOR'].includes(req.query.type) ? req.query.type : null;
    const q = String(req.query.q || '').trim();

    const conds = [];
    const params = [];
    if (!includeInactive) conds.push('c.is_active=1');
    if (typeFilter) { conds.push('c.customer_type=?'); params.push(typeFilter); }
    if (q) {
      conds.push('(c.name LIKE ? OR c.gstin LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [r] = await db.execute(
      `SELECT c.*,
              COALESCE(inv.total_invoiced, 0) - COALESCE(inv.total_collected, 0) AS outstanding
       FROM customers c
       LEFT JOIN (
         SELECT so.customer_id,
                SUM(i.total_amount) AS total_invoiced,
                SUM(COALESCE(p.paid, 0)) AS total_collected
         FROM invoices i
         JOIN sales_orders so ON so.id=i.order_id
         LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id
         WHERE i.status='POSTED'
         GROUP BY so.customer_id
       ) inv ON inv.customer_id=c.id
       ${whereClause}
       ORDER BY c.is_active DESC, c.name ASC`,
      params
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/customers', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { name, customerType, stateCode, gstin, address, phone, email, creditLimit = 100000 } = req.body;
    if (!name || !String(name).trim() || !['RETAILER', 'DISTRIBUTOR'].includes(customerType)) {
      return res.status(400).json({ error: 'Name and customer type (RETAILER/DISTRIBUTOR) are required' });
    }
    const cleanState = validateStateCode(stateCode, true);
    const cleanGstin = validateGstin(gstin);
    const cleanEmail = validateEmail(email);
    const cl = Number(creditLimit);
    if (!Number.isFinite(cl) || cl < 0) {
      return res.status(400).json({ error: 'Credit limit must be a non-negative number' });
    }
    const [r] = await db.execute(
      'INSERT INTO customers(name, customer_type, state_code, gstin, address, phone, email, credit_limit) VALUES(?,?,?,?,?,?,?,?)',
      [String(name).trim(), customerType, cleanState, cleanGstin, address || null, phone || null, cleanEmail, cl.toFixed(2)]
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREATE', 'CUSTOMER', r.insertId, JSON.stringify({ name, customerType, stateCode: cleanState, gstin: cleanGstin }), req.ip]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/customers/:id', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { name, customerType, stateCode, gstin, address, phone, email, creditLimit, isActive } = req.body;
    if (customerType && !['RETAILER', 'DISTRIBUTOR'].includes(customerType)) {
      return res.status(400).json({ error: 'Invalid customer type' });
    }
    const cleanState = stateCode !== undefined ? validateStateCode(stateCode, true) : null;
    const cleanGstin = gstin !== undefined ? validateGstin(gstin) : undefined;
    const cleanEmail = email !== undefined ? validateEmail(email) : undefined;
    const cl = creditLimit !== undefined ? Number(creditLimit) : null;
    if (cl !== null && (!Number.isFinite(cl) || cl < 0)) {
      return res.status(400).json({ error: 'Credit limit must be non-negative' });
    }
    const [r] = await db.execute(
      `UPDATE customers SET
        name=COALESCE(?, name),
        customer_type=COALESCE(?, customer_type),
        state_code=COALESCE(?, state_code),
        gstin=${cleanGstin !== undefined ? '?' : 'gstin'},
        address=${address !== undefined ? '?' : 'address'},
        phone=${phone !== undefined ? '?' : 'phone'},
        email=${cleanEmail !== undefined ? '?' : 'email'},
        credit_limit=COALESCE(?, credit_limit),
        is_active=COALESCE(?, is_active)
       WHERE id=?`,
      [
        name ? String(name).trim() : null,
        customerType || null,
        cleanState,
        ...(cleanGstin !== undefined ? [cleanGstin] : []),
        ...(address !== undefined ? [address || null] : []),
        ...(phone !== undefined ? [phone || null] : []),
        ...(cleanEmail !== undefined ? [cleanEmail] : []),
        cl !== null ? cl.toFixed(2) : null,
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        req.params.id
      ]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Customer not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'UPDATE', 'CUSTOMER', req.params.id, JSON.stringify({ name, customerType, isActive }), req.ip]
    );
    res.json({ message: 'Customer updated' });
  } catch (e) { next(e); }
});

router.patch('/customers/:id/status', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive boolean is required' });
    const [r] = await db.execute('UPDATE customers SET is_active=? WHERE id=?', [isActive ? 1 : 0, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Customer not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, isActive ? 'ACTIVATE' : 'DEACTIVATE', 'CUSTOMER', req.params.id, JSON.stringify({ isActive }), req.ip]
    );
    res.json({ message: `Customer ${isActive ? 'activated' : 'deactivated'}` });
  } catch (e) { next(e); }
});

router.get('/customers/:id/outstanding', async (req, res, next) => {
  try {
    const [[cust]] = await db.execute('SELECT id, name, credit_limit FROM customers WHERE id=?', [req.params.id]);
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    const [[row]] = await db.execute(
      `SELECT COALESCE(SUM(i.total_amount), 0) AS total_invoiced,
              COALESCE(SUM(COALESCE(p.paid, 0)), 0) AS total_collected
       FROM invoices i JOIN sales_orders so ON so.id=i.order_id
       LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id
       WHERE so.customer_id=? AND i.status='POSTED'`,
      [req.params.id]
    );
    const outstanding = Number(row.total_invoiced) - Number(row.total_collected);
    res.json({
      customer_id: cust.id,
      customer_name: cust.name,
      credit_limit: Number(cust.credit_limit || 0),
      total_invoiced: Number(row.total_invoiced).toFixed(2),
      total_collected: Number(row.total_collected).toFixed(2),
      outstanding: outstanding.toFixed(2)
    });
  } catch (e) { next(e); }
});

router.get('/customers/:id/orders', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT so.id, so.status, so.total_amount, so.created_at, i.invoice_number, i.total_amount AS invoice_total
       FROM sales_orders so
       LEFT JOIN invoices i ON i.order_id=so.id AND i.status='POSTED'
       WHERE so.customer_id=?
       ORDER BY so.created_at DESC LIMIT 30`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── PRODUCTS ───────────────────────────────────────────────────────────────────
router.get('/products', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1' && ['ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'].includes(req.user.role);
    const q = String(req.query.q || '').trim();
    const conds = [];
    const params = [];
    if (!includeInactive) conds.push('p.is_active=1');
    if (q) { conds.push('(p.sku LIKE ? OR p.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [r] = await db.execute(
      `SELECT p.*,
              COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END), 0) AS finished_stock
       FROM products p
       LEFT JOIN stock_ledger s ON s.item_type='FINISHED' AND s.item_id=p.id
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.is_active DESC, p.name ASC`,
      params
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/products', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { sku, name, packSize, expectedYield, sellingPrice, hsnCode, gstRate = 5, imageUrl } = req.body;
    if (!sku || !name || !packSize || !hsnCode || !Number.isFinite(Number(expectedYield)) || Number(expectedYield) <= 0 || !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0 || !Number.isFinite(Number(gstRate)) || Number(gstRate) < 0 || Number(gstRate) > 100) {
      return res.status(400).json({ error: 'Provide product details, positive expected yield, non-negative price and GST rate from 0 to 100' });
    }
    const cleanImg = validateImageUrl(imageUrl);
    const [r] = await db.execute(
      'INSERT INTO products(sku, name, pack_size, expected_yield, selling_price, hsn_code, gst_rate, image_url) VALUES(?,?,?,?,?,?,?,?)',
      [String(sku).trim(), String(name).trim(), String(packSize).trim(), expectedYield, sellingPrice, String(hsnCode).trim(), gstRate, cleanImg]
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREATE', 'PRODUCT', r.insertId, JSON.stringify({ sku, name, sellingPrice }), req.ip]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.put('/products/:id', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { name, packSize, expectedYield, sellingPrice, hsnCode, gstRate, imageUrl, isActive } = req.body;
    if (expectedYield !== undefined && (!Number.isFinite(Number(expectedYield)) || Number(expectedYield) <= 0)) {
      return res.status(400).json({ error: 'Expected yield must be positive' });
    }
    if (sellingPrice !== undefined && (!Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0)) {
      return res.status(400).json({ error: 'Selling price must be non-negative' });
    }
    if (gstRate !== undefined && (!Number.isFinite(Number(gstRate)) || Number(gstRate) < 0 || Number(gstRate) > 100)) {
      return res.status(400).json({ error: 'GST rate must be between 0 and 100' });
    }
    const cleanImg = imageUrl !== undefined ? validateImageUrl(imageUrl) : undefined;
    const [r] = await db.execute(
      `UPDATE products SET
        name=COALESCE(?, name),
        pack_size=COALESCE(?, pack_size),
        expected_yield=COALESCE(?, expected_yield),
        selling_price=COALESCE(?, selling_price),
        hsn_code=COALESCE(?, hsn_code),
        gst_rate=COALESCE(?, gst_rate),
        image_url=${cleanImg !== undefined ? '?' : 'image_url'},
        is_active=COALESCE(?, is_active)
       WHERE id=?`,
      [
        name ? String(name).trim() : null,
        packSize ? String(packSize).trim() : null,
        expectedYield !== undefined ? Number(expectedYield) : null,
        sellingPrice !== undefined ? Number(sellingPrice) : null,
        hsnCode ? String(hsnCode).trim() : null,
        gstRate !== undefined ? Number(gstRate) : null,
        ...(cleanImg !== undefined ? [cleanImg] : []),
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        req.params.id
      ]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Product not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'UPDATE', 'PRODUCT', req.params.id, JSON.stringify({ name, sellingPrice, isActive }), req.ip]
    );
    res.json({ message: 'Product updated' });
  } catch (e) { next(e); }
});

router.patch('/products/:id/status', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive boolean is required' });
    const [r] = await db.execute('UPDATE products SET is_active=? WHERE id=?', [isActive ? 1 : 0, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Product not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, isActive ? 'ACTIVATE' : 'DEACTIVATE', 'PRODUCT', req.params.id, JSON.stringify({ isActive }), req.ip]
    );
    res.json({ message: `Product ${isActive ? 'activated' : 'deactivated'}` });
  } catch (e) { next(e); }
});

router.get('/products/:id/history', allowRoles('ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const [sales] = await db.execute(
      `SELECT so.id order_id, so.created_at, so.status, c.name customer_name, soi.quantity, soi.unit_price
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id=soi.order_id
       JOIN customers c ON c.id=so.customer_id
       WHERE soi.product_id=?
       ORDER BY so.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    const [production] = await db.execute(
      `SELECT id, batch_number, production_date, created_at, expected_output, actual_output, actual_wastage, cost_per_packet, status
       FROM production_runs
       WHERE product_id=?
       ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ sales, production });
  } catch (e) { next(e); }
});

// ── INVENTORY ITEMS ────────────────────────────────────────────────────────────
router.get('/inventory-items', allowRoles('ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1' && ['ADMIN', 'OWNER'].includes(req.user.role);
    const [r] = await db.query(
      `SELECT i.*,
              COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END), 0) AS balance
       FROM inventory_items i
       LEFT JOIN stock_ledger s ON s.item_type=i.item_type AND s.item_id=i.id
       WHERE ${includeInactive ? '1=1' : 'i.is_active=1'} AND i.item_type<>'FINISHED'
       GROUP BY i.id
       ORDER BY i.item_type, i.name`
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/inventory-items', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { sku, name, itemType, baseUnit, reorderLevel = 0, opening = 0 } = req.body;
    if (!['RAW', 'PACKAGING'].includes(itemType)) {
      return res.status(400).json({ error: 'Inventory items must be RAW or PACKAGING; finished goods are maintained against products' });
    }
    if (!sku || !name || !['kg', 'g', 'litre', 'ml', 'piece', 'packet', 'carton'].includes(baseUnit) || !Number.isFinite(Number(opening)) || Number(opening) < 0 || !Number.isFinite(Number(reorderLevel)) || Number(reorderLevel) < 0) {
      return res.status(400).json({ error: 'Provide valid item details, unit, opening quantity and reorder level' });
    }
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      const [r] = await c.execute(
        'INSERT INTO inventory_items(sku, name, item_type, base_unit, reorder_level) VALUES(?,?,?,?,?)',
        [String(sku).trim(), String(name).trim(), itemType, baseUnit, reorderLevel]
      );
      if (Number(opening) > 0) {
        await c.execute(
          "INSERT INTO stock_ledger(item_type, item_id, movement_type, quantity, unit, source_type, source_id, created_by) VALUES(?,?,'OPENING',?,?,'MASTER_OPENING',?,?)",
          [itemType, r.insertId, opening, baseUnit, r.insertId, req.user.id]
        );
      }
      await c.execute(
        'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
        [req.user.id, 'CREATE', 'INVENTORY_ITEM', r.insertId, JSON.stringify({ sku, name, itemType, opening }), req.ip]
      );
      await c.commit();
      res.status(201).json({ id: r.insertId });
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  } catch (e) { next(e); }
});

router.put('/inventory-items/:id', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { name, reorderLevel, isActive } = req.body;
    if (reorderLevel !== undefined && (!Number.isFinite(Number(reorderLevel)) || Number(reorderLevel) < 0)) {
      return res.status(400).json({ error: 'Reorder level must be non-negative' });
    }
    const [r] = await db.execute(
      `UPDATE inventory_items SET
        name=COALESCE(?, name),
        reorder_level=COALESCE(?, reorder_level),
        is_active=COALESCE(?, is_active)
       WHERE id=?`,
      [name ? String(name).trim() : null, reorderLevel !== undefined ? Number(reorderLevel) : null, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ message: 'Inventory item updated' });
  } catch (e) { next(e); }
});

// ── BOM MANAGEMENT ─────────────────────────────────────────────────────────────
router.get('/boms/:productId', allowRoles('ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const [r] = await db.execute(
      `SELECT b.id bom_id, b.version_no, b.effective_date, b.notes, bi.*, i.name item_name, i.base_unit,
              COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END), 0) AS current_balance
       FROM boms b
       JOIN bom_items bi ON bi.bom_id=b.id
       JOIN inventory_items i ON i.id=bi.item_id
       LEFT JOIN stock_ledger s ON s.item_type=bi.item_type AND s.item_id=bi.item_id
       WHERE b.product_id=? AND b.is_active=1
       GROUP BY b.id, b.version_no, b.effective_date, b.notes, bi.id, i.name, i.base_unit`,
      [req.params.productId]
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/boms/:productId/versions', allowRoles('ADMIN', 'OWNER', 'PRODUCTION', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const [boms] = await db.execute(
      'SELECT id, product_id, version_no, effective_date, notes, is_active, created_at FROM boms WHERE product_id=? ORDER BY version_no DESC',
      [req.params.productId]
    );
    for (const b of boms) {
      const [items] = await db.execute(
        `SELECT bi.*, i.name AS item_name, i.base_unit
         FROM bom_items bi JOIN inventory_items i ON i.id=bi.item_id
         WHERE bi.bom_id=? ORDER BY bi.item_type, i.name`,
        [b.id]
      );
      b.items = items;
    }
    res.json(boms);
  } catch (e) { next(e); }
});

router.post('/boms', allowRoles('ADMIN', 'OWNER'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    const { productId, effectiveDate, notes, items } = req.body;
    if (!productId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Product and BOM lines are required' });
    }
    const seen = new Set();
    for (const x of items) {
      const key = String(x.itemId);
      if (seen.has(key)) {
        return res.status(400).json({ error: 'Duplicate BOM component detected; each inventory item may appear only once' });
      }
      seen.add(key);
    }

    await c.beginTransaction();
    const [[parentProduct]] = await c.execute('SELECT id FROM products WHERE id=? AND is_active=1 FOR UPDATE', [productId]);
    if (!parentProduct) throw Object.assign(new Error('Product not found or inactive'), { status: 400 });

    const [[version]] = await c.execute('SELECT COALESCE(MAX(version_no),0)+1 next_version FROM boms WHERE product_id=?', [productId]);
    await c.execute('UPDATE boms SET is_active=0 WHERE product_id=?', [productId]);

    const effDate = effectiveDate || new Date().toISOString().slice(0, 10);
    const [b] = await c.execute(
      'INSERT INTO boms(product_id, version_no, effective_date, notes, is_active) VALUES(?,?,?,?,1)',
      [productId, version.next_version, effDate, notes ? String(notes).trim().slice(0, 255) : null]
    );
    for (const x of items) {
      const [[item]] = await c.execute('SELECT item_type, base_unit FROM inventory_items WHERE id=? AND is_active=1', [x.itemId]);
      if (!item || (x.itemType && item.item_type !== x.itemType) || !['RAW', 'PACKAGING'].includes(item.item_type)) {
        throw Object.assign(new Error(`Invalid BOM inventory item: ${x.itemId}`), { status: 400 });
      }
      if (!Number.isFinite(Number(x.quantityPerBatch)) || Number(x.quantityPerBatch) <= 0) {
        throw Object.assign(new Error('BOM quantities must be positive finite numbers'), { status: 400 });
      }
      convert(Number(x.quantityPerBatch), x.unit, item.base_unit);
      await c.execute(
        'INSERT INTO bom_items(bom_id, item_id, item_type, quantity_per_batch, unit) VALUES(?,?,?,?,?)',
        [b.insertId, x.itemId, item.item_type, x.quantityPerBatch, x.unit]
      );
    }
    await c.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREATE_BOM_VERSION', 'BOM', b.insertId, JSON.stringify({ productId, version: version.next_version, effectiveDate: effDate }), req.ip]
    );
    await c.commit();
    res.status(201).json({ bomId: b.insertId, versionNo: version.next_version });
  } catch (e) { await c.rollback(); next(e); } finally { c.release(); }
});

// ── USER MANAGEMENT (OWNER ONLY) ───────────────────────────────────────────────
router.get('/users', allowRoles('OWNER'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT id, name, email, role, sales_target, is_active, created_at FROM users ORDER BY id ASC');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/users', allowRoles('OWNER'), async (req, res, next) => {
  try {
    const { name, email, password, role, salesTarget = 50000 } = req.body;
    if (!name || !email || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'Name, email and password (min 8 chars) are required' });
    }
    if (!['OWNER', 'ADMIN', 'SALESMAN', 'PRODUCTION', 'ACCOUNTANT'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const cleanEmail = validateEmail(email);
    const hash = await bcrypt.hash(String(password), 12);
    const [r] = await db.execute(
      'INSERT INTO users(name, email, password_hash, role, sales_target) VALUES(?,?,?,?,?)',
      [String(name).trim(), cleanEmail, hash, role, Number(salesTarget) || 50000]
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'CREATE_USER', 'USER', r.insertId, JSON.stringify({ name, email: cleanEmail, role }), req.ip]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.patch('/users/:id', allowRoles('OWNER'), async (req, res, next) => {
  try {
    const { role, isActive, salesTarget } = req.body;
    if (role && !['OWNER', 'ADMIN', 'SALESMAN', 'PRODUCTION', 'ACCOUNTANT'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (Number(req.params.id) === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const [r] = await db.execute(
      `UPDATE users SET
        role=COALESCE(?, role),
        is_active=COALESCE(?, is_active),
        sales_target=COALESCE(?, sales_target)
       WHERE id=?`,
      [role || null, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null, salesTarget !== undefined ? Number(salesTarget) : null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'UPDATE_USER', 'USER', req.params.id, JSON.stringify({ role, isActive, salesTarget }), req.ip]
    );
    res.json({ message: 'User updated' });
  } catch (e) { next(e); }
});

module.exports = router;
