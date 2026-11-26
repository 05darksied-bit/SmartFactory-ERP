'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

/* ── Validate required env vars early so errors are obvious ── */
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[DB] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.DB_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('[DB] DB_PASSWORD must be set in production');
  process.exit(1);
}

const poolConfig = {
  host:              process.env.DB_HOST,
  port:              Number(process.env.DB_PORT),
  user:              process.env.DB_USER,
  password:          process.env.DB_PASSWORD || '',
  database:          process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:   10,
  queueLimit:        0,
  decimalNumbers:    false,
  timezone:          'Z',
  /* MySQL 8 compatibility */
  supportBigNumbers: true,
  bigNumberStrings:  false,
  /* Reconnect on stale connections */
  enableKeepAlive:   true,
  keepAliveInitialDelay: 0,
};

const pool = mysql.createPool(poolConfig);

/* ── Warm-up: verify connectivity at startup without crashing the pool ── */
pool.getConnection()
  .then(conn => {
    conn.release();
    console.log(
      `[DB] MySQL pool connected → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
    );
  })
  .catch(err => {
    /* Log the problem but let the app start; individual route errors will surface clearly */
    console.error(`[DB] ⚠  Could not connect to MySQL on startup: ${err.message}`);
    console.error('[DB] Make sure MySQL is running and credentials in .env are correct.');
  });

module.exports = pool;
