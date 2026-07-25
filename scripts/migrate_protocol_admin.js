const path = require('path');
const { loadEnvFile } = require('../env-loader');
const { closePool, runMigrations } = require('./protocol_admin_db');

const root = path.resolve(__dirname, '..');
loadEnvFile(path.join(root, '.env'));

runMigrations(root)
  .then(completed => {
    console.log(JSON.stringify({ ok: true, applied: completed }, null, 2));
  })
  .catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => closePool());
