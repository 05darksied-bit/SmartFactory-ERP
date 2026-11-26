'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { balance, movement, audit } = require('../services/ledger');
const { convert } = require('../utils/units');

router.post('/runs', authenticate, allowRoles('PRODUCTION', 'ADMIN', 'OWNER'), async (req, res) => {
  const c = await db.getConnection();
  try {
    const {
      productId,
      batchNumber,
      productionDate,
      batchCount = 1,
      actualOutput,
      actualWastage = 0,
      damagedPouches = 0,
      actualConsumption = {},
      labourCost = 0,
      utilityCost = 0
    } = req.body;

    if (!Number.isFinite(Number(batchCount)) || Number(batchCount) <= 0 || !Number.isInteger(Number(actualOutput)) || Number(actualOutput) <= 0) {
      throw Error('Batch count must be positive and good output must be a positive whole packet count');
    }
    if (!Number.isFinite(Number(actualWastage)) || Number(actualWastage) < 0 || !Number.isInteger(Number(damagedPouches)) || Number(damagedPouches) < 0 || !Number.isFinite(Number(labourCost)) || Number(labourCost) < 0 || !Number.isFinite(Number(utilityCost)) || Number(utilityCost) < 0) {
      throw Error('Wastage, damaged pouches and costs must be non-negative numbers');
    }

    await c.beginTransaction();
    const [[p]] = await c.execute('SELECT * FROM products WHERE id=? AND is_active=1 FOR UPDATE', [productId]);
    if (!p) throw Error('Product not found');
    const [bom] = await c.execute(
      `SELECT bi.*, i.name item_name, i.base_unit, i.item_type
       FROM boms b JOIN bom_items bi ON bi.bom_id=b.id JOIN inventory_items i ON i.id=bi.item_id
       WHERE b.product_id=? AND b.is_active=1`,
      [productId]
    );
    if (!bom.length) throw Error('Active BOM is missing');

    const expected = Number(p.expected_yield) * Number(batchCount);
    const prodDate = productionDate || new Date().toISOString().slice(0, 10);
    const batchNo = batchNumber ? String(batchNumber).trim().slice(0, 60) : `BATCH-${prodDate.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

    let materialCost = 0;
    const [rr] = await c.execute(
      "INSERT INTO production_runs(product_id, batch_number, production_date, batch_count, expected_output, actual_output, actual_wastage, damaged_pouches, labour_cost, utility_cost, status, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',?)",
      [productId, batchNo, prodDate, batchCount, expected, actualOutput, actualWastage, damagedPouches, labourCost, utilityCost, req.user.id]
    );
    const runId = rr.insertId;

    for (const line of bom) {
      const planned = convert(Number(line.quantity_per_batch) * Number(batchCount), line.unit, line.base_unit);
      const rawActual = Number(actualConsumption[line.item_id] ?? (Number(line.quantity_per_batch) * Number(batchCount)));
      const actual = convert(rawActual, line.unit, line.base_unit);
      if (!Number.isFinite(actual) || actual < 0) throw Error('Consumption must be a finite non-negative quantity');

      await c.execute('SELECT id FROM stock_ledger WHERE item_type=? AND item_id=? FOR UPDATE', [line.item_type, line.item_id]);
      const available = await balance(c, line.item_type, line.item_id);
      if (available < actual) throw Error(`Insufficient ${line.item_name}: available ${available} ${line.unit}, required ${actual}`);

      const [[costrow]] = await c.execute(
        `SELECT COALESCE(SUM(CASE WHEN movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN quantity*unit_cost ELSE -quantity*unit_cost END),0) stock_value,
                COALESCE(SUM(CASE WHEN movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) on_hand
         FROM stock_ledger WHERE item_type=? AND item_id=?`,
        [line.item_type, line.item_id]
      );
      const avg = Number(costrow.on_hand) > 0 ? Number(costrow.stock_value) / Number(costrow.on_hand) : 0;
      const lineCost = Math.round(actual * avg * 100) / 100;
      materialCost += lineCost;
      const variance = planned ? ((actual - planned) / planned) * 100 : 0;

      await c.execute(
        'INSERT INTO production_consumption(run_id, item_id, planned_quantity, actual_quantity, unit, variance_percent, unit_cost, line_cost) VALUES(?,?,?,?,?,?,?,?)',
        [runId, line.item_id, planned, actual, line.base_unit, variance, avg, lineCost]
      );
      await movement(c, {
        type: line.item_type,
        id: line.item_id,
        kind: 'ISSUE',
        qty: actual,
        unit: line.base_unit,
        cost: avg,
        source: 'PRODUCTION_RUN',
        sourceId: runId,
        notes: `Planned ${planned}; actual ${actual}`
      }, req.user.id);
    }

    const pouchLine = bom.find(x => /pouch/i.test(x.item_name));
    if (pouchLine) {
      const damaged = Number(req.body.damagedPouches || 0);
      const prior = Number(actualConsumption[pouchLine.item_id] ?? Number(pouchLine.quantity_per_batch) * batchCount);
      if (damaged > prior) throw Error('Damaged pouches cannot exceed total pouch consumption');
      if (prior < Number(actualOutput) + damaged) throw Error('Pouch consumption must cover good output plus damaged pouches');
    }

    materialCost = Math.round(materialCost * 100) / 100;
    const total = (Math.round(materialCost * 100) + Math.round(Number(labourCost) * 100) + Math.round(Number(utilityCost) * 100)) / 100;
    const unitCost = Number(actualOutput) > 0 ? total / Number(actualOutput) : 0;

    await c.execute(
      "UPDATE production_runs SET material_cost=?, total_cost=?, cost_per_packet=?, status='POSTED' WHERE id=?",
      [materialCost.toFixed(2), total.toFixed(2), unitCost.toFixed(4), runId]
    );
    await movement(c, {
      type: 'FINISHED',
      id: productId,
      kind: 'PRODUCTION_IN',
      qty: actualOutput,
      unit: 'packet',
      cost: unitCost,
      source: 'PRODUCTION_RUN',
      sourceId: runId
    }, req.user.id);

    // Record finished-goods batch
    await c.execute(
      "INSERT INTO stock_batches(item_type, item_id, batch_no, expiry_date, initial_qty, remaining_qty, unit, unit_cost, source_type, source_id) VALUES('FINISHED', ?, ?, DATE_ADD(?, INTERVAL 90 DAY), ?, ?, 'packet', ?, 'PRODUCTION_RUN', ?)",
      [productId, batchNo, prodDate, actualOutput, actualOutput, unitCost, runId]
    );

    await audit(c, req.user.id, 'POST', 'PRODUCTION_RUN', runId, {
      batchNumber: batchNo, productionDate: prodDate, expected, actualOutput, actualWastage, damagedPouches, materialCost, total, unitCost
    }, req.ip);
    await c.commit();

    res.status(201).json({
      runId,
      batchNumber: batchNo,
      productionDate: prodDate,
      expectedOutput: expected,
      actualOutput,
      yieldVariancePercent: ((actualOutput - expected) / expected) * 100,
      damagedPouches,
      materialCost,
      totalCost: total,
      costPerPacket: unitCost,
      alerts: {
        yield: Math.abs((actualOutput - expected) / expected * 100) > 3,
        consumption: bom.filter(x => {
          const q = Number(actualConsumption[x.item_id] ?? Number(x.quantity_per_batch) * batchCount);
          return Math.abs((q - Number(x.quantity_per_batch) * batchCount) / (Number(x.quantity_per_batch) * batchCount) * 100) > 3;
        }).map(x => x.item_name)
      }
    });
  } catch (e) {
    await c.rollback();
    res.status(400).json({ error: e.message });
  } finally { c.release(); }
});

router.get('/runs', authenticate, allowRoles('PRODUCTION', 'ADMIN', 'OWNER', 'ACCOUNTANT'), async (_req, res, next) => {
  try {
    const [r] = await db.query(
      `SELECT pr.*, p.name product_name, p.pack_size
       FROM production_runs pr
       JOIN products p ON p.id=pr.product_id
       ORDER BY pr.created_at DESC`
    );
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/bom/:productId', authenticate, allowRoles('PRODUCTION', 'ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const [[product]] = await db.execute('SELECT id, name, pack_size, expected_yield FROM products WHERE id=? AND is_active=1', [req.params.productId]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const [items] = await db.execute(
      `SELECT bi.id, bi.item_id, bi.item_type, bi.quantity_per_batch, bi.unit,
              i.name AS item_name, i.base_unit,
              COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END), 0) AS current_balance
       FROM boms b
       JOIN bom_items bi ON bi.bom_id=b.id
       JOIN inventory_items i ON i.id=bi.item_id
       LEFT JOIN stock_ledger s ON s.item_type=bi.item_type AND s.item_id=bi.item_id
       WHERE b.product_id=? AND b.is_active=1
       GROUP BY bi.id, bi.item_id, bi.item_type, bi.quantity_per_batch, bi.unit, i.name, i.base_unit`,
      [req.params.productId]
    );
    res.json({ product, items });
  } catch (e) { next(e); }
});

router.get('/analytics', authenticate, allowRoles('PRODUCTION', 'ADMIN', 'OWNER', 'ACCOUNTANT'), async (_req, res, next) => {
  try {
    const [[totals]] = await db.query(
      `SELECT COUNT(*) AS total_runs,
              COALESCE(SUM(actual_output),0) AS total_output,
              COALESCE(SUM(actual_wastage),0) AS total_wastage,
              COALESCE(SUM(damaged_pouches),0) AS total_damaged,
              COALESCE(AVG(cost_per_packet),0) AS avg_cost_per_packet
       FROM production_runs WHERE status='POSTED'`
    );
    res.json(totals);
  } catch (e) { next(e); }
});

module.exports = router;
