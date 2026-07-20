const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'dossier_template.html');

const PERSONAS = ['sovereign', 'sage', 'alchemist', 'weaver'];
const ROOM_TYPES = ['studio', 'bedroom', 'living_room', 'open_plan', 'kitchen', 'balcony'];
const ROOM_SIZES = ['micro', 'tight', 'compact', 'standard', 'large', 'generous'];
const REQUIRED_DATA_FILES = [
  'diagnosis_rules.json',
  'matrix_extracted.json',
  'occupancy_modifiers.json',
  'pain_modifiers.json',
  'personas.json',
  'plants_products.json',
  'protocols_db.json',
  'room_constraints.json',
  'room_details_matrix.json',
  'room_material_notes.json',
  'size_modifiers.json'
];

const EXPECTED_TEMPLATE_TOKENS = [
  'CUSTOMER_NAME',
  'DELIVERY_DATE',
  'DOSSIER_ID',
  'PRODUCT_TIER',
  'COVER_PRODUCT_NAME',
  'COVER_DESCRIPTION',
  'PHOTO_AUDIT_PAGES_HTML',
  'VARIANT_NAME',
  'SPACE_TYPE',
  'SPACE_AREA',
  'LIFESTYLE_LABEL',
  'RATIOS_LABEL',
  'PRESCRIPTION_HEADLINE',
  'PRESCRIPTION_CARDS_HTML',
  'SEVEN_DAY_PLAN_HTML',
  'STYLE_HIERARCHY_HTML',
  'HIERARCHY_VISUAL_HTML',
  'BASE_PLAN_IMAGE_HTML',
  'BEFORE_SVG_OVERLAY',
  'ISOMETRIC_IMAGE_HTML',
  'COVER_VISUAL_HTML',
  'SPATIAL_TENSION',
  'LIFESTYLE_STRESS',
  'BRUTAL_OBSERVATION',
  'STRESS_ROWS_HTML',
  'BLUEPRINT_IMAGE_HTML',
  'AFTER_SVG_OVERLAY',
  'CLEARANCES_TITLE',
  'CLEARANCES_TABLE_HTML',
  'FUNCTIONAL_ZONING_HTML',
  'ZONING_DIAGRAM_HTML',
  'PROCUREMENT_TABLE_HTML',
  'MATERIAL_PALETTE_HTML',
  'DETAIL_LIGHTING',
  'DETAIL_GEOMETRY',
  'DETAIL_DINING',
  'DETAIL_STORAGE',
  'DETAIL_DURABILITY',
  'PRIORITY_ACTIONS_HTML',
  'PLANTS_LIST_HTML',
  'PLANT_PLACEMENT_HTML',
  'RENOVATION_PATHWAYS_HTML',
  'BESPOKE_UPGRADE_HTML',
  'FURNITURE_RECOMMENDATION_HTML',
  'FURNITURE_CONTEXT_HTML'
];

const MOJIBAKE_PATTERNS = [/Â/g, /Ã/g, /â[^\s]*/g];
const errors = [];
const warnings = [];

function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing data file: data/${fileName}`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`Invalid JSON in data/${fileName}: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function scanForMojibake(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  const hits = [];
  for (const pattern of MOJIBAKE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) hits.push(...matches.slice(0, 5));
  }

  if (hits.length > 0) {
    warnings.push(`${relativePath} may contain mojibake: ${[...new Set(hits)].join(', ')}`);
  }
}

for (const fileName of REQUIRED_DATA_FILES) readJson(fileName);

const personas = readJson('personas.json') || {};
const protocols = readJson('protocols_db.json') || {};
const roomDetails = readJson('room_details_matrix.json') || {};
const diagnosisRules = readJson('diagnosis_rules.json') || {};
const painModifiers = readJson('pain_modifiers.json') || {};
const occupancyModifiers = readJson('occupancy_modifiers.json') || {};
const plantsProducts = readJson('plants_products.json') || {};

for (const persona of PERSONAS) {
  const personaData = personas[persona];
  assert(personaData, `Missing persona: ${persona}`);
  if (!personaData) continue;

  assert(personaData.theme_colors, `Missing theme_colors for persona: ${persona}`);
  assert(Array.isArray(personaData.active_protocols), `Missing active_protocols array for persona: ${persona}`);

  for (const protocolId of personaData.active_protocols || []) {
    assert(protocols[protocolId], `Persona ${persona} references missing protocol: ${protocolId}`);
  }

  for (const size of ROOM_SIZES) {
    const key = `${persona}_${size}`;
    warn(diagnosisRules[key], `Missing diagnosis rule for ${key}; generator will use fallback.`);
  }
}

for (const roomType of ROOM_TYPES) {
  assert(roomDetails[roomType], `Missing room_details_matrix entry: ${roomType}`);
}

assert(occupancyModifiers.just_me, 'Missing default occupancy modifier: just_me');
assert(painModifiers.pain_details, 'Missing pain_modifiers.pain_details');
warn(Array.isArray(plantsProducts.plants), 'plants_products.json should expose a plants array.');

if (!fs.existsSync(TEMPLATE_PATH)) {
  errors.push('Missing template: templates/dossier_template.html');
} else {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const templateTokens = [...template.matchAll(/{{([A-Z0-9_]+)}}/g)].map(match => match[1]);
  const uniqueTemplateTokens = [...new Set(templateTokens)];

  for (const token of EXPECTED_TEMPLATE_TOKENS) {
    assert(uniqueTemplateTokens.includes(token), `Template is missing expected token: {{${token}}}`);
  }

  for (const token of uniqueTemplateTokens) {
    warn(EXPECTED_TEMPLATE_TOKENS.includes(token), `Template has unmanaged token: {{${token}}}`);
  }
}

[
  'dossier_generator.js',
  'generate_48_pdfs.js',
  'templates/dossier_template.html',
  'data/diagnosis_rules.json',
  'data/protocols_db.json',
  'data/room_details_matrix.json'
].forEach(scanForMojibake);

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length > 0) {
  console.error('\nValidation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('\nPDF system validation passed.');


