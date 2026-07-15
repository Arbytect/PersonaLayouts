const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { loadEnvFile } = require('../env-loader');
const { runRoomTransformPipeline } = require('./room_transform_pipeline');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const GENERATED_DIR = path.join(OUTPUT_DIR, 'generated');
const RESULT_DIR = path.join(OUTPUT_DIR, 'deliveries');
const WORK_DIR = path.join(OUTPUT_DIR, 'work');

const REQUIRED_FIELDS = ['order_id', 'email', 'persona', 'room_type', 'room_size', 'occupancy', 'pain'];
const VALID_PERSONAS = ['sovereign', 'sage', 'alchemist', 'weaver'];
const VALID_ROOMS = ['studio', 'bedroom', 'living_room', 'open_plan', 'kitchen', 'balcony', 'home_office'];
const VALID_SIZES = ['micro', 'tight', 'compact', 'standard', 'large', 'generous'];

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const idx = arg.indexOf('=');
    if (idx === -1) args[arg.slice(2)] = true;
    else args[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return args;
}

function readPayload(args) {
  if (args.payload) return JSON.parse(String(args.payload).replace(/^\uFEFF/, ''));
  if (args.file) return JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8').replace(/^\uFEFF/, ''));

  if (!process.stdin.isTTY) {
    const input = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim();
    if (input) return JSON.parse(input);
  }

  throw new Error('Missing order payload. Use --file=order.json, --payload={...}, or pipe JSON to stdin.');
}

function normalizeBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
  return Boolean(value);
}

function slug(value, fallback = 'item') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/m²|m2/g, 'sqm')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalPersona(raw) {
  const customFields = raw.custom_fields || raw.customFields || {};
  const value = normalizeToken(raw.persona || raw.persona_key || raw.archetype || raw.variant || raw.fileKey || raw.custom_fileKey || customFields.fileKey);
  if (value.includes('sovereign')) return 'sovereign';
  if (value.includes('sage') || value.includes('focus') || value.includes('minimal')) return 'sage';
  if (value.includes('alchemist') || value.includes('creative') || value.includes('fluid')) return 'alchemist';
  if (value.includes('weaver') || value.includes('social') || value.includes('warm') || value.includes('natural')) return 'weaver';
  return 'sovereign';
}

function canonicalVariant(raw, persona) {
  const customFields = raw.custom_fields || raw.customFields || {};
  const value = normalizeToken(raw.variant || raw.variant_key || raw.persona_variant || raw.persona || raw.fileKey || raw.custom_fileKey || customFields.fileKey);
  if (!value || value === persona) return null;
  if (value.includes('clinical')) return 'clinical';
  if (value.includes('precision')) return 'precision';
  if (value.includes('hermit')) return 'hermit';
  if (value.includes('scholar')) return 'scholar';
  if (value.includes('fluid')) return 'fluid';
  if (value.includes('chaotic')) return 'chaotic';
  if (value.includes('intimate')) return 'intimate';
  if (value.includes('dynamic')) return 'dynamic';
  return null;
}

function canonicalRoom(raw) {
  const customFields = raw.custom_fields || raw.customFields || {};
  const value = normalizeToken(raw.room_type || raw.room || raw.room_friction || raw.room_label || raw.fileKey || raw.custom_fileKey || customFields.fileKey);
  if (value.includes('studio')) return 'studio';
  if (value.includes('bed')) return 'bedroom';
  if (value.includes('living')) return 'living_room';
  if (value.includes('open')) return 'open_plan';
  if (value.includes('kitchen')) return 'kitchen';
  if (value.includes('balcony')) return 'balcony';
  if (value.includes('office') || value.includes('work')) return 'home_office';
  return 'living_room';
}

function canonicalSize(raw) {
  const source = raw.room_size || raw.size || raw.area_m2 || raw.area || '';
  const value = normalizeToken(source);
  const numeric = Number(String(source).replace(',', '.').match(/\d+(\.\d+)?/)?.[0] || '');
  if (value.includes('micro')) return 'micro';
  if (value.includes('tight')) return 'tight';
  if (value.includes('compact') || value.includes('small')) return 'compact';
  if (value.includes('standard') || value.includes('medium')) return 'standard';
  if (value.includes('large')) return 'large';
  if (value.includes('generous')) return 'generous';
  if (numeric && numeric <= 9) return 'micro';
  if (numeric && numeric <= 16) return 'compact';
  if (numeric && numeric <= 24) return 'standard';
  if (numeric && numeric <= 36) return 'large';
  if (numeric) return 'generous';
  return 'compact';
}

function canonicalOccupancy(raw) {
  const value = normalizeToken(raw.occupancy || raw.lifestyle || raw.lifestyle_pressure || raw.lifestyle_label || raw.usage);
  if (value.includes('partner') || value.includes('couple') || value.includes('two')) return 'partner';
  if (value.includes('family') || value.includes('kids') || value.includes('child')) return 'family';
  if (value.includes('roommate') || value.includes('shared')) return 'shared';
  return 'solo';
}

function canonicalPets(raw) {
  if (normalizeBool(raw.pets)) return true;
  const value = normalizeToken(raw.occupancy || raw.lifestyle || raw.lifestyle_pressure || raw.lifestyle_label || raw.usage);
  return value.includes('pet') || value.includes('dog') || value.includes('cat');
}

function canonicalPain(raw) {
  const value = normalizeToken(raw.pain || raw.painKey || raw.pain_key || raw.raw_input?.pain || raw.spatial_pressure || raw.extra);
  if (value.includes('light')) return 'lighting';
  if (value.includes('clutter') || value.includes('storage') || value.includes('mess')) return 'storage';
  if (value.includes('routine') || value.includes('flow') || value.includes('circulation')) return 'circulation';
  if (value.includes('privacy') || value.includes('boundary')) return 'privacy';
  if (value.includes('noise') || value.includes('acoustic')) return 'acoustic';
  if (value.includes('focus') || value.includes('work')) return 'focus';
  return value || 'storage';
}

function deriveOrderFields(raw) {
  const persona = canonicalPersona(raw);
  return {
    order_id: raw.order_id || raw.orderId || raw.id || raw.order_number || raw.sale_id || raw.saleId || raw.session_id || raw.purchase_id || raw.resource_id,
    email: raw.email || raw.customer_email || raw.purchaser_email || raw.buyer_email || raw.email_address,
    customer_name: raw.customer_name || raw.customer?.name || raw.name,
    package: raw.package || raw.package_code || raw.product_package || raw.metadata?.package,
    payment_id: raw.payment_id || raw.paymentId,
    quiz_session_id: raw.quiz_session_id || raw.metadata?.quiz_session_id,
    photo_key: raw.photo_key || raw.image_key || raw.metadata?.photo_key,
    persona,
    variant: canonicalVariant(raw, persona),
    room_type: canonicalRoom(raw),
    room_size: canonicalSize(raw),
    occupancy: canonicalOccupancy(raw),
    pain: canonicalPain(raw),
    pets: canonicalPets(raw),
    use_api: raw.use_api,
    source: raw.source || raw.payment_provider || raw.provider || 'make'
  };
}

function normalizeOrder(raw) {
  const derived = deriveOrderFields(raw);
  const order = {
    order_id: slug(derived.order_id, 'order-' + Date.now()),
    email: String(derived.email || '').trim().toLowerCase(),
    customer_name: String(derived.customer_name || '').trim().slice(0, 120),
    package: String(derived.package || '39').replace('$', '').trim(),
    payment_id: String(derived.payment_id || '').trim(),
    quiz_session_id: String(derived.quiz_session_id || '').trim(),
    photo_key: String(derived.photo_key || '').trim(),
    persona: String(derived.persona || 'sovereign').trim().toLowerCase(),
    variant: derived.variant ? String(derived.variant).trim().toLowerCase() : null,
    room_type: String(derived.room_type || 'living_room').trim().toLowerCase(),
    room_size: String(derived.room_size || 'compact').trim().toLowerCase(),
    occupancy: String(derived.occupancy || 'solo').trim().toLowerCase(),
    pain: String(derived.pain || 'storage').trim().toLowerCase(),
    pets: normalizeBool(derived.pets),
    use_api: derived.use_api === undefined ? true : normalizeBool(derived.use_api),
    source: derived.source || 'make',
    raw
  };

  const missing = REQUIRED_FIELDS.filter(field => !order[field]);
  if (missing.length) throw new Error('Missing required order field(s): ' + missing.join(', '));
  if (!order.email.includes('@')) throw new Error('Invalid email in order payload.');
  if (!VALID_PERSONAS.includes(order.persona)) throw new Error('Invalid persona: ' + order.persona);
  if (!VALID_ROOMS.includes(order.room_type)) throw new Error('Invalid room_type: ' + order.room_type);
  if (!VALID_SIZES.includes(order.room_size)) throw new Error('Invalid room_size: ' + order.room_size);
  if (!['39', '59'].includes(order.package)) throw new Error('Invalid package: ' + order.package);
  if (order.package === '59' && !order.photo_key) throw new Error('$59 orders require photo_key.');

  return order;
}

function variantSuffix(order) {
  const map = {
    sovereign: { variantA: 'clinical', variantB: 'precision' },
    sage: { variantA: 'hermit', variantB: 'scholar' },
    alchemist: { variantA: 'fluid', variantB: 'chaotic' },
    weaver: { variantA: 'intimate', variantB: 'dynamic' }
  };
  if (!order.variant) return order.persona;
  if (order.variant === 'varianta' || order.variant === 'variantA') return map[order.persona]?.variantA || order.variant;
  if (order.variant === 'variantb' || order.variant === 'variantB') return map[order.persona]?.variantB || order.variant;
  return order.variant;
}

function expectedOutputPaths(order) {
  const suffix = variantSuffix(order);
  const pdfName = `${order.persona}_${suffix}_${order.room_type}_${order.room_size}_${order.occupancy}_${order.pain}.pdf`;
  const imageName = `${order.persona}_${order.variant || 'base'}_${order.room_type}_${order.room_size}_${order.occupancy}_${order.pain}.png`;
  return {
    pdfPath: path.join(WORK_DIR, order.order_id, pdfName),
    imagePath: path.join(GENERATED_DIR, imageName),
    pdfName,
    imageName,
    suffix
  };
}

function findLatestGeneratedPdf(order, notBeforeMs) {
  const prefix = `${order.persona}_`;
  const suffix = `_${order.room_type}_${order.room_size}_${order.occupancy}_${order.pain}.pdf`;
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  return fs.readdirSync(OUTPUT_DIR)
    .filter(name => name.startsWith(prefix) && name.endsWith(suffix))
    .map(name => ({ name, fullPath: path.join(OUTPUT_DIR, name), stat: fs.statSync(path.join(OUTPUT_DIR, name)) }))
    // Only consider files written by *this* generator run (small clock-skew buffer), so a
    // concurrent order for the same persona/room/size/occupancy/pain combo can never have its
    // PDF silently attached to a different customer's delivery.
    .filter(entry => notBeforeMs === undefined || entry.stat.mtimeMs >= notBeforeMs - 2000)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
}

function applyGeneratedPdfFallback(paths, order, notBeforeMs) {
  if (fs.existsSync(paths.pdfPath)) return;
  const match = findLatestGeneratedPdf(order, notBeforeMs);
  if (!match) {
    throw new Error(
      `Expected PDF not found at ${paths.pdfPath}, and no matching PDF for this exact order was generated ` +
      `during this run (avoiding fallback to an older/unrelated file to prevent cross-order mixups).`
    );
  }
  paths.pdfPath = match.fullPath;
  paths.pdfName = match.name;
  const middle = match.name
    .slice(order.persona.length + 1, -'.pdf'.length - (`_${order.room_type}_${order.room_size}_${order.occupancy}_${order.pain}`).length);
  if (middle) paths.suffix = middle;
}

function configHash(order) {
  const stable = {
    persona: order.persona,
    variant: order.variant,
    room_type: order.room_type,
    room_size: order.room_size,
    occupancy: order.occupancy,
    pain: order.pain,
    pets: order.pets,
    use_api: order.use_api
  };
  if (order.package === '59') {
    stable.package = order.package;
    stable.photo_key = order.photo_key;
    stable.order_id = order.order_id;
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

function runNodeScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit code ${result.status}`);
}

function requireR2Env() {
  const names = ['PL_R2_ACCOUNT_ID', 'PL_R2_ACCESS_KEY_ID', 'PL_R2_SECRET_ACCESS_KEY', 'PL_R2_BUCKET_NAME'];
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) throw new Error('Missing R2 env var(s): ' + missing.join(', '));
}

function createR2Client() {
  requireR2Env();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.PL_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.PL_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.PL_R2_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
  });
}

async function existsInR2(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function putFile(client, bucket, key, filePath, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(filePath),
    ContentType: contentType
  }));
}

async function signDownload(client, bucket, key, fileName) {
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${fileName}"`
  }), { expiresIn: Number(process.env.PL_R2_SIGNED_URL_TTL || 86400) });
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env'));
  fs.mkdirSync(RESULT_DIR, { recursive: true });

  const args = parseArgs();
  const order = normalizeOrder(readPayload(args));
  const dryRun = normalizeBool(args.dry_run || args['dry-run']);
  const paths = expectedOutputPaths(order);
  const hash = configHash(order);

  let photoArtifacts = null;
  if (order.package === '59') {
    const orderWorkDir = path.join(WORK_DIR, order.order_id);
    photoArtifacts = await runRoomTransformPipeline(order, orderWorkDir, dryRun);
  }

  const generatorArgs = [
    `--package=${order.package}`,
    `--persona=${order.persona}`,
    order.variant ? `--variant=${order.variant}` : null,
    `--room_type=${order.room_type}`,
    `--room_size=${order.room_size}`,
    `--occupancy=${order.occupancy}`,
    `--pain=${order.pain}`,
    `--pets=${order.pets}`,
    `--use_api=${photoArtifacts ? false : order.use_api}`,
    `--customer_name=${order.customer_name || 'Your Layout'}`,
    `--order_id=${order.order_id}`,
    photoArtifacts ? `--ai_enrichment_file=${photoArtifacts.enrichmentPath}` : null,
    photoArtifacts ? `--original_photo_file=${photoArtifacts.originalPath}` : null,
    photoArtifacts ? `--cover_image_file=${photoArtifacts.coverPath}` : null,
    `--output_file=${paths.pdfPath}`
  ].filter(Boolean);

  const generationStartedAt = Date.now();
  runNodeScript(path.join(ROOT, 'dossier_generator.js'), generatorArgs);
  applyGeneratedPdfFallback(paths, order, generationStartedAt);
  if (!fs.existsSync(paths.pdfPath)) throw new Error('Expected PDF was not generated: ' + paths.pdfPath);

  runNodeScript(path.join(ROOT, 'scripts', 'pdf_qa.js'), []);

  const metadata = {
    order_id: order.order_id,
    email: order.email,
    customer_name: order.customer_name,
    package: order.package,
    payment_id: order.payment_id,
    quiz_session_id: order.quiz_session_id,
    photo_key: order.photo_key || null,
    config_hash: hash,
    persona: order.persona,
    variant: order.variant,
    resolved_variant: paths.suffix,
    room_type: order.room_type,
    room_size: order.room_size,
    occupancy: order.occupancy,
    pain: order.pain,
    pets: order.pets,
    use_api: order.use_api,
    generated_at: new Date().toISOString(),
    local_pdf: paths.pdfPath,
    local_cover_image: photoArtifacts?.coverPath || (fs.existsSync(paths.imagePath) ? paths.imagePath : null),
    local_photo_analysis: photoArtifacts?.enrichmentPath || null,
    replicate_prediction_id: photoArtifacts?.predictionId || null
  };

  if (dryRun) {
    const dryResult = { status: 'dry_run_ok', metadata };
    console.log(JSON.stringify(dryResult, null, 2));
    return;
  }

  const client = createR2Client();
  const bucket = process.env.PL_R2_BUCKET_NAME;
  const orderPrefix = `deliveries/orders/${order.order_id}`;
  const cachePrefix = `cache/dossiers/${hash}`;
  const pdfKey = `${orderPrefix}/spatial-prescription.pdf`;
  const metadataKey = `${orderPrefix}/metadata.json`;
  const coverKey = `${orderPrefix}/cover-concept.png`;
  const cachePdfKey = `${cachePrefix}/spatial-prescription.pdf`;
  const cacheCoverKey = `${cachePrefix}/cover-concept.png`;
  const analysisKey = `${orderPrefix}/photo-analysis.json`;
  const transformKey = `${orderPrefix}/room-transform.jpg`;

  await putFile(client, bucket, pdfKey, paths.pdfPath, 'application/pdf');
  await putFile(client, bucket, cachePdfKey, paths.pdfPath, 'application/pdf');

  const finalCoverPath = photoArtifacts?.coverPath || paths.imagePath;
  const finalCoverType = finalCoverPath && ['.jpg', '.jpeg'].includes(path.extname(finalCoverPath).toLowerCase()) ? 'image/jpeg' : 'image/png';
  if (finalCoverPath && fs.existsSync(finalCoverPath)) {
    await putFile(client, bucket, coverKey, finalCoverPath, finalCoverType);
    if (!(await existsInR2(client, bucket, cacheCoverKey))) {
      await putFile(client, bucket, cacheCoverKey, finalCoverPath, finalCoverType);
    }
    metadata.cover_key = coverKey;
    metadata.cache_cover_key = cacheCoverKey;
  }

  if (photoArtifacts) {
    await putFile(client, bucket, analysisKey, photoArtifacts.enrichmentPath, 'application/json');
    metadata.photo_analysis_key = analysisKey;
    if (photoArtifacts.coverPath !== photoArtifacts.originalPath) {
      await putFile(client, bucket, transformKey, photoArtifacts.coverPath, 'image/jpeg');
      metadata.room_transform_key = transformKey;
    }
  }

  metadata.pdf_key = pdfKey;
  metadata.cache_pdf_key = cachePdfKey;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: metadataKey,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json'
  }));

  const downloadUrl = await signDownload(client, bucket, pdfKey, `spatial-prescription-${order.order_id}.pdf`);
  const result = {
    status: 'delivered',
    order_id: order.order_id,
    email: order.email,
    download_url: downloadUrl,
    expires_in_seconds: Number(process.env.PL_R2_SIGNED_URL_TTL || 86400),
    pdf_key: pdfKey,
    cover_key: metadata.cover_key || null,
    photo_analysis_key: metadata.photo_analysis_key || null,
    room_transform_key: metadata.room_transform_key || null,
    metadata_key: metadataKey,
    cache_pdf_key: cachePdfKey,
    config_hash: hash
  };

  const resultPath = path.join(RESULT_DIR, `${order.order_id}.delivery_result.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error('[compile_order] ' + error.message);
  process.exit(1);
});
