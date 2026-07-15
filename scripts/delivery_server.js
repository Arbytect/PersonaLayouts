const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { loadEnvFile } = require('../env-loader');

const ROOT = path.resolve(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || process.env.DELIVERY_SERVER_PORT || 8787);
const HOST = process.env.DELIVERY_SERVER_HOST || '127.0.0.1'; // explicit bind; set to 0.0.0.0 only if you intend this to be reachable off-box
const SECRET = process.env.DELIVERY_WEBHOOK_SECRET || '';
const ALLOWED_ORIGIN = process.env.DELIVERY_ALLOWED_ORIGIN || ''; // leave unset for a pure server-to-server webhook (no CORS needed)

if (!SECRET) {
  console.error('[delivery_server] FATAL: DELIVERY_WEBHOOK_SECRET is not set. Refusing to start with auth disabled.');
  console.error('[delivery_server] Set DELIVERY_WEBHOOK_SECRET in .env, then restart.');
  process.exit(1);
}

function send(res, status, payload) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Delivery-Secret';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS, GET';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseLastJson(stdout) {
  for (let index = stdout.indexOf('{'); index !== -1; index = stdout.indexOf('{', index + 1)) {
    try {
      return JSON.parse(stdout.slice(index));
    } catch (error) {
      // Keep scanning; compile_order may print logs before the final JSON object.
    }
  }
  throw new Error('compile_order did not return JSON. Output: ' + stdout.slice(-500));
}

function runCompileOrder(payload) {
  return new Promise((resolve, reject) => {
    const args = ['scripts/compile_order.js', '--payload=' + JSON.stringify(payload)];
    if (payload.dry_run === true || payload.dry_run === 'true') args.push('--dry-run=true');
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => stdout += chunk.toString());
    child.stderr.on('data', chunk => stderr += chunk.toString());
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || 'compile_order failed with exit code ' + code));
        return;
      }

      try {
        resolve(parseLastJson(stdout));
      } catch (error) {
        reject(new Error('Could not parse compile_order JSON: ' + error.message + '\nOutput: ' + stdout.slice(-800)));
      }
    });
  });
}

function safeSecretEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeOrderId(payload) {
  return String(payload.order_id || payload.payment_id || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

async function runIdempotent(payload) {
  const orderId = safeOrderId(payload);
  if (!orderId) throw new Error('order_id is required');
  const resultPath = path.join(ROOT, 'output', 'deliveries', `${orderId}.delivery_result.json`);
  const lockPath = path.join(ROOT, 'output', 'deliveries', `${orderId}.lock`);
  if (fs.existsSync(resultPath)) return JSON.parse(fs.readFileSync(resultPath, 'utf8'));

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      const inProgress = new Error('Order is already being processed.');
      inProgress.statusCode = 409;
      throw inProgress;
    }
    throw error;
  }

  try {
    return await runCompileOrder({ ...payload, order_id: orderId });
  } finally {
    if (lock !== undefined) fs.closeSync(lock);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 'persona-layouts-delivery', port: PORT });
  if (req.method !== 'POST' || req.url !== '/api/compile-order') return send(res, 404, { error: 'Not found' });

  const provided = req.headers['x-delivery-secret'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!safeSecretEqual(provided, SECRET)) return send(res, 401, { error: 'Unauthorized' });

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const result = await runIdempotent(payload);
    send(res, 200, result);
  } catch (error) {
    // Don't leak internal error details (file paths, stack traces) to the caller.
    const requestId = crypto.randomUUID();
    console.error(`[delivery_server] request ${requestId} failed:`, error);
    send(res, error.statusCode || 500, { error: error.statusCode === 409 ? error.message : 'Internal error processing order.', request_id: requestId });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Persona Layouts delivery server listening on http://${HOST}:${PORT}`);
  console.log('POST /api/compile-order');
});
