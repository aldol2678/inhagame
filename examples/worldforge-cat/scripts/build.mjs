import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(here, '..');
const schema = path.resolve(example, '../../packages/worldforge-schema');
const outDir = path.join(example, 'dist');
execFileSync('npm', ['run', 'build', '--prefix', schema], { stdio: 'inherit' });
await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(example, 'src/main.js')],
  outfile: path.join(outDir, 'app.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  minify: false,
  nodePaths: [path.join(example, 'node_modules')],
  logLevel: 'info'
});
await copyFile(path.join(example, 'index.html'), path.join(outDir, 'index.html'));
const outputs = {};
for (const name of ['index.html', 'app.js']) {
  const bytes = await readFile(path.join(outDir, name));
  outputs[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(path.join(outDir, 'build-manifest.json'), JSON.stringify({
  schemaVersion: 'worldforge-engine/build/0.1',
  projectId: 'worldforge-cat',
  entry: 'index.html',
  files: outputs
}, null, 2) + '\n');
console.log('WorldForge Cat standalone static build complete:', outDir);
