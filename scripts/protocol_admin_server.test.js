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
    'project-form'
  ];
  requiredIds.forEach(id => assert.strictEqual(document.querySelectorAll(`#${id}`).length, 1, `${id} must exist exactly once.`));
  assert.strictEqual(document.querySelectorAll('script:not([src])').length, 0, 'Inline scripts are forbidden by CSP.');
  assert.strictEqual(document.querySelectorAll('[style]').length, 0, 'Inline styles are forbidden by CSP.');
  assert.strictEqual(document.querySelector('meta[name="robots"]').content, 'noindex,nofollow');

  const deliveryServer = fs.readFileSync(path.join(root, 'scripts', 'delivery_server.js'), 'utf8');
  assert(deliveryServer.indexOf('protocolAdmin.handle(req, res)') < deliveryServer.indexOf("req.url !== '/api/compile-order'"));

  const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '001_protocol_admin_core.sql'), 'utf8');
  assert(migration.includes('CREATE TABLE project_intakes'));
  assert(migration.includes('CREATE TABLE auth_sessions'));
  assert(migration.includes('approval_snapshots_immutable_update'));

  console.log('Protocol Admin server and interface tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
