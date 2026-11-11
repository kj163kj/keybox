import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const build = JSON.parse(readFileSync(join(dist, 'keybox-build.json'), 'utf8'));
if (build.mode !== 'production' || build.apiMode !== 'live') {
  throw new Error('Refusing preview assets as production output.');
}

const forbidden = ['preview-login-fill-btn', 'preview-data-source-toggle', 'preview_admin'];
const envPath = resolve(root, '.env.preview.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^KEYBOX_PREVIEW_(?:USERNAME|PASSWORD)=(.+)$/);
    if (match) forbidden.push(match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
}

function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in production output.');
    if (entry.isDirectory()) { inspect(path); continue; }
    const content = readFileSync(path);
    if (forbidden.some((value) => value && content.includes(Buffer.from(value)))) {
      throw new Error(`Preview credentials or UI found in production output: ${entry.name}`);
    }
  }
}
inspect(dist);
console.log('Production isolation passed: live API only, no preview credentials or controls.');
