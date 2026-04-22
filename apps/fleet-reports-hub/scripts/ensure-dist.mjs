/**
 * If dist/ is missing (e.g. host only ran `npm start`), run `npm run build` once.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(root, 'dist', 'index.html');

if (fs.existsSync(distIndex)) {
  process.exit(0);
}

console.log('[prestart] dist/ missing — running npm run build…');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
