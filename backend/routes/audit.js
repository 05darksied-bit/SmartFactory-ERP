'use strict';
const router = require('express').Router();
const db = require('../config/db');
const { authenticate, allowRoles } = require('../middleware/auth');

router.use(authenticate, allowRoles('OWNER', 'ACCOUNTANT', 'ADMIN'));

router.get('/logs', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const { entityType, userId, action, from, to } = req.query;
    const conditions = ['1=1'];
    const params = [];
    if (entityType) { conditions.push('a.entity_type=?'); params.push(entityType); }
    if (action) { conditions.push('a.action=?'); params.push(action); }
    if (userId && Number.isInteger(Number(userId))) { conditions.push('a.user_id=?'); params.push(Number(userId)); }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { conditions.push('DATE(a.created_at)>=?'); params.push(from); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { conditions.push('DATE(a.created_at)<=?'); params.push(to); }
    params.push(limit);

    const [rows] = await db.execute(
      `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.after_data, a.ip_address, a.created_at,
              u.name AS user_name, u.role AS user_role
       FROM audit_logs a
       LEFT JOIN users u ON u.id=a.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/user-activity', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role,
              COUNT(a.id) AS total_actions,
              MAX(a.created_at) AS last_activity
       FROM users u
       LEFT JOIN audit_logs a ON a.user_id=u.id
       GROUP BY u.id, u.name, u.email, u.role
       ORDER BY total_actions DESC, u.name ASC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
