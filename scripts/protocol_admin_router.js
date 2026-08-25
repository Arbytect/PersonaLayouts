const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
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
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_FILES_PER_REVISION = 30;
const SOURCE_FILE_TYPES = new Set(['measured_plan', 'photo', 'uploaded_document']);
let sourceFileR2Client = null;

function r2Configured() {
  return ['PL_R2_ACCOUNT_ID', 'PL_R2_ACCESS_KEY_ID', 'PL_R2_SECRET_ACCESS_KEY', 'PL_R2_BUCKET_NAME']
    .every(name => Boolean(process.env[name]));
}

function getSourceFileR2Client() {
  if (!r2Configured()) throw Object.assign(new Error('Özel dosya deposu henüz yapılandırılmadı.'), { statusCode: 503 });
  if (!sourceFileR2Client) {
    sourceFileR2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.PL_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.PL_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.PL_R2_SECRET_ACCESS_KEY
      },
      forcePathStyle: true
    });
  }
  return sourceFileR2Client;
}

function readBinary(req, maxBytes = MAX_SOURCE_FILE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('Dosya 20 MB sınırını aşıyor.'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!size) return reject(Object.assign(new Error('Boş dosya yüklenemez.'), { statusCode: 400 }));
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function safeOriginalFilename(value) {
  let decoded = String(value || '');
  try { decoded = decodeURIComponent(decoded); } catch {}
  const filename = path.basename(decoded).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  if (!filename) throw Object.assign(new Error('Dosya adı eksik.'), { statusCode: 400 });
  return filename;
}

function detectedFileType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { contentType: 'application/pdf', extension: '.pdf' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: 'image/jpeg', extension: '.jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: '.png' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { contentType: 'image/webp', extension: '.webp' };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { contentType: 'image/heic', extension: '.heic' };
  }
  throw Object.assign(new Error('Yalnızca PDF, JPG, PNG, WEBP veya HEIC dosyaları yüklenebilir.'), { statusCode: 415 });
}

function safeDownloadName(value) {
  const original = safeOriginalFilename(value);
  const ascii = original.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'proje-dosyasi';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(original)}`;
}

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
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'Dosya bulunamadı.' });
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
      if (tooLarge) return reject(Object.assign(new Error('Gönderilen veri çok büyük.'), { statusCode: 413 }));
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Gönderilen veri biçimi geçersiz.'), { statusCode: 400 }));
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
    throw Object.assign(new Error('İstek kaynağı geçersiz.'), { statusCode: 403 });
  }
}

function cleanText(value, field, max, required = true) {
  const result = String(value || '').trim();
  if (required && !result) throw Object.assign(new Error(`${field} zorunludur.`), { statusCode: 400 });
  if (result.length > max) throw Object.assign(new Error(`${field} izin verilen uzunluğu aşıyor.`), { statusCode: 400 });
  return result;
}

function optionalDimension(value, field, max) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw Object.assign(new Error(`${field} geçersiz.`), { statusCode: 400 });
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
  if (!user) throw Object.assign(new Error('Oturum açmanız gerekiyor.'), { statusCode: 401 });
  if (role && user.role !== role) throw Object.assign(new Error('Bu işlem için yetkiniz yok.'), { statusCode: 403 });
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
  const spatialAtlasMasterFile = path.join(root, 'data', 'spatial_design_library_master.json');
  const state = { ready: false, configured: databaseConfigured(), setupRequired: false, error: null };

  function readSpatialAtlas() {
    if (!fs.existsSync(spatialAtlasMasterFile)) {
      throw Object.assign(new Error('Mekânsal Tasarım Atlası ana verisi bulunamadı.'), { statusCode: 503 });
    }
    let atlas;
    try {
      atlas = JSON.parse(fs.readFileSync(spatialAtlasMasterFile, 'utf8'));
    } catch {
      throw Object.assign(new Error('Mekânsal Tasarım Atlası ana verisi geçersiz.'), { statusCode: 500 });
    }
    if (!Array.isArray(atlas.lenses) || !Array.isArray(atlas.sources) || !Array.isArray(atlas.rooms)) {
      throw Object.assign(new Error('Mekânsal Tasarım Atlası veri sözleşmesi eksik.'), { statusCode: 500 });
    }
    return atlas;
  }

  async function loadSourceFiles(projectId, revisionId, includeArchived = false) {
    const result = await query(
      `SELECT id, project_id, revision_id, source_type, original_filename, object_key,
              content_type, byte_size, sha256, file_revision, ai_review_status,
              archived_at, created_at
         FROM source_files
        WHERE project_id = $1 AND revision_id = $2
          AND ($3::boolean OR archived_at IS NULL)
        ORDER BY created_at DESC`,
      [projectId, revisionId, includeArchived]
    );
    return result.rows;
  }

  function sourceFileContract(file) {
    return {
      id: file.id,
      source_type: file.source_type,
      filename: file.original_filename,
      revision: Number(file.file_revision),
      sha256: file.sha256,
      ai_review_status: file.ai_review_status
    };
  }

  function sourceFileView(file) {
    return {
      id: file.id,
      source_type: file.source_type,
      original_filename: file.original_filename,
      content_type: file.content_type,
      byte_size: Number(file.byte_size),
      sha256: file.sha256,
      file_revision: Number(file.file_revision),
      ai_review_status: file.ai_review_status,
      archived_at: file.archived_at,
      created_at: file.created_at,
      content_url: `/api/protocol-admin/projects/${encodeURIComponent(file.project_id)}/files/${encodeURIComponent(file.id)}`
    };
  }

  function atlasDirection(selection) {
    if (!selection) return null;
    const atlas = readSpatialAtlas();
    const lensBySlug = new Map(atlas.lenses.map(lens => [lens.slug, lens]));
    const summarize = slug => {
      if (!slug) return null;
      const lens = lensBySlug.get(slug);
      if (!lens) return null;
      return {
        slug: lens.slug,
        name: lens.name,
        subtitle: lens.subtitle,
        summary: lens.public && lens.public.summary,
        spatial_why: lens.public && lens.public.philosophy && lens.public.philosophy.spatial_why,
        best_for: lens.public && lens.public.best_for,
        watch_for: lens.public && lens.public.watch_for,
        palette: Array.isArray(lens.palette) ? lens.palette.slice(0, 4) : []
      };
    };
    return {
      primary: summarize(selection.primary_lens_slug),
      supporting: summarize(selection.supporting_lens_slug),
      alternative: summarize(selection.alternative_lens_slug),
      rationale: selection.rationale || '',
      evidence_boundary: atlas.publication && atlas.publication.evidence_boundary,
      persona_boundary: atlas.publication && atlas.publication.persona_boundary,
      atlas_version: atlas.version || null
    };
  }

  async function getSpatialAtlas(req, res) {
    await requireUser(req, 'admin');
    const atlas = readSpatialAtlas();
    const stats = fs.statSync(spatialAtlasMasterFile);
    return sendJson(res, 200, {
      atlas,
      meta: {
        version: atlas.version || null,
        updated_at: atlas.updated_at || null,
        file_modified_at: stats.mtime.toISOString()
      }
    });
  }

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
    if (!checkLoginRate(req)) return sendJson(res, 429, { error: 'Çok fazla giriş denemesi yapıldı. Daha sonra tekrar deneyin.' });
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
    if (!user || !passwordMatches) return sendJson(res, 401, { error: 'E-posta veya parola hatalı.' });
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
    const projectName = cleanText(body.project_name, 'Proje adı', 160);
    const spaceType = cleanText(body.space_type, 'Mekân türü', 80);
    const outputLanguage = ['tr', 'en'].includes(body.output_language) ? body.output_language : 'tr';
    const clientName = cleanText(body.client_name, 'Müşteri adı', 160);
    const clientEmail = normalizeEmail(body.client_email);
    if (clientEmail && !clientEmail.includes('@')) throw Object.assign(new Error('Müşteri e-postası geçersiz.'), { statusCode: 400 });
    const narrative = cleanText(body.client_narrative, 'Müşteri anlatımı', 50000);
    const measurements = cleanText(body.measurements, 'Ölçüler', 20000, false);
    const fixedElements = cleanText(body.fixed_elements, 'Sabit elemanlar', 20000, false);
    const roomWidthCm = optionalDimension(body.room_width_cm, 'Oda genişliği', 5000);
    const roomLengthCm = optionalDimension(body.room_length_cm, 'Oda uzunluğu', 5000);
    const ceilingHeightCm = optionalDimension(body.ceiling_height_cm, 'Tavan yüksekliği', 1000);
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
    if (!result) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
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
    const atlasSelectionResult = await query(
      `SELECT primary_lens_slug, supporting_lens_slug, alternative_lens_slug,
              rationale, updated_at
         FROM project_atlas_selections
        WHERE revision_id = $1
        LIMIT 1`,
      [result.revision_id]
    );
    const sourceFiles = await loadSourceFiles(result.id, result.revision_id);
    return sendJson(res, 200, {
      project: result,
      protocol_draft: draftResult.rows[0] || null,
      approval: approvalResult.rows[0] || null,
      atlas_selection: atlasSelectionResult.rows[0] || null,
      source_files: sourceFiles.map(sourceFileView)
    });
  }

  async function updateProjectAtlasSelection(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    if (project.revision_state === 'approved') {
      return sendJson(res, 409, { error: 'Onaylı revizyonun Atlas seçimi değiştirilemez; yeni revizyon oluşturulmalıdır.' });
    }
    const body = await readJson(req, 32 * 1024);
    const atlas = readSpatialAtlas();
    const validSlugs = new Set(atlas.lenses.map(lens => lens.slug));
    const primary = cleanText(body.primary_lens_slug, 'Birincil yaklaşım', 120);
    const supporting = cleanText(body.supporting_lens_slug, 'Destekleyici yaklaşım', 120, false) || null;
    const alternative = cleanText(body.alternative_lens_slug, 'Alternatif yaklaşım', 120, false) || null;
    const rationale = cleanText(body.rationale, 'Mimari gerekçe', 4000, false);
    const chosen = [primary, supporting, alternative].filter(Boolean);
    if (chosen.some(slug => !validSlugs.has(slug))) {
      return sendJson(res, 400, { error: 'Seçilen Atlas yaklaşımı ana veri içinde bulunmuyor.' });
    }
    if (new Set(chosen).size !== chosen.length) {
      return sendJson(res, 400, { error: 'Birincil, destekleyici ve alternatif yaklaşımlar birbirinden farklı olmalı.' });
    }
    const selection = await withTransaction(async client => {
      const result = await client.query(
        `INSERT INTO project_atlas_selections
          (project_id, revision_id, primary_lens_slug, supporting_lens_slug,
           alternative_lens_slug, rationale, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (revision_id) DO UPDATE
           SET primary_lens_slug = EXCLUDED.primary_lens_slug,
               supporting_lens_slug = EXCLUDED.supporting_lens_slug,
               alternative_lens_slug = EXCLUDED.alternative_lens_slug,
               rationale = EXCLUDED.rationale,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING primary_lens_slug, supporting_lens_slug, alternative_lens_slug,
                   rationale, updated_at`,
        [project.id, project.revision_id, primary, supporting, alternative, rationale, user.id]
      );
      await client.query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'update', 'atlas_selection', $4, $5::jsonb)`,
        [
          project.id,
          project.revision_id,
          user.id,
          project.revision_id,
          JSON.stringify({ primary, supporting, alternative, rationale })
        ]
      );
      return result.rows[0];
    });
    return sendJson(res, 200, { atlas_selection: selection });
  }

  async function uploadProjectSourceFile(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    if (project.revision_state === 'approved') {
      return sendJson(res, 409, { error: 'Onaylı revizyona dosya eklenemez; yeni revizyon oluşturulmalıdır.' });
    }
    const sourceType = String(req.headers['x-source-type'] || '').trim();
    if (!SOURCE_FILE_TYPES.has(sourceType)) {
      return sendJson(res, 400, { error: 'Belge türü geçersiz.' });
    }
    const originalFilename = safeOriginalFilename(req.headers['x-file-name']);
    const countResult = await query(
      `SELECT COUNT(*)::integer AS count
         FROM source_files
        WHERE revision_id = $1 AND archived_at IS NULL`,
      [project.revision_id]
    );
    if (countResult.rows[0].count >= MAX_SOURCE_FILES_PER_REVISION) {
      return sendJson(res, 409, { error: `Bir revizyona en fazla ${MAX_SOURCE_FILES_PER_REVISION} etkin dosya eklenebilir.` });
    }
    const bytes = await readBinary(req);
    const detected = detectedFileType(bytes);
    if (sourceType === 'photo' && !detected.contentType.startsWith('image/')) {
      return sendJson(res, 400, { error: 'Fotoğraf türünde yalnızca görüntü dosyası yüklenebilir.' });
    }
    const revisionResult = await query(
      `SELECT COALESCE(MAX(file_revision), 0) + 1 AS next_revision
         FROM source_files
        WHERE project_id = $1 AND original_filename = $2`,
      [project.id, originalFilename]
    );
    const fileRevision = Number(revisionResult.rows[0].next_revision);
    const fileId = crypto.randomUUID();
    const objectKey = `admin-projects/${project.id}/${project.revision_id}/${fileId}${detected.extension}`;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const client = getSourceFileR2Client();
    const bucket = process.env.PL_R2_BUCKET_NAME;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: detected.contentType,
      Metadata: {
        project_id: project.id,
        revision_id: project.revision_id,
        sha256
      }
    }));
    try {
      const inserted = await withTransaction(async database => {
        const result = await database.query(
          `INSERT INTO source_files
            (id, project_id, revision_id, source_type, original_filename, object_key,
             content_type, byte_size, sha256, file_revision, uploaded_by, ai_review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'not_requested')
           RETURNING id, project_id, revision_id, source_type, original_filename, object_key,
                     content_type, byte_size, sha256, file_revision, ai_review_status,
                     archived_at, created_at`,
          [
            fileId,
            project.id,
            project.revision_id,
            sourceType,
            originalFilename,
            objectKey,
            detected.contentType,
            bytes.length,
            sha256,
            fileRevision,
            user.id
          ]
        );
        await database.query(
          `INSERT INTO audit_log
            (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
           VALUES ($1, $2, $3, 'admin', 'create', 'source_file', $4, $5::jsonb)`,
          [
            project.id,
            project.revision_id,
            user.id,
            fileId,
            JSON.stringify({ source_type: sourceType, filename: originalFilename, byte_size: bytes.length, sha256 })
          ]
        );
        return result.rows[0];
      });
      return sendJson(res, 201, { source_file: sourceFileView(inserted) });
    } catch (error) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => {});
      throw error;
    }
  }

  async function streamProjectSourceFile(req, res, projectId, fileId) {
    const user = await requireUser(req);
    const result = await query(
      `SELECT sf.id, sf.original_filename, sf.object_key, sf.content_type, sf.byte_size
         FROM source_files sf
         JOIN project_members pm ON pm.project_id = sf.project_id AND pm.user_id = $3
        WHERE sf.id = $1 AND sf.project_id = $2 AND sf.archived_at IS NULL
        LIMIT 1`,
      [fileId, projectId, user.id]
    );
    const file = result.rows[0];
    if (!file) return sendJson(res, 404, { error: 'Proje dosyası bulunamadı.' });
    const object = await getSourceFileR2Client().send(new GetObjectCommand({
      Bucket: process.env.PL_R2_BUCKET_NAME,
      Key: file.object_key
    }));
    res.writeHead(200, {
      ...securityHeaders(file.content_type),
      'Content-Disposition': safeDownloadName(file.original_filename),
      'Content-Length': String(object.ContentLength || file.byte_size)
    });
    if (!object.Body || typeof object.Body.pipe !== 'function') {
      throw Object.assign(new Error('Dosya akışı açılamadı.'), { statusCode: 502 });
    }
    object.Body.on('error', error => res.destroy(error));
    object.Body.pipe(res);
  }

  async function archiveProjectSourceFile(req, res, projectId, fileId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    if (project.revision_state === 'approved') {
      return sendJson(res, 409, { error: 'Onaylı revizyondaki dosyalar arşivlenemez.' });
    }
    const archived = await withTransaction(async client => {
      const result = await client.query(
        `UPDATE source_files
            SET archived_at = now()
          WHERE id = $1 AND project_id = $2 AND revision_id = $3 AND archived_at IS NULL
          RETURNING id, original_filename, archived_at`,
        [fileId, project.id, project.revision_id]
      );
      if (!result.rowCount) throw Object.assign(new Error('Etkin proje dosyası bulunamadı.'), { statusCode: 404 });
      await client.query(
        `INSERT INTO audit_log
          (project_id, revision_id, actor_user_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, 'admin', 'archive', 'source_file', $4, $5::jsonb)`,
        [project.id, project.revision_id, user.id, fileId, JSON.stringify({ archived_at: result.rows[0].archived_at })]
      );
      return result.rows[0];
    });
    return sendJson(res, 200, { source_file: archived });
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
      value.room_width_cm ? `Oda genişliği: ${value.room_width_cm} cm` : '',
      value.room_length_cm ? `Oda uzunluğu: ${value.room_length_cm} cm` : '',
      value.ceiling_height_cm ? `Tavan yüksekliği: ${value.ceiling_height_cm} cm` : '',
      value.source_status ? `Ölçü kaynağı: ${value.source_status}` : '',
      value.raw_text || ''
    ].filter(Boolean);
    return structured.join('\n');
  }

  async function generateProjectProtocol(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });

    const existing = await query(
      `SELECT id, status, updated_at
         FROM protocol_drafts
        WHERE revision_id = $1
        LIMIT 1`,
      [project.revision_id]
    );
    if (existing.rows[0] && existing.rows[0].status === 'generating' &&
        Date.now() - new Date(existing.rows[0].updated_at).getTime() < 10 * 60 * 1000) {
      return sendJson(res, 409, { error: 'Protokol üretimi zaten devam ediyor.' });
    }
    if (existing.rows[0] && existing.rows[0].status === 'ready') {
      return sendJson(res, 409, { error: 'Bu revizyon için zaten bir protokol taslağı var.' });
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
      const sourceFiles = await loadSourceFiles(project.id, project.revision_id);
      const generated = await generateProtocolDraft({
        project_id: project.id,
        project_code: project.project_code,
        project_name: project.name,
        space_type: project.space_type,
        output_language: project.output_language,
        revision_number: project.revision_number,
        client_narrative: project.client_narrative,
        measurements: intakeText(project.measurements),
        fixed_elements: intakeText(project.fixed_elements),
        source_files: sourceFiles.map(sourceFileContract)
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
        [draftResult.rows[0].id, String(error.message || 'Protokol üretilemedi.').slice(0, 2000)]
      );
      error.publicMessage = 'Protokol üretilemedi. Proje kanıtlarını gözden geçirip yeniden deneyin.';
      throw error;
    }
  }

  async function updateProjectProtocol(req, res, projectId) {
    requireSameOrigin(req);
    const user = await requireUser(req, 'admin');
    const project = await loadProject(projectId, user.id);
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    const body = await readJson(req, 2 * 1024 * 1024);
    let content;
    try {
      const sourceFiles = await loadSourceFiles(project.id, project.revision_id);
      const candidate = structuredClone(body.content || {});
      candidate.source_files = sourceFiles.map(sourceFileContract);
      content = validateProtocolAdminContract(candidate);
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 400 });
    }
    if (content.project.id !== project.id || content.revision.number !== project.revision_number) {
      return sendJson(res, 409, { error: 'Protokol taslağı etkin proje revizyonuyla eşleşmiyor.' });
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
      if (!updated.rowCount) throw Object.assign(new Error('Protokol taslağı bulunamadı.'), { statusCode: 404 });
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
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    if (project.revision_state === 'approved') {
      return sendJson(res, 409, { error: 'Bu proje revizyonu zaten onaylandı.' });
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
      return sendJson(res, 409, { error: 'Onaydan önce kaydedilmiş bir protokol taslağı gerekiyor.' });
    }

    let content;
    try {
      const sourceFiles = await loadSourceFiles(project.id, project.revision_id);
      const candidate = structuredClone(draft.content);
      candidate.source_files = sourceFiles.map(sourceFileContract);
      content = validateProtocolAdminContract(candidate);
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 400 });
    }
    const qualityGate = evaluateProtocolAdminQuality(content);
    if (!qualityGate.can_approve) {
      return sendJson(res, 409, {
        error: 'Tüm engeller ve uyarılar çözülmeden protokol onaylanamaz.',
        quality_gate_result: qualityGate
      });
    }

    const approvedContent = structuredClone(content);
    approvedContent.revision.state = 'approved';
    const atlasSelectionResult = await query(
      `SELECT primary_lens_slug, supporting_lens_slug, alternative_lens_slug, rationale
         FROM project_atlas_selections
        WHERE revision_id = $1
        LIMIT 1`,
      [project.revision_id]
    );
    const snapshot = {
      schema_version: '1.0',
      audit: approvedContent,
      atlas_direction: atlasDirection(atlasSelectionResult.rows[0] || null),
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
    if (!project) return sendJson(res, 404, { error: 'Proje bulunamadı.' });
    const approvalResult = await query(
      `SELECT id, snapshot, snapshot_sha256, quality_gate_result, approved_at
         FROM approval_snapshots
        WHERE project_id = $1 AND revision_id = $2
        LIMIT 1`,
      [project.id, project.revision_id]
    );
    const approval = approvalResult.rows[0];
    if (!approval) return sendJson(res, 409, { error: 'Bu proje revizyonu henüz onaylanmadı.' });
    const currentSnapshotSha256 = crypto.createHash('sha256').update(canonicalJson(approval.snapshot)).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(approval.snapshot_sha256 || '') ||
        !crypto.timingSafeEqual(Buffer.from(currentSnapshotSha256), Buffer.from(approval.snapshot_sha256))) {
      throw Object.assign(new Error('Onaylı kayıt bütünlük kontrolünden geçemedi.'), { statusCode: 409 });
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
    if (!state.ready) return sendJson(res, 503, { error: 'Protokol yönetim sistemi henüz yapılandırılmadı.' });
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
    if (req.method === 'GET' && url.pathname === '/api/protocol-admin/spatial-atlas') {
      return getSpatialAtlas(req, res);
    }
    if (url.pathname === '/api/protocol-admin/projects' && req.method === 'GET') return listProjects(req, res);
    if (url.pathname === '/api/protocol-admin/projects' && req.method === 'POST') return createProject(req, res);
    const projectMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') {
      if (!uuid(projectMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return getProject(req, res, projectMatch[1]);
    }
    const generateMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/generate-protocol$/);
    if (generateMatch && req.method === 'POST') {
      if (!uuid(generateMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return generateProjectProtocol(req, res, generateMatch[1]);
    }
    const draftMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/protocol-draft$/);
    if (draftMatch && req.method === 'PUT') {
      if (!uuid(draftMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return updateProjectProtocol(req, res, draftMatch[1]);
    }
    const atlasSelectionMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/atlas-selection$/);
    if (atlasSelectionMatch && req.method === 'PUT') {
      if (!uuid(atlasSelectionMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return updateProjectAtlasSelection(req, res, atlasSelectionMatch[1]);
    }
    const fileCollectionMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/files$/);
    if (fileCollectionMatch && req.method === 'POST') {
      if (!uuid(fileCollectionMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return uploadProjectSourceFile(req, res, fileCollectionMatch[1]);
    }
    const fileItemMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/files\/([^/]+)$/);
    if (fileItemMatch && req.method === 'GET') {
      if (!uuid(fileItemMatch[1]) || !uuid(fileItemMatch[2])) return sendJson(res, 400, { error: 'Geçersiz dosya kimliği.' });
      return streamProjectSourceFile(req, res, fileItemMatch[1], fileItemMatch[2]);
    }
    if (fileItemMatch && req.method === 'PATCH') {
      if (!uuid(fileItemMatch[1]) || !uuid(fileItemMatch[2])) return sendJson(res, 400, { error: 'Geçersiz dosya kimliği.' });
      return archiveProjectSourceFile(req, res, fileItemMatch[1], fileItemMatch[2]);
    }
    const approvalMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/approve$/);
    if (approvalMatch && req.method === 'POST') {
      if (!uuid(approvalMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return approveProjectProtocol(req, res, approvalMatch[1]);
    }
    const pdfMatch = url.pathname.match(/^\/api\/protocol-admin\/projects\/([^/]+)\/approved-pdf$/);
    if (pdfMatch && req.method === 'GET') {
      if (!uuid(pdfMatch[1])) return sendJson(res, 400, { error: 'Geçersiz proje kimliği.' });
      return downloadApprovedProtocolPdf(req, res, pdfMatch[1]);
    }
    return sendJson(res, 404, { error: 'İstek adresi bulunamadı.' });
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
        sendJson(res, 405, { error: 'Bu istek yöntemine izin verilmiyor.' });
        return true;
      }
      const atlasImageMatch = url.pathname.match(/^\/protocol-admin\/atlas-images\/([a-z0-9-]+\.webp)$/);
      if (atlasImageMatch) sendFile(res, path.join(publicDirectory, 'atlas-images', atlasImageMatch[1]), 'image/webp');
      else if (url.pathname === '/protocol-admin/admin.css') sendFile(res, path.join(publicDirectory, 'admin.css'), 'text/css; charset=utf-8');
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
        error: error.publicMessage || (error.statusCode && error.statusCode < 500 ? error.message : 'Beklenmeyen bir sunucu hatası oluştu.'),
        request_id: requestId
      });
      return true;
    }
  }

  return { handle, initialize, state };
}

module.exports = { createProtocolAdminRouter, detectedFileType, safeOriginalFilename };
