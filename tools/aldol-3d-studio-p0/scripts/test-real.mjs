import { accessSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.env.INHA_WORLD_EDITOR_DIR;
if (!dir) {
  console.error('BLOCKED: INHA_WORLD_EDITOR_DIR missing');
  process.exit(2);
}
const root = resolve(dir);
for (const name of [
  'world-document.js', 'editor-commands.js', 'editor-state.js',
  'world-schema.js', 'world-serialization.js', 'editor-persistence.js',
  'building-mass.js', 'path-spline.js', 'map-reference.js'
]) {
  try { accessSync(join(root, name), constants.R_OK); }
  catch { console.error('BLOCKED: missing source: ' + name); process.exit(2); }
}
const report = spawnSync(process.execPath, ['--test', 'tests/legacy-integration.test.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, INHA_WORLD_EDITOR_DIR: root },
  encoding: 'utf8'
});
process.stdout.write(report.stdout || '');
process.stderr.write(report.stderr || '');
if (report.status !== 0) process.exit(report.status || 1);
const passed = Number(/# pass (\d+)/.exec(report.stdout || '')?.[1] || 0);
const skipped = Number(/# skipped (\d+)/.exec(report.stdout || '')?.[1] || 0);
if (passed !== 8 || skipped !== 2) {
  console.error('BLOCKED: expected 8 pass and 2 explicit skips, got ' + passed + ' pass, ' + skipped + ' skips');
  process.exit(1);
}
console.log('REAL SOURCE INTEGRATION GATE: 8/8 PASS');
