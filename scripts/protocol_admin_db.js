const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function sslConfig() {
  const explicit = String(process.env.PL_DATABASE_SSL || '').toLowerCase();
  if (['false', '0', 'no'].includes(explicit)) return false;
  if (['true', '1', 'yes'].includes(explicit)) return { rejectUnauthorized: false };
  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
}

function getPool() {
  if (!databaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: Number(process.env.PL_DATABASE_POOL_SIZE || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', error => console.error('[protocol_admin_db] idle client error:', error.message));
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function migrationFiles(root) {
  const directory = path.join(root, 'db', 'migrations');
  return fs.readdirSync(directory)
    .filter(name => /^\d+.*\.sql$/i.test(name))
    .sort()
    .map(name => ({ name, path: path.join(directory, name) }));
}

function stripOuterTransaction(sql) {
  return sql
    .replace(/^\uFEFF/, '')
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;\s*$/i, '');
}

async function runMigrations(root) {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map(row => row.name));
    const completed = [];

    for (const migration of migrationFiles(root)) {
      if (applied.has(migration.name)) continue;
      const sql = stripOuterTransaction(fs.readFileSync(migration.path, 'utf8'));
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        completed.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${error.message}`);
      }
    }
    return completed;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!pool) return;
  const active = pool;
  pool = null;
  await active.end();
}

module.exports = { closePool, databaseConfigured, getPool, query, runMigrations, withTransaction };
