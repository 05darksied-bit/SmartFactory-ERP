'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { audit } = require('../services/ledger');

router.use(authenticate);

router.post('/', allowRoles('SALESMAN', 'ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { customerId, latitude, longitude, accuracyM, notes } = req.body;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!customerId || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid customerId, latitude (-90..90), and longitude (-180..180) are required' });
    }
    const [[cust]] = await db.execute('SELECT id, name FROM customers WHERE id=? AND is_active=1', [customerId]);
    if (!cust) return res.status(404).json({ error: 'Customer not found' });

    const acc = accuracyM !== undefined && accuracyM !== null ? Number(accuracyM) : null;
    const [r] = await db.execute(
      'INSERT INTO sales_visits(salesman_id, customer_id, latitude, longitude, accuracy_m, notes) VALUES(?,?,?,?,?,?)',
      [req.user.id, customerId, lat.toFixed(7), lng.toFixed(7), Number.isFinite(acc) ? acc.toFixed(2) : null, notes ? String(notes).trim().slice(0, 300) : null]
    );
    await audit(db, req.user.id, 'CHECK_IN', 'SALES_VISIT', r.insertId, { customerId, latitude: lat, longitude: lng }, req.ip);
    res.status(201).json({ visitId: r.insertId, customerName: cust.name });
  } catch (e) { next(e); }
});

router.get('/', allowRoles('SALESMAN', 'ADMIN', 'OWNER', 'ACCOUNTANT'), async (req, res, next) => {
  try {
    const own = req.user.role === 'SALESMAN';
    const [rows] = await db.execute(
      `SELECT v.*, c.name AS customer_name, c.customer_type, u.name AS salesman_name
       FROM sales_visits v
       JOIN customers c ON c.id=v.customer_id
       JOIN users u ON u.id=v.salesman_id
       ${own ? 'WHERE v.salesman_id=?' : ''}
       ORDER BY v.visited_at DESC, v.id DESC
       LIMIT 100`,
      own ? [req.user.id] : []
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
