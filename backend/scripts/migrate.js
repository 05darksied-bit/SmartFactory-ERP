'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const db = require('../config/db');

/**
 * Safely initialize schema and run idempotent migrations without dropping data.
 * Strips CREATE DATABASE / USE statements so it works against any managed DB name (e.g. Railway's `railway`).
 */
async function main() {
  const cfg = db.resolvedConfig;
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: true,
    timezone: 'Z',
  });

  try {
    const schemaPath = path.join(__dirname, '../../database/init/01-schema.sql');
    if (fs.existsSync(schemaPath)) {
      const rawSchema = fs.readFileSync(schemaPath, 'utf8');
      const cleanedSchema = rawSchema
        .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[^;]+;\s*$/gim, '')
        .replace(/^\s*USE\s+[^;]+;\s*$/gim, '');
      await conn.query(cleanedSchema);
      console.log('[MIGRATE] Base schema verified (CREATE TABLE IF NOT EXISTS).');
    }

    const migrationsDir = path.join(__dirname, '../../database/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await conn.query(sql);
        console.log(`[MIGRATE] Applied migration: ${file}`);
      }
    }

    console.log('[MIGRATE] Database schema and migrations are up to date.');
  } finally {
    await conn.end();
    await db.end();
  }
}

main().catch(err => {
  console.error('[MIGRATE] Failed:', err.message);
  process.exit(1);
});
