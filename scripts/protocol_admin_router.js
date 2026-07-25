const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  authenticateRequest,
  createSession,
  ensureBootstrapAdmin,
  expiredSessionCookie,
  hashPassword,
  normalizeEmail,
  revokeRequestSession,
  verifyPassword
} = require('./protocol_admin_auth');
const { databaseConfigured, query, runMigrations, withTransaction } = require('./protocol_admin_db');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const loginAttempts = new Map();

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders('application/json; charset=utf-8'), ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, securityHeaders(contentType));
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk.toString();
      if (Buffer.byteLength(body) > maxBytes) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Payload too large.'), { statusCode: 413 }));
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function checkLoginRate(req) {
  const key = requestIp(req);
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(timestamp => now - timestamp < LOGIN_WINDOW_MS);
  recent.push(now);
  loginAttempts.set(key, recent);
  return recent.length <= LOGIN_LIMIT;
}

function clearLoginRate(req) {
  loginAttempts.delete(requestIp(req));
}

function expectedOrigin(req) {
  if (process.env.PL_ADMIN_ORIGIN) return process.env.PL_ADMIN_ORIGIN.replace(/\/+$/, '');
  const protocol = String(req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim();
  return `${protocol}://${req.headers.host}`;
}

function requireSameOrigin(req) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (!origin && process.env.NODE_ENV !== 'production') return;
  if (!origin || origin !== expectedOrigin(req)) {
    throw Object.assign(new Error('Invalid request origin.'), { statusCode: 403 });
  }
}

function cleanText(value, field, max, required = true) {
  const result = String(value || '').trim();
  if (required && !result) throw Object.assign(new Error(`${field} is required.`), { statusCode: 400 });
  if (result.length > max) throw Object.assign(new Error(`${field} is too long.`), { statusCode: 400 });
  return result;
}

function uuid(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''));
}

async function requireUser(req, role) {
  const user = await authenticateRequest(req);
  if (!user) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });
  if (role && user.role !== role) throw Object.assign(new Error('Insufficient permission.'), { statusCode: 403 });
  return user;
}

async function nextProjectCode(client) {
  const year = new Date().getUTCFullYear();
  await client.query('SELECT pg_advisory_xact_lock($1)', [842713]);
  const prefix = `PL-${year}-`;
  const result = await client.query(
    `SELECT COALESCE(MAX((regexp_match(project_code, '([0-9]+)$'))[1]::integer), 0) + 1 AS next
       FROM projects
      WHERE project_code LIKE $1`,
    [`${prefix}%`]
  );
  return prefix + String(result.rows[0].next).padStart(3, '0');
}

function createProtocolAdminRouter(root) {
  const publicDirectory = path.join(root, 'protocol-admin');
  const state = { ready: false, configured: databaseConfigured(), setupRequired: false, error: null };

  async function initialize() {
    state.configured = databaseConfigured();
    if (!state.configured) return state;
    try {
      if (String(process.env.PL_ADMIN_AUTO_MIGRATE || '').toLowerCase() === 'true') {
        await runMigrations(root);
      }
      const bootstrap = await ensureBootstrapAdmin();
      state.setupRequired = Boolean(bootstrap.setup_required);
      state.ready = !state.setupRequired;
      state.error = null;
    } catch (error) {
      state.ready = false;
      state.error = error.message;
      console.error('[protocol_admin] initialization failed:', error.message);
    }
    return state;
  }

  async function login(req, res) {
    requireSameOrigin(req);
    if (!checkLoginRate(req)) return sendJson(res, 429, { error: 'Too many login attempts. Try again later.' });
    const body = await readJson(req, 16 * 1024);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const result = await query(
      `SELECT id, email, display_name, role, password_hash
         FROM users
        WHERE email = $1 AND status = 'active'
        LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    const passwordMatches = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, await hashPassword('invalid-password-value'));
    if (!user || !passwordMatches) return sendJson(res, 401, { error: 'Invalid email or password.' });
    clearLoginRate(req);
    const session = await createSession(user.id, req);
    return sendJson(res, 200, {
      authenticated: true,
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }
    }, { 'Set-Cookie': session.cookie });
  }

  async function listProjects(req, res) {
    const user = await requireUser(req);
    const result = await query(
      `SELECT p.id, p.project_code, p.name, p.space_type, p.output_language, p.status,
              p.current_revision_number, p.updated_at, c.display_name AS client_name
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         LEFT JOIN clients c ON c.id = p.client_id
        WHERE pm.user_id = $1
        ORDER BY p.updated_at DESC
        LIMIT 200`,
      [user.id]
    );
    return sendJson(res, 200, { projects: result.rows });
  }

  async function createProject(req, res) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const body = await readJson(req);
    const projectName = cleanText(body.project_name, 'Project name', 160);
    const spaceType = cleanText(body.space_type, 'Space type', 80);
    const outputLanguage = ['tr', 'en'].includes(body.output_language) ? body.output_language : 'tr';
    const clientName = cleanText(body.client_name, 'Client name', 160);
    const clientEmail = normalizeEmail(body.client_email);
    if (clientEmail && !clientEmail.includes('@')) throw Object.assign(new Error('Client email is invalid.'), { statusCode: 400 });
    const narrative = cleanText(body.client_narrative, 'Client narrative', 50000);
    const measurements = cleanText(body.measurements, 'Measurements', 20000, false);
    const fixedElements = cleanText(body.fixed_elements, 'Fixed elements', 20000, false);

    const created = await withTransaction(async client => {
      const clientResult = await client.query(
        `INSERT INTO clients (display_name, email)
         VALUES ($1, NULLIF($2, ''))
         RETURNING id, display_name, email`,
        [clientName, clientEmail]
      );
      const projectCode = await nextProjectCode(client);
      const projectResult = await client.query(
        `INSERT INTO projects (project_code, client_id, name, space_type, output_language, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [projectCode, clientResult.rows[0].id, projectName, spaceType, outputLanguage, user.id]
      );
      const project = projectResult.rows[0];
      const revisionResult = await client.query(
        `INSERT INTO project_revisions (project_id, revision_number, state, created_by)
         VALUES ($1, 1, 'draft', $2)
         RETURNING *`,
        [project.id, user.id]
      );
      const revision = revisionResult.rows[0];
      await client.query(
        `INSERT INTO project_intakes
          (project_id, revision_id, client_narrative, measurements, fixed_elements, report_level, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'full_audit', $6)`,
        [
          project.id,
          revision.id,
          narrative,
          JSON.stringify({ raw_text: measurements }),
          JSON.stringify(fixedElements ? [{ raw_text: fixedElements }] : []),
          user.id
        ]
      );
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [project.id, user.id]
      );
      await client.query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'create', 'project', $1::text, $4::jsonb)`,
        [project.id, revision.id, user.id, JSON.stringify({ project_code: project.project_code, name: project.name })]
      );
      return { project, revision, client: clientResult.rows[0] };
    });
    return sendJson(res, 201, created);
  }

  async function getProject(req, res, projectId) {
    const user = await requireUser(req);
    const result = await query(
      `SELECT p.id, p.project_code, p.name, p.space_type, p.output_language, p.status,
              p.current_revision_number, p.created_at, p.updated_at,
              c.display_name AS client_name, c.email AS client_email,
              r.id AS revision_id, r.revision_number, r.state AS revision_state,
              i.client_narrative, i.measurements, i.fixed_elements, i.report_level
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
         LEFT JOIN clients c ON c.id = p.client_id
         JOIN project_revisions r ON r.project_id = p.id AND r.revision_number = p.current_revision_number
         JOIN project_intakes i ON i.revision_id = r.id
        WHERE p.id = $1
        LIMIT 1`,
      [projectId, user.id]
    );
    if (!result.rowCount) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 200, { project: result.rows[0] });
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/protocol-admin/status') {
      return sendJson(res, 200, {
        configured: state.configured,
        ready: state.ready,
        setup_required: state.setupRequired
      });
    }
    if (!state.ready) return sendJson(res, 503, { error: 'Protocol Admin is not configured.' });
    if (req.method === 'POST' && url.pathname === '/api/protocol-admin/login') return login(req, res);
    if (req.method === 'POST' && url.pathname === '/api/protocol-admin/logout') {
      requireSameOrigin(req);
      await revokeRequestSession(req);
      return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': expiredSessionCookie(req) });
    }
    if (req.method === 'GET' && url.pathname === '/api/protocol-admin/session') {
      const user = await authenticateRequest(req);
      return sendJson(res, 200, { authenticated: Boolean(user), user: user || null });
    }
    if (url.pathname === '/api/protocol-admin/projects' && req.method === 'GET') return listProjects(req, res);
    if (url.pathname === '/api/protocol-admin/projects' && req.method === 'POST') return createProject(req, res);
    const projectMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') {
      if (!uuid(projectMatch[1])) return sendJson(res, 400, { error: 'Invalid project id.' });
      return getProject(req, res, projectMatch[1]);
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const isAdminPath = url.pathname === '/protocol-admin' ||
      url.pathname.startsWith('/protocol-admin/') ||
      url.pathname.startsWith('/api/protocol-admin/');
    if (!isAdminPath) return false;

    try {
      if (url.pathname.startsWith('/api/protocol-admin/')) {
        await handleApi(req, res, url);
        return true;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      if (url.pathname === '/protocol-admin/admin.css') sendFile(res, path.join(publicDirectory, 'admin.css'), 'text/css; charset=utf-8');
      else if (url.pathname === '/protocol-admin/admin.js') sendFile(res, path.join(publicDirectory, 'admin.js'), 'application/javascript; charset=utf-8');
      else sendFile(res, path.join(publicDirectory, 'index.html'), 'text/html; charset=utf-8');
      return true;
    } catch (error) {
      const requestId = crypto.randomUUID();
      console.error(`[protocol_admin] request ${requestId} failed:`, error);
      sendJson(res, error.statusCode || 500, {
        error: error.statusCode && error.statusCode < 500 ? error.message : 'Internal error.',
        request_id: requestId
      });
      return true;
    }
  }

  return { handle, initialize, state };
}

module.exports = { createProtocolAdminRouter };
