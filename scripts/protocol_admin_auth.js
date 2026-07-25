const crypto = require('crypto');
const { promisify } = require('util');
const { query } = require('./protocol_admin_db');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'pl_admin_session';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('Admin password must contain at least 12 characters.');
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(value, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password || ''), Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach(part => {
    const separator = part.indexOf('=');
    if (separator === -1) return;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionCookie(token, req, maxAgeSeconds) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = process.env.NODE_ENV === 'production' || forwarded === 'https';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : null,
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join('; ');
}

function expiredSessionCookie(req) {
  return sessionCookie('', req, 0);
}

async function ensureBootstrapAdmin() {
  const count = await query('SELECT COUNT(*)::integer AS count FROM users');
  if (count.rows[0].count > 0) return { created: false };

  const email = normalizeEmail(process.env.PL_ADMIN_BOOTSTRAP_EMAIL);
  const password = process.env.PL_ADMIN_BOOTSTRAP_PASSWORD || '';
  const displayName = String(process.env.PL_ADMIN_BOOTSTRAP_NAME || 'Persona Layouts Admin').trim();
  if (!email || !password) return { created: false, setup_required: true };
  if (!email.includes('@')) throw new Error('PL_ADMIN_BOOTSTRAP_EMAIL is invalid.');

  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, passwordHash, displayName]
  );
  return { created: result.rowCount === 1, setup_required: false };
}

async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = Math.min(Math.max(Number(process.env.PL_ADMIN_SESSION_HOURS || 12), 1), 168);
  const maxAgeSeconds = Math.round(hours * 60 * 60);
  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [userId, tokenHash(token), maxAgeSeconds]
  );
  return { token, cookie: sessionCookie(token, req, maxAgeSeconds), maxAgeSeconds };
}

async function authenticateRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'
      LIMIT 1`,
    [tokenHash(token)]
  );
  return result.rows[0] || null;
}

async function revokeRequestSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return;
  await query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash(token)]);
}

module.exports = {
  authenticateRequest,
  createSession,
  ensureBootstrapAdmin,
  expiredSessionCookie,
  hashPassword,
  normalizeEmail,
  revokeRequestSession,
  verifyPassword
};
