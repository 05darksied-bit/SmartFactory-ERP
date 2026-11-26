'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

function resolveDbConfig() {
  const urlString = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (urlString && !process.env.DB_HOST && !process.env.MYSQLHOST) {
    const parsed = new URL(urlString);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
    };
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE,
  };
}

const resolved = resolveDbConfig();

/* ── Validate required env vars early so errors are obvious ── */
const required = [
  ['host', 'DB_HOST or MYSQLHOST'],
  ['port', 'DB_PORT or MYSQLPORT'],
  ['user', 'DB_USER or MYSQLUSER'],
  ['database', 'DB_NAME or MYSQLDATABASE'],
];
for (const [key, label] of required) {
  if (!resolved[key]) {
    console.error(`[DB] Missing required database configuration: ${label}`);
    process.exit(1);
  }
}
if (!resolved.password && process.env.NODE_ENV === 'production') {
  console.error('[DB] DB_PASSWORD or MYSQLPASSWORD must be set in production');
  process.exit(1);
}

const poolConfig = {
  host:               resolved.host,
  port:               resolved.port,
  user:               resolved.user,
  password:           resolved.password,
  database:           resolved.database,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  decimalNumbers:     false,
  timezone:           'Z',
  /* MySQL 8 compatibility */
  supportBigNumbers:  true,
  bigNumberStrings:   false,
  /* Reconnect on stale connections */
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
};

const pool = mysql.createPool(poolConfig);

/* ── Warm-up: verify connectivity at startup without crashing the pool ── */
pool.getConnection()
  .then(conn => {
    conn.release();
    console.log(
      `[DB] MySQL pool connected → ${resolved.host}:${resolved.port}/${resolved.database}`
    );
  })
  .catch(err => {
    /* Log the problem but let the app start; individual route errors will surface clearly */
    console.error(`[DB] ⚠  Could not connect to MySQL on startup: ${err.message}`);
    console.error('[DB] Make sure MySQL is running and database environment variables are correct.');
  });

pool.resolvedConfig = resolved;
module.exports = pool;
