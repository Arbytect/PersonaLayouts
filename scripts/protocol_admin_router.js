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
const { generateProtocolDraft } = require('./protocol_admin_ai');
const { validateProtocolAdminContract } = require('./protocol_admin_contract');
const { databaseConfigured, query, runMigrations, withTransaction } = require('./protocol_admin_db');
const { evaluateProtocolAdminQuality } = require('./protocol_admin_quality_gate');
const { generateProtocolReportPdf } = require('./protocol_admin_report');

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

function sendBuffer(res, status, buffer, contentType, filename) {
  res.writeHead(status, {
    ...securityHeaders(contentType),
    'Content-Disposition': `attachment; filename="${String(filename).replace(/[^a-zA-Z0-9._-]/g, '-')}"`,
    'Content-Length': buffer.length
  });
  res.end(buffer);
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

function optionalDimension(value, field, max) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw Object.assign(new Error(`${field} is invalid.`), { statusCode: 400 });
  }
  return Math.round(number * 10) / 10;
}

function uuid(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
    const roomWidthCm = optionalDimension(body.room_width_cm, 'Room width', 5000);
    const roomLengthCm = optionalDimension(body.room_length_cm, 'Room length', 5000);
    const ceilingHeightCm = optionalDimension(body.ceiling_height_cm, 'Ceiling height', 1000);
    const measurementSource = ['unknown', 'client_reported', 'plan_measured', 'site_measured'].includes(body.measurement_source)
      ? body.measurement_source
      : 'unknown';
    const measurementPayload = {
      raw_text: measurements,
      room_width_cm: roomWidthCm,
      room_length_cm: roomLengthCm,
      ceiling_height_cm: ceilingHeightCm,
      source_status: measurementSource
    };

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
          JSON.stringify(measurementPayload),
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
          VALUES ($1, $2, $3, 'admin', 'create', 'project', $4, $5::jsonb)`,
        [
          project.id,
          revision.id,
          user.id,
          project.id,
          JSON.stringify({ project_code: project.project_code, name: project.name })
        ]
      );
      return { project, revision, client: clientResult.rows[0] };
    });
    return sendJson(res, 201, created);
  }

  async function getProject(req, res, projectId) {
    const user = await requireUser(req);
    const result = await loadProject(projectId, user.id);
    if (!result) return sendJson(res, 404, { error: 'Project not found.' });
    const draftResult = await query(
      `SELECT id, status, model, prompt_version, content, quality_gate_result,
              error_message, generated_at, updated_at
         FROM protocol_drafts
        WHERE revision_id = $1
        LIMIT 1`,
      [result.revision_id]
    );
    const approvalResult = await query(
      `SELECT id, snapshot_sha256, quality_gate_result, approved_at
         FROM approval_snapshots
        WHERE revision_id = $1
        LIMIT 1`,
      [result.revision_id]
    );
    return sendJson(res, 200, {
      project: result,
      protocol_draft: draftResult.rows[0] || null,
      approval: approvalResult.rows[0] || null
    });
  }

  async function loadProject(projectId, userId) {
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
      [projectId, userId]
    );
    return result.rows[0] || null;
  }

  function intakeText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => item && item.raw_text ? item.raw_text : '').filter(Boolean).join('\n');
    const structured = [
      value.room_width_cm ? `Room width: ${value.room_width_cm} cm` : '',
      value.room_length_cm ? `Room length: ${value.room_length_cm} cm` : '',
      value.ceiling_height_cm ? `Ceiling height: ${value.ceiling_height_cm} cm` : '',
      value.source_status ? `Measurement source: ${value.source_status}` : '',
      value.raw_text || ''
    ].filter(Boolean);
    return structured.join('\n');
  }

  async function generateProjectProtocol(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });

    const existing = await query(
      `SELECT id, status, updated_at
         FROM protocol_drafts
        WHERE revision_id = $1
        LIMIT 1`,
      [project.revision_id]
    );
    if (existing.rows[0] && existing.rows[0].status === 'generating' &&
        Date.now() - new Date(existing.rows[0].updated_at).getTime() < 10 * 60 * 1000) {
      return sendJson(res, 409, { error: 'Protocol generation is already running.' });
    }
    if (existing.rows[0] && existing.rows[0].status === 'ready') {
      return sendJson(res, 409, { error: 'A protocol draft already exists for this revision.' });
    }

    const draftResult = await query(
      `INSERT INTO protocol_drafts
        (project_id, revision_id, status, generated_by, error_message, content, quality_gate_result)
       VALUES ($1, $2, 'generating', $3, NULL, '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (revision_id) DO UPDATE
         SET status = 'generating', generated_by = EXCLUDED.generated_by,
             error_message = NULL, updated_at = now()
       RETURNING id`,
      [project.id, project.revision_id, user.id]
    );

    try {
      const generated = await generateProtocolDraft({
        project_id: project.id,
        project_code: project.project_code,
        project_name: project.name,
        space_type: project.space_type,
        output_language: project.output_language,
        revision_number: project.revision_number,
        client_narrative: project.client_narrative,
        measurements: intakeText(project.measurements),
        fixed_elements: intakeText(project.fixed_elements)
      });
      const completed = await withTransaction(async client => {
        const result = await client.query(
          `UPDATE protocol_drafts
              SET status = 'ready', model = $2, provider_response_id = $3,
                  content = $4::jsonb, quality_gate_result = $5::jsonb,
                  error_message = NULL, generated_at = now()
            WHERE id = $1
            RETURNING id, status, model, prompt_version, content, quality_gate_result,
                      error_message, generated_at, updated_at`,
          [
            draftResult.rows[0].id,
            generated.model,
            generated.response_id,
            JSON.stringify(generated.audit),
            JSON.stringify(generated.quality_gate)
          ]
        );
        await client.query(
          `INSERT INTO audit_log
            (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
           VALUES ($1, $2, $3, 'ai', 'generate', 'protocol_draft', $4, $5::jsonb)`,
          [
            project.id,
            project.revision_id,
            user.id,
            draftResult.rows[0].id,
            JSON.stringify({
              model: generated.model,
              quality_status: generated.quality_gate.status,
              blocker_count: generated.quality_gate.summary.blocker_count,
              warning_count: generated.quality_gate.summary.warning_count
            })
          ]
        );
        return result.rows[0];
      });
      return sendJson(res, 201, { protocol_draft: completed });
    } catch (error) {
      await query(
        `UPDATE protocol_drafts
            SET status = 'failed', error_message = $2
          WHERE id = $1`,
        [draftResult.rows[0].id, String(error.message || 'Protocol generation failed.').slice(0, 2000)]
      );
      error.publicMessage = 'Protocol generation failed. Review the project evidence and try again.';
      throw error;
    }
  }

  async function updateProjectProtocol(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    const body = await readJson(req, 2 * 1024 * 1024);
    let content;
    try {
      content = validateProtocolAdminContract(body.content);
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 400 });
    }
    if (content.project.id !== project.id || content.revision.number !== project.revision_number) {
      return sendJson(res, 409, { error: 'Protocol draft does not match the active project revision.' });
    }
    const qualityGate = evaluateProtocolAdminQuality(content);
    const result = await withTransaction(async client => {
      const updated = await client.query(
        `UPDATE protocol_drafts
            SET content = $3::jsonb, quality_gate_result = $4::jsonb,
                status = 'ready', error_message = NULL
          WHERE project_id = $1 AND revision_id = $2
          RETURNING id, status, model, prompt_version, content, quality_gate_result,
                    error_message, generated_at, updated_at`,
        [project.id, project.revision_id, JSON.stringify(content), JSON.stringify(qualityGate)]
      );
      if (!updated.rowCount) throw Object.assign(new Error('Protocol draft not found.'), { statusCode: 404 });
      await client.query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'update', 'protocol_draft', $4, $5::jsonb)`,
        [
          project.id,
          project.revision_id,
          user.id,
          updated.rows[0].id,
          JSON.stringify({
            quality_status: qualityGate.status,
            blocker_count: qualityGate.summary.blocker_count,
            warning_count: qualityGate.summary.warning_count
          })
        ]
      );
      return updated.rows[0];
    });
    return sendJson(res, 200, { protocol_draft: result });
  }

  async function approveProjectProtocol(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    if (project.revision_state === 'approved') {
      return sendJson(res, 409, { error: 'This project revision is already approved.' });
    }

    const draftResult = await query(
      `SELECT id, status, content
         FROM protocol_drafts
        WHERE project_id = $1 AND revision_id = $2
        LIMIT 1`,
      [project.id, project.revision_id]
    );
    const draft = draftResult.rows[0];
    if (!draft || draft.status !== 'ready') {
      return sendJson(res, 409, { error: 'A saved protocol draft is required before approval.' });
    }

    let content;
    try {
      content = validateProtocolAdminContract(draft.content);
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 400 });
    }
    const qualityGate = evaluateProtocolAdminQuality(content);
    if (!qualityGate.can_approve) {
      return sendJson(res, 409, {
        error: 'The protocol cannot be approved until every blocker and warning is resolved.',
        quality_gate_result: qualityGate
      });
    }

    const approvedContent = structuredClone(content);
    approvedContent.revision.state = 'approved';
    const snapshot = {
      schema_version: '1.0',
      audit: approvedContent,
      report_context: {
        client_name: project.client_name,
        approved_by: user.display_name
      }
    };
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotSha256 = crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
    const approval = await withTransaction(async client => {
      const inserted = await client.query(
        `INSERT INTO approval_snapshots
          (project_id, revision_id, snapshot, snapshot_sha256, quality_gate_result, approved_by)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6)
         RETURNING id, snapshot_sha256, quality_gate_result, approved_at`,
        [
          project.id,
          project.revision_id,
          snapshotJson,
          snapshotSha256,
          JSON.stringify(qualityGate),
          user.id
        ]
      );
      await client.query(
        `UPDATE project_revisions
            SET state = 'approved', approved_at = now()
          WHERE id = $1`,
        [project.revision_id]
      );
      await client.query(
        `UPDATE projects
            SET status = 'approved'
          WHERE id = $1`,
        [project.id]
      );
      await client.query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'approve', 'approval_snapshot', $4, $5::jsonb)`,
        [
          project.id,
          project.revision_id,
          user.id,
          inserted.rows[0].id,
          JSON.stringify({ snapshot_sha256: snapshotSha256, quality_status: qualityGate.status })
        ]
      );
      return inserted.rows[0];
    });
    return sendJson(res, 201, { approval });
  }

  async function downloadApprovedProtocolPdf(req, res, projectId) {
    const user = await requireUser(req);
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    const approvalResult = await query(
      `SELECT id, snapshot, snapshot_sha256, quality_gate_result, approved_at
         FROM approval_snapshots
        WHERE project_id = $1 AND revision_id = $2
        LIMIT 1`,
      [project.id, project.revision_id]
    );
    const approval = approvalResult.rows[0];
    if (!approval) return sendJson(res, 409, { error: 'This project revision has not been approved.' });
    const currentSnapshotSha256 = crypto.createHash('sha256').update(canonicalJson(approval.snapshot)).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(approval.snapshot_sha256 || '') ||
        !crypto.timingSafeEqual(Buffer.from(currentSnapshotSha256), Buffer.from(approval.snapshot_sha256))) {
      throw Object.assign(new Error('Approved snapshot integrity check failed.'), { statusCode: 409 });
    }

    const report = await query(
      `INSERT INTO generated_reports
        (project_id, approval_snapshot_id, revision_id, report_type, status)
       VALUES ($1, $2, $3, 'approved_pdf', 'processing')
       RETURNING id`,
      [project.id, approval.id, project.revision_id]
    );
    try {
      const pdf = await generateProtocolReportPdf(approval);
      const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
      await query(
        `UPDATE generated_reports
            SET status = 'completed', sha256 = $2, completed_at = now()
          WHERE id = $1`,
        [report.rows[0].id, sha256]
      );
      await query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'generate', 'generated_report', $4, $5::jsonb)`,
        [
          project.id,
          project.revision_id,
          user.id,
          report.rows[0].id,
          JSON.stringify({ report_type: 'approved_pdf', sha256 })
        ]
      );
      return sendBuffer(
        res,
        200,
        pdf,
        'application/pdf',
        `${project.project_code}-approved-protocol.pdf`
      );
    } catch (error) {
      await query(
        `UPDATE generated_reports
            SET status = 'failed', error_message = $2
          WHERE id = $1`,
        [report.rows[0].id, String(error.message || 'PDF generation failed.').slice(0, 2000)]
      );
      throw error;
    }
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
    const generateMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/generate-protocol$/);
    if (generateMatch && req.method === 'POST') {
      if (!uuid(generateMatch[1])) return sendJson(res, 400, { error: 'Invalid project id.' });
      return generateProjectProtocol(req, res, generateMatch[1]);
    }
    const draftMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/protocol-draft$/);
    if (draftMatch && req.method === 'PUT') {
      if (!uuid(draftMatch[1])) return sendJson(res, 400, { error: 'Invalid project id.' });
      return updateProjectProtocol(req, res, draftMatch[1]);
    }
    const approvalMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/approve$/);
    if (approvalMatch && req.method === 'POST') {
      if (!uuid(approvalMatch[1])) return sendJson(res, 400, { error: 'Invalid project id.' });
      return approveProjectProtocol(req, res, approvalMatch[1]);
    }
    const pdfMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/approved-pdf$/);
    if (pdfMatch && req.method === 'GET') {
      if (!uuid(pdfMatch[1])) return sendJson(res, 400, { error: 'Invalid project id.' });
      return downloadApprovedProtocolPdf(req, res, pdfMatch[1]);
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
      else if (url.pathname === '/protocol-admin/sw.js') sendFile(res, path.join(publicDirectory, 'sw.js'), 'application/javascript; charset=utf-8');
      else if (url.pathname === '/protocol-admin/manifest.webmanifest') sendFile(res, path.join(publicDirectory, 'manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
      else if (url.pathname === '/protocol-admin/icon-192.png') sendFile(res, path.join(publicDirectory, 'icon-192.png'), 'image/png');
      else if (url.pathname === '/protocol-admin/icon-512.png') sendFile(res, path.join(publicDirectory, 'icon-512.png'), 'image/png');
      else sendFile(res, path.join(publicDirectory, 'index.html'), 'text/html; charset=utf-8');
      return true;
    } catch (error) {
      const requestId = crypto.randomUUID();
      console.error(`[protocol_admin] request ${requestId} failed:`, error);
      sendJson(res, error.statusCode || 500, {
        error: error.publicMessage || (error.statusCode && error.statusCode < 500 ? error.message : 'Internal error.'),
        request_id: requestId
      });
      return true;
    }
  }

  return { handle, initialize, state };
}

module.exports = { createProtocolAdminRouter };
