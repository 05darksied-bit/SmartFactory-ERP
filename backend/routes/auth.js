'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, getJwtSecret } = require('../middleware/auth');

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const [rows] = await db.execute(
      'SELECT id, name, email, password_hash, role, sales_target FROM users WHERE email=? AND is_active=1',
      [email]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      getJwtSecret(),
      { expiresIn: '8h' }
    );
    await db.execute(
      'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
      [user.id, 'LOGIN', 'USER', user.id, JSON.stringify({ role: user.role }), req.ip]
    ).catch(() => {});
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, sales_target: Number(user.sales_target || 50000) }
    });
  } catch (e) { next(e); }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [[user]] = await db.execute(
      'SELECT id, name, email, role, sales_target, is_active FROM users WHERE id=? AND is_active=1',
      [req.user.id]
    );
    if (!user) return res.status(401).json({ error: 'Account inactive or not found' });
    res.json(user);
  } catch (e) { next(e); }
});

router.post('/logout', authenticate, async (req, res) => {
  await db.execute(
    'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, after_data, ip_address) VALUES(?,?,?,?,?,?)',
    [req.user.id, 'LOGOUT', 'USER', req.user.id, JSON.stringify({}), req.ip]
  ).catch(() => {});
  res.json({ message: 'Logged out' });
});

module.exports = router;
