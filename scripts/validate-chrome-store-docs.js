// Validates docs/chrome-web-store/ against manifest.json permissions and Chrome Web Store field limits.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'docs', 'chrome-web-store');
const PRIVACY_DIR = join(DOCS_DIR, 'privacy');

const LIMITS = {
  description: 16000,
  singlePurpose: 1000,
  permissionJustification: 1000,
  hostPermissions: 1000,
};

const errors = [];

function checkFile(path, label, limit) {
  if (!existsSync(path)) {
    errors.push(`Missing required file: ${label} (${path})`);
    return;
  }
  const content = readFileSync(path, 'utf8');
  if (content.trim().length === 0) {
    errors.push(`${label} is empty`);
  }
  if (content.length > limit) {
    errors.push(`${label} is ${content.length} characters, exceeds the ${limit}-character limit`);
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
} catch (err) {
  console.error(`Failed to parse manifest.json: ${err.message}`);
  process.exit(1);
}

if (!existsSync(DOCS_DIR)) {
  errors.push(`Missing required directory: ${DOCS_DIR}`);
}
if (!existsSync(PRIVACY_DIR)) {
  errors.push(`Missing required directory: ${PRIVACY_DIR}`);
}

checkFile(join(DOCS_DIR, 'description.md'), 'description.md', LIMITS.description);
checkFile(join(DOCS_DIR, 'single-purpose.md'), 'single-purpose.md', LIMITS.singlePurpose);
checkFile(join(PRIVACY_DIR, 'host-permissions.md'), 'privacy/host-permissions.md', LIMITS.hostPermissions);

const requiredPermissions = manifest.permissions || [];

for (const permission of requiredPermissions) {
  checkFile(
    join(PRIVACY_DIR, `${permission}.md`),
    `privacy/${permission}.md`,
    LIMITS.permissionJustification
  );
}

if (existsSync(PRIVACY_DIR)) {
  const knownFiles = new Set([...requiredPermissions.map((p) => `${p}.md`), 'host-permissions.md']);
  for (const entry of readdirSync(PRIVACY_DIR)) {
    if (entry.endsWith('.md') && !knownFiles.has(entry)) {
      errors.push(
        `Obsolete permission file privacy/${entry} does not correspond to any permission in manifest.json`
      );
    }
  }
}

if (errors.length > 0) {
  console.error('Chrome Web Store documentation validation failed:\n');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log('Chrome Web Store documentation is valid.');
