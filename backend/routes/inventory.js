'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { balance, movement, audit } = require('../services/ledger');

router.use(authenticate, allowRoles('OWNER', 'ADMIN', 'PRODUCTION', 'ACCOUNTANT'));

// Every balance is calculated from the source-linked stock ledger; no editable balance column exists.
router.get('/summary', async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT i.id, i.name, i.item_type, i.base_unit, i.reorder_level,
        COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN')
          THEN s.quantity ELSE -s.quantity END), 0) AS balance
      FROM inventory_items i
      LEFT JOIN stock_ledger s ON s.item_type=i.item_type AND s.item_id=i.id
      WHERE i.is_active=1 AND i.item_type<>'FINISHED'
      GROUP BY i.id, i.name, i.item_type, i.base_unit, i.reorder_level
      UNION ALL
      SELECT p.id, CONCAT(p.name, ' ', p.pack_size) AS name, 'FINISHED' AS item_type,
        'packet' AS base_unit, 0 AS reorder_level,
        COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN')
          THEN s.quantity ELSE -s.quantity END), 0) AS balance
      FROM products p
      LEFT JOIN stock_ledger s ON s.item_type='FINISHED' AND s.item_id=p.id
      WHERE p.is_active=1
      GROUP BY p.id, p.name, p.pack_size
      ORDER BY item_type, name`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.get('/ledger', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '250', 10) || 250, 1), 1000);
    const [rows] = await db.execute(`
      SELECT s.id, s.created_at, s.item_type, s.movement_type, s.quantity, s.unit,
        s.unit_cost, s.source_type, s.source_id, s.notes,
        CASE WHEN s.item_type='FINISHED' THEN CONCAT(p.name, ' ', p.pack_size) ELSE i.name END AS item_name
      FROM stock_ledger s
      LEFT JOIN inventory_items i ON s.item_type<>'FINISHED' AND i.id=s.item_id
      LEFT JOIN products p ON s.item_type='FINISHED' AND p.id=s.item_id
      ORDER BY s.created_at DESC, s.id DESC LIMIT ?`, [limit]);
    res.json(rows);
  } catch (error) { next(error); }
});

// Batch & expiry tracking (FEFO order: earliest expiry first)
router.get('/batches', async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT b.*,
             CASE WHEN b.item_type='FINISHED' THEN CONCAT(p.name, ' ', p.pack_size) ELSE i.name END AS item_name,
             DATEDIFF(b.expiry_date, CURDATE()) AS days_to_expiry
      FROM stock_batches b
      LEFT JOIN inventory_items i ON b.item_type<>'FINISHED' AND i.id=b.item_id
      LEFT JOIN products p ON b.item_type='FINISHED' AND p.id=b.item_id
      WHERE b.remaining_qty > 0
      ORDER BY (b.expiry_date IS NULL) ASC, b.expiry_date ASC, b.created_at ASC
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

// FEFO inventory issuing across batches
router.post('/batches/issue-fefo', allowRoles('OWNER', 'ADMIN', 'PRODUCTION'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    const { itemType, itemId, quantity, notes } = req.body;
    const qty = Number(quantity);
    if (!['RAW', 'PACKAGING', 'FINISHED'].includes(itemType) || !Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error('Valid itemType, itemId, and positive quantity are required'), { status: 400 });
    }
    await c.beginTransaction();
    const [batches] = await c.execute(
      `SELECT * FROM stock_batches
       WHERE item_type=? AND item_id=? AND remaining_qty > 0
       ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC FOR UPDATE`,
      [itemType, itemId]
    );
    const totalAvail = batches.reduce((s, b) => s + Number(b.remaining_qty), 0);
    if (totalAvail < qty) {
      throw Object.assign(new Error(`Insufficient batch stock: available ${totalAvail}, requested ${qty}`), { status: 400 });
    }
    let left = qty;
    const allocated = [];
    for (const b of batches) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.remaining_qty));
      await c.execute('UPDATE stock_batches SET remaining_qty = remaining_qty - ? WHERE id=?', [take, b.id]);
      await movement(c, {
        type: itemType,
        id: itemId,
        kind: 'ISSUE',
        qty: take,
        unit: b.unit,
        cost: Number(b.unit_cost || 0),
        source: 'FEFO_ISSUE',
        sourceId: b.id,
        notes: notes || `FEFO batch ${b.batch_no}`
      }, req.user.id);
      allocated.push({ batchId: b.id, batchNo: b.batch_no, expiryDate: b.expiry_date, quantity: take });
      left -= take;
    }
    await audit(c, req.user.id, 'FEFO_ISSUE', 'INVENTORY', itemId, { itemType, qty, allocated }, req.ip);
    await c.commit();
    res.json({ issued: qty, allocated });
  } catch (e) { await c.rollback(); next(e); } finally { c.release(); }
});

// Stock adjustments with approval workflow
router.get('/adjustments', async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT sa.*,
             CASE WHEN sa.item_type='FINISHED' THEN CONCAT(p.name, ' ', p.pack_size) ELSE i.name END AS item_name,
             u1.name AS created_by_name, u2.name AS approved_by_name
      FROM stock_adjustments sa
      LEFT JOIN inventory_items i ON sa.item_type<>'FINISHED' AND i.id=sa.item_id
      LEFT JOIN products p ON sa.item_type='FINISHED' AND p.id=sa.item_id
      LEFT JOIN users u1 ON u1.id=sa.created_by
      LEFT JOIN users u2 ON u2.id=sa.approved_by
      ORDER BY sa.created_at DESC, sa.id DESC
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/adjust', allowRoles('OWNER', 'ADMIN', 'PRODUCTION'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    const { itemType, itemId, direction, quantity, unit, reason } = req.body;
    if (!['RAW', 'PACKAGING', 'FINISHED'].includes(itemType)) {
      throw Object.assign(new Error('Invalid item type'), { status: 400 });
    }
    if (!['IN', 'OUT'].includes(direction)) {
      throw Object.assign(new Error('Direction must be IN or OUT'), { status: 400 });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error('Quantity must be positive'), { status: 400 });
    }
    await c.beginTransaction();
    const [r] = await c.execute(
      "INSERT INTO stock_adjustments(item_type, item_id, direction, quantity, unit, reason, status, created_by) VALUES(?,?,?,?,?,?,'PENDING',?)",
      [itemType, Number(itemId), direction, qty, unit || 'piece', reason || 'Stock adjustment', req.user.id]
    );
    await audit(c, req.user.id, 'REQUEST_ADJUSTMENT', 'STOCK_ADJUSTMENT', r.insertId, { itemType, itemId, direction, qty, reason }, req.ip);
    await c.commit();
    res.status(201).json({ adjustmentId: r.insertId, status: 'PENDING' });
  } catch (e) { await c.rollback(); next(e); } finally { c.release(); }
});

router.post('/adjustments/:id/approve', allowRoles('OWNER', 'ADMIN'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [[adj]] = await c.execute("SELECT * FROM stock_adjustments WHERE id=? AND status='PENDING' FOR UPDATE", [req.params.id]);
    if (!adj) throw Object.assign(new Error('Pending adjustment not found'), { status: 404 });
    if (adj.direction === 'OUT') {
      const avail = await balance(c, adj.item_type, adj.item_id);
      if (avail < Number(adj.quantity)) {
        throw Object.assign(new Error(`Insufficient stock (${avail}) for outbound adjustment`), { status: 400 });
      }
    }
    const kind = adj.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
    await movement(c, {
      type: adj.item_type,
      id: adj.item_id,
      kind,
      qty: Number(adj.quantity),
      unit: adj.unit,
      source: 'STOCK_ADJUSTMENT',
      sourceId: adj.id,
      notes: adj.reason
    }, req.user.id);
    await c.execute("UPDATE stock_adjustments SET status='APPROVED', approved_by=?, approved_at=NOW() WHERE id=?", [req.user.id, adj.id]);
    await audit(c, req.user.id, 'APPROVE_ADJUSTMENT', 'STOCK_ADJUSTMENT', adj.id, { kind, qty: adj.quantity }, req.ip);
    await c.commit();
    res.json({ message: 'Stock adjustment approved and posted to ledger' });
  } catch (e) { await c.rollback(); next(e); } finally { c.release(); }
});

router.post('/adjustments/:id/reject', allowRoles('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const [r] = await db.execute(
      "UPDATE stock_adjustments SET status='REJECTED', approved_by=?, approved_at=NOW() WHERE id=? AND status='PENDING'",
      [req.user.id, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Pending adjustment not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'REJECT_ADJUSTMENT', 'STOCK_ADJUSTMENT', req.params.id, JSON.stringify({}), req.ip]
    );
    res.json({ message: 'Stock adjustment rejected' });
  } catch (e) { next(e); }
});

module.exports = router;
