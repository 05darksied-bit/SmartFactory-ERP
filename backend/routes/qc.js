'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { audit } = require('../services/ledger');

router.use(authenticate, allowRoles('PRODUCTION', 'ADMIN', 'OWNER', 'ACCOUNTANT'));

router.get('/inspections', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT qi.*, pr.batch_number, pr.actual_output, p.name AS product_name, p.sku, u.name AS inspector_name
       FROM quality_inspections qi
       JOIN production_runs pr ON pr.id=qi.run_id
       JOIN products p ON p.id=pr.product_id
       JOIN users u ON u.id=qi.inspector_id
       ORDER BY qi.inspection_date DESC, qi.id DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/inspections', allowRoles('PRODUCTION', 'ADMIN', 'OWNER'), async (req, res, next) => {
  const c = await db.getConnection();
  try {
    const { runId, inspectionDate, status, rejectedQty = 0, defectType, checklist, correctiveAction, notes } = req.body;
    if (!runId || !['PASSED', 'FAILED', 'CONDITIONAL'].includes(status)) {
      throw Object.assign(new Error('Production run and valid inspection status (PASSED/FAILED/CONDITIONAL) are required'), { status: 400 });
    }
    const rej = Number(rejectedQty);
    if (!Number.isInteger(rej) || rej < 0) {
      throw Object.assign(new Error('Rejected quantity must be a non-negative whole number'), { status: 400 });
    }
    await c.beginTransaction();
    const [[run]] = await c.execute('SELECT id, actual_output FROM production_runs WHERE id=?', [runId]);
    if (!run) throw Object.assign(new Error('Production run not found'), { status: 404 });
    if (rej > Number(run.actual_output)) {
      throw Object.assign(new Error('Rejected quantity cannot exceed production output'), { status: 400 });
    }
    const dateStr = inspectionDate || new Date().toISOString().slice(0, 10);
    const [r] = await c.execute(
      `INSERT INTO quality_inspections(run_id, inspector_id, inspection_date, status, rejected_qty, defect_type, checklist, corrective_action, notes)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [runId, req.user.id, dateStr, status, rej, defectType || null, JSON.stringify(checklist || {}), correctiveAction || null, notes || null]
    );
    await audit(c, req.user.id, 'QC_INSPECT', 'QUALITY_INSPECTION', r.insertId, { runId, status, rejectedQty: rej, defectType }, req.ip);
    await c.commit();
    res.status(201).json({ inspectionId: r.insertId, status });
  } catch (e) {
    await c.rollback();
    next(e);
  } finally { c.release(); }
});

router.patch('/inspections/:id', allowRoles('PRODUCTION', 'ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { status, correctiveAction, notes } = req.body;
    if (status && !['PASSED', 'FAILED', 'CONDITIONAL'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const [r] = await db.execute(
      `UPDATE quality_inspections
       SET status=COALESCE(?, status), corrective_action=COALESCE(?, corrective_action), notes=COALESCE(?, notes)
       WHERE id=?`,
      [status || null, correctiveAction ?? null, notes ?? null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Inspection not found' });
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [req.user.id, 'QC_UPDATE', 'QUALITY_INSPECTION', req.params.id, JSON.stringify({ status, correctiveAction }), req.ip]
    );
    res.json({ message: 'Inspection updated' });
  } catch (e) { next(e); }
});

module.exports = router;
