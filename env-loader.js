// env-loader.js
// Shared .env loader + Chrome executable resolver.
// Extracted so compile_order.js, dossier_generator.js, generate_48_pdfs.js and
// delivery_server.js all use one implementation instead of copy-pasted logic.

const fs = require('fs');
const path = require('path');

/**
 * Loads key=value pairs from a .env file at `envPath` (defaults to <repo root>/.env)
 * into process.env, without overwriting variables that are already set.
 * Silently does nothing if the file doesn't exist.
 */
function loadEnvFile(envPath) {
  const resolvedPath = envPath || path.join(__dirname, '.env');
  if (!fs.existsSync(resolvedPath)) return;

  const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Resolves a usable Chrome/Chromium executable path for Puppeteer's `executablePath` option.
 * Checks CHROME_PATH env var first, then common Windows install locations.
 * Returns undefined if none of the candidates exist on disk (caller should handle that
 * by throwing a clear error rather than letting Puppeteer fail with a cryptic spawn error).
 */
function getChromeExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate));
}

module.exports = { loadEnvFile, getChromeExecutablePath };
