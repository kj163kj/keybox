import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.env.preview.local');
// Refuse to create local credentials if they could accidentally be staged.
execFileSync('git', ['check-ignore', '-q', '--no-index', '.env.preview.local'], { cwd: root });
try {
  execFileSync('git', ['ls-files', '--error-unmatch', '.env.preview.local'], { cwd: root, stdio: 'ignore' });
  throw new Error('Preview credentials must not be tracked by Git.');
} catch (error) {
  if (error.status !== 1) throw error;
}
if (!existsSync(path)) {
  writeFileSync(path,
    `# Local mock preview only. Never use these credentials for the backend.\n` +
    `KEYBOX_PREVIEW_USERNAME=preview_admin\n` +
    `KEYBOX_PREVIEW_PASSWORD=KbxPreview!${randomBytes(18).toString('base64url')}\n`,
    { flag: 'wx', mode: 0o600 });
}
const source = readFileSync(path, 'utf8');
const username = source.match(/^KEYBOX_PREVIEW_USERNAME=(.+)$/m)?.[1].trim();
const password = source.match(/^KEYBOX_PREVIEW_PASSWORD=(.+)$/m)?.[1].trim();
if (!username || !password) throw new Error('Invalid local preview configuration.');
console.log('Local mock preview credentials (not a backend administrator):');
console.log(`Username: ${username}`);
console.log(`Password: ${password}`);
