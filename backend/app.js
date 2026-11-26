'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(x => x.trim()) }));
}
app.use(express.json({ limit: '1mb' }));

// Login-specific rate limiting: max 10 failed attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Please try again after 15 minutes.' }
});
app.use('/api/auth/login', loginLimiter);

// Global API rate limit
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/production', require('./routes/production'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/utils', require('./routes/utilities'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/qc', require('./routes/qc'));
app.use('/api/visits', require('./routes/visits'));

app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'SmartFactory ERP' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' && status === 500 ? 'Internal server error' : err.message
  });
});

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`SmartFactory ERP: http://localhost:${port}`));
}

module.exports = app;
