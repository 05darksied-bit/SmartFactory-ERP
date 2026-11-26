'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');

router.get('/summary', authenticate, allowRoles('OWNER', 'ADMIN', 'ACCOUNTANT'), async (_req, res, next) => {
  try {
    const [[o]] = await db.query("SELECT COUNT(*) total, COALESCE(SUM(total_amount),0) value_total FROM sales_orders WHERE DATE(created_at)=CURDATE()");
    const [[p]] = await db.query('SELECT COUNT(*) total FROM products WHERE is_active=1');
    const [[q]] = await db.query("SELECT COUNT(*) total FROM sales_orders WHERE status IN ('SUBMITTED','APPROVED','INVOICED')");
    const [[v]] = await db.query("SELECT COUNT(DISTINCT pr.id) total FROM production_runs pr LEFT JOIN production_consumption pc ON pc.run_id=pr.id WHERE pr.status='POSTED' AND (ABS((pr.actual_output-pr.expected_output)/NULLIF(pr.expected_output,0))*100>3 OR ABS(pc.variance_percent)>3)");
    const [[ls]] = await db.query(`SELECT COUNT(*) total FROM (SELECT i.id, COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END),0) bal, i.reorder_level FROM inventory_items i LEFT JOIN stock_ledger s ON s.item_type=i.item_type AND s.item_id=i.id WHERE i.item_type<>'FINISHED' AND i.is_active=1 GROUP BY i.id HAVING bal<=i.reorder_level) x`);
    const [[cost]] = await db.query("SELECT cost_per_packet FROM production_runs WHERE status='POSTED' ORDER BY created_at DESC LIMIT 1");
    const [[a]] = await db.query("SELECT COALESCE(SUM(i.total_amount),0)-COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices pi ON pi.id=p.invoice_id WHERE pi.status='POSTED'),0) outstanding FROM invoices i WHERE i.status='POSTED'");
    const [[rev]] = await db.query("SELECT COALESCE(SUM(total_amount),0) total_invoiced, COALESCE(SUM(taxable_value),0) total_taxable FROM invoices WHERE status='POSTED'");
    res.json({
      todayOrders: o.total,
      todayOrderValue: o.value_total,
      activeProducts: p.total,
      pendingOrders: q.total,
      varianceAlerts: v.total,
      lowStockAlerts: ls.total,
      latestCostPerPacket: cost?.cost_per_packet ?? 0,
      outstanding: a.outstanding,
      totalRevenue: rev.total_invoiced,
      totalTaxableRevenue: rev.total_taxable
    });
  } catch (e) { next(e); }
});

router.get('/revenue-chart', authenticate, allowRoles('OWNER', 'ADMIN', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const period = req.query.period || 'daily';
    const days = Math.min(Math.max(Number.parseInt(req.query.days || '30', 10) || 30, 1), 365);
    let groupExpr = 'DATE(created_at)';
    if (period === 'weekly') groupExpr = "DATE_FORMAT(created_at, '%x-W%v')";
    else if (period === 'monthly') groupExpr = "DATE_FORMAT(created_at, '%Y-%m')";
    const [rows] = await db.execute(
      `SELECT ${groupExpr} AS label, COUNT(*) AS order_count, COALESCE(SUM(total_amount),0) AS revenue
       FROM sales_orders
       WHERE status <> 'REJECTED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY ${groupExpr}
       ORDER BY label ASC`,
      [days]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/top-customers', authenticate, allowRoles('OWNER', 'ADMIN', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '5', 10) || 5, 1), 25);
    const [rows] = await db.execute(
      `SELECT c.id, c.name, c.customer_type, COUNT(so.id) AS order_count, COALESCE(SUM(so.total_amount),0) AS revenue
       FROM sales_orders so
       JOIN customers c ON c.id=so.customer_id
       WHERE so.status <> 'REJECTED'
       GROUP BY c.id, c.name, c.customer_type
       ORDER BY revenue DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/production-performance', authenticate, allowRoles('OWNER', 'ADMIN', 'PRODUCTION', 'ACCOUNTANT'), async (_req, res, next) => {
  try {
    const [runs] = await db.query(
      `SELECT pr.id, pr.batch_number, pr.production_date, pr.created_at, p.name AS product_name, p.selling_price,
              pr.expected_output, pr.actual_output, pr.actual_wastage, pr.damaged_pouches,
              pr.material_cost, pr.labour_cost, pr.utility_cost, pr.total_cost, pr.cost_per_packet,
              ROUND(((pr.actual_output - pr.expected_output) / NULLIF(pr.expected_output,0)) * 100, 2) AS yield_variance_pct,
              ROUND(p.selling_price - pr.cost_per_packet, 2) AS margin_per_packet
       FROM production_runs pr
       JOIN products p ON p.id=pr.product_id
       WHERE pr.status='POSTED'
       ORDER BY pr.created_at DESC
       LIMIT 20`
    );
    res.json(runs);
  } catch (e) { next(e); }
});

router.get('/employee-activity', authenticate, allowRoles('OWNER', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const [rows] = await db.execute(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.name AS user_name, u.role AS user_role
       FROM audit_logs a
       LEFT JOIN users u ON u.id=a.user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/inventory-alerts', authenticate, allowRoles('OWNER', 'ADMIN', 'PRODUCTION'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT i.id, i.sku, i.name, i.item_type, i.base_unit, i.reorder_level,
              COALESCE(SUM(CASE WHEN s.movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN s.quantity ELSE -s.quantity END), 0) AS balance
       FROM inventory_items i
       LEFT JOIN stock_ledger s ON s.item_type=i.item_type AND s.item_id=i.id
       WHERE i.is_active=1 AND i.item_type<>'FINISHED'
       GROUP BY i.id, i.sku, i.name, i.item_type, i.base_unit, i.reorder_level
       HAVING balance <= i.reorder_level
       ORDER BY balance ASC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
