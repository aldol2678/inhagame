import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const dist = path.resolve('dist');
const manifest = JSON.parse(await readFile(path.join(dist, 'build-manifest.json'), 'utf8'));
for (const [name, detail] of Object.entries(manifest.files)) {
  if (!(await stat(path.join(dist, name))).isFile()) throw new Error(`E_BUILD_FILE_MISSING:${name}`);
  const data = await readFile(path.join(dist, name));
  if (createHash('sha256').update(data).digest('hex') !== detail.sha256) throw new Error(`E_BUILD_HASH_MISMATCH:${name}`);
}
const bundle = await readFile(path.join(dist, 'app.js'), 'utf8');
if (/apps\/world\/src\/|from\s*["']https?:\/\/|import\s*\(["']https?:\/\//.test(bundle)) throw new Error('E_BUILD_FORBIDDEN_IMPORT');
console.log('Static build integrity OK');
