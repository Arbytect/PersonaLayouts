const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { hashPassword, verifyPassword } = require('./protocol_admin_auth');

async function run() {
  const encoded = await hashPassword('correct-horse-battery-staple');
  assert(encoded.startsWith('scrypt$'));
  assert.strictEqual(await verifyPassword('correct-horse-battery-staple', encoded), true);
  assert.strictEqual(await verifyPassword('wrong-password-value', encoded), false);
  assert.rejects(() => hashPassword('too-short'), /at least 12 characters/);

  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'protocol-admin', 'index.html'), 'utf8');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const requiredIds = [
    'login-view',
    'app-view',
    'login-form',
    'project-list-view',
    'new-project-view',
    'project-detail-view',
    'project-form',
    'protocol-generate-button',
    'protocol-draft-section',
    'protocol-save-button',
    'protocol-approve-button',
    'protocol-pdf-button',
    'protocol-warning-list',
    'protocol-workflow-nav',
    'protocol-brief-panel',
    'protocol-step-prev',
    'protocol-step-next',
    'brief-readiness',
    'atlas-recommend-button',
    'project-atlas-recommendations',
    'atlas-primary-select',
    'atlas-supporting-select',
    'atlas-alternative-select',
    'atlas-selection-rationale',
    'atlas-save-selection-button',
    'atlas-view',
    'atlas-stats',
    'atlas-search',
    'atlas-filters',
    'atlas-comparison-select',
    'atlas-comparison-panel',
    'atlas-list',
    'atlas-detail',
    'atlas-boundary-text'
  ];
  requiredIds.forEach(id => assert.strictEqual(document.querySelectorAll(`#${id}`).length, 1, `${id} must exist exactly once.`));
  assert.strictEqual(document.querySelectorAll('script:not([src])').length, 0, 'Inline scripts are forbidden by CSP.');
  assert.strictEqual(document.querySelectorAll('[style]').length, 0, 'Inline styles are forbidden by CSP.');
  assert.strictEqual(document.querySelector('meta[name="robots"]').content, 'noindex,nofollow');
  assert.strictEqual(document.querySelector('link[rel="manifest"]').getAttribute('href'), '/protocol-admin/manifest.webmanifest');
  assert(document.querySelector('link[rel="stylesheet"]').getAttribute('href').includes('?v=atlas-'));
  assert(document.querySelector('script[src]').getAttribute('src').includes('?v=atlas-'));
  assert.strictEqual(document.querySelectorAll('[data-workflow-step]').length, 4);
  assert.strictEqual(document.querySelectorAll('[data-module]').length, 2);
  assert.strictEqual(document.querySelectorAll('input[name="room_width_cm"]').length, 1);
  assert.strictEqual(document.querySelectorAll('select[name="measurement_source"]').length, 1);
  const visibleInterface = document.body.textContent.replace(/\s+/g, ' ');
  ['Admin Workspace', 'AUDIT WORKSPACE', 'NEW AUDIT', 'Public Preview', 'We noticed'].forEach(phrase => {
    assert(!visibleInterface.includes(phrase), `English interface phrase remains: ${phrase}`);
  });

  const deliveryServer = fs.readFileSync(path.join(root, 'scripts', 'delivery_server.js'), 'utf8');
  assert(deliveryServer.indexOf('protocolAdmin.handle(req, res)') < deliveryServer.indexOf("req.url !== '/api/compile-order'"));

  const router = fs.readFileSync(path.join(root, 'scripts', 'protocol_admin_router.js'), 'utf8');
  assert(!router.includes("'project', $1::text"), 'Audit entity ID must not reuse the UUID query parameter as text.');
  assert(router.includes('/generate-protocol'));
  assert(router.includes('/protocol-draft'));
  assert(router.includes('/approve'));
  assert(router.includes('/approved-pdf'));
  assert(router.includes('/protocol-admin/manifest.webmanifest'));
  assert(router.includes('/protocol-admin/sw.js'));
  assert(router.includes('approval_snapshots'));
  assert(router.includes('generated_reports'));
  assert(router.includes('/api/protocol-admin/spatial-atlas'));
  assert(router.includes('/atlas-selection'));
  assert(router.includes("await requireUser(req, 'admin')"));
  assert(router.includes('/protocol-admin\\/atlas-images'));

  const adminJs = fs.readFileSync(path.join(root, 'protocol-admin', 'admin.js'), 'utf8');
  assert(adminJs.includes("api('/api/protocol-admin/spatial-atlas')"));
  assert(adminJs.includes('renderAtlasDetail'));
  assert(adminJs.includes('renderAtlasPhilosophy'));
  assert(adminJs.includes('renderAtlasRooms'));
  assert(adminJs.includes('renderAtlasHybrids'));
  assert(adminJs.includes("updateViaCache: 'none'"));
  const atlas = JSON.parse(fs.readFileSync(path.join(root, 'data', 'spatial_design_library_master.json'), 'utf8'));
  assert.strictEqual(atlas.version, '4.0.0-tr');
  assert.strictEqual(atlas.lenses.length, 20);
  assert.strictEqual(atlas.sources.length, 35);
  assert.strictEqual(atlas.reference_registry.length, 24);
  assert.strictEqual(atlas.comparison_sets.length, 7);
  assert(atlas.hybrid_framework && atlas.local_context);
  assert.strictEqual(atlas.lenses.filter(lens => lens.public.philosophy).length, 20);
  assert.strictEqual(
    atlas.lenses.reduce((sum, lens) => sum + Object.keys(lens.public.room_applications || {}).length, 0),
    120
  );
  const roomProtocols = atlas.lenses.flatMap(lens => Object.values(lens.public.room_applications || {}));
  assert.strictEqual(roomProtocols.filter(protocol =>
    protocol.intent &&
    protocol.furniture_direction &&
    protocol.material_direction &&
    protocol.lighting_direction &&
    protocol.avoid &&
    protocol.success_test &&
    Array.isArray(protocol.project_checks)
  ).length, 120);
  const atlasImages = fs.readdirSync(path.join(root, 'protocol-admin', 'atlas-images')).filter(name => name.endsWith('.webp'));
  assert.strictEqual(atlasImages.length, 21);

  const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '001_protocol_admin_core.sql'), 'utf8');
  assert(migration.includes('CREATE TABLE project_intakes'));
  assert(migration.includes('CREATE TABLE auth_sessions'));
  assert(migration.includes('approval_snapshots_immutable_update'));
  const draftMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '002_protocol_admin_drafts.sql'), 'utf8');
  assert(draftMigration.includes('CREATE TABLE protocol_drafts'));
  const atlasMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '003_project_atlas_selections.sql'), 'utf8');
  assert(atlasMigration.includes('CREATE TABLE project_atlas_selections'));

  console.log('Protocol Admin server and interface tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
