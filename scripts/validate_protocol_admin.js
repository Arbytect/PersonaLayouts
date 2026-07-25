const fs = require('fs');
const path = require('path');
const { evaluateProtocolAdminQuality } = require('./protocol_admin_quality_gate');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (!arg.startsWith('--')) return;
    const separator = arg.indexOf('=');
    if (separator === -1) args[arg.slice(2)] = true;
    else args[arg.slice(2, separator)] = arg.slice(separator + 1);
  });
  return args;
}

function readAudit(args) {
  if (args.file) return JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8').replace(/^\uFEFF/, ''));
  if (!process.stdin.isTTY) {
    const input = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim();
    if (input) return JSON.parse(input);
  }
  throw new Error('Provide an audit with --file=protocol-admin.json or pipe JSON to stdin.');
}

try {
  const result = evaluateProtocolAdminQuality(readAudit(parseArgs()));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.can_approve) process.exitCode = 2;
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'invalid_contract', error: error.message }, null, 2) + '\n');
  process.exitCode = 1;
}
