import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../vercel-ignore.mjs');
function run(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
function fixture(path) {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  const world = join(dir, 'apps/world');
  mkdirSync(world, { recursive: true });
  copyFileSync(source, join(world, 'vercel-ignore.mjs'));
  run(dir, ['init', '-q']);
  run(dir, ['config', 'user.name', 'Test']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
  run(dir, ['add', '.']);
  run(dir, ['commit', '-qm', 'baseline']);
  const base = run(dir, ['rev-parse', 'HEAD']);
  if (path) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "changed: " + path + "\n");
    run(dir, ['add', '.']);
    run(dir, ['commit', '-qm', 'change']);
  }
  return { dir, world, base };
}
function result(world, previousSha) {
  const env = { ...process.env };
  if (previousSha === null) delete env.VERCEL_GIT_PREVIOUS_SHA;
  else env.VERCEL_GIT_PREVIOUS_SHA = previousSha;
  return spawnSync(process.execPath, ['./vercel-ignore.mjs'], { cwd: world, env, encoding: 'utf8' });
}
const scenarios = [
  ['.github/workflows/pr-metadata-labels.yml', 0],
  ['.github/ci/pr-metadata-labels.test.mjs', 0],
  ['docs/world/notes.md', 0],
  ['README.md', 0],
  ['apps/world/docs/notes.json', 0],
  ['apps/world/tests/graphics.test.mjs', 0],
  ['apps/world/src/main.js', 1],
  ['apps/world/assets/induck-v3.glb', 1],
  ['apps/world/tests/recast-runtime/build-artifact.mjs', 1],
  ['apps/world/tests/recast-runtime/package-lock.json', 1],
  ['tools/world-assets/optimize-world-assets.mjs', 1],
  ['tools/world-assets/package-lock.json', 1],
  ['packages/core/index.js', 1],
  ['supabase/functions/hub/index.ts', 1],
  ['vercel.json', 1],
  ['apps/world/vercel.json', 1],
  ['apps/world/vercel-ignore.sh', 1],
];
for (const [path, expected] of scenarios) {
  test("change: " + path + " => " + (expected === 0 ? "skip" : "build"), () => {
    const f = fixture(path);
    try {
      const r = result(f.world, f.base);
      assert.equal(r.status, expected, r.stderr || r.stdout);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}
for (const [label, sha] of [
  ['unset previous commit', null],
  ['malformed previous commit', 'HEAD^'],
  ['missing previous commit', 'f'.repeat(40)],
]) {
  test(label + " => build", () => {
    const f = fixture();
    try { assert.equal(result(f.world, sha).status, 1); }
    finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}
test('no changes since the previous deployment => skip', () => {
  const f = fixture();
  try { assert.equal(result(f.world, f.base).status, 0); }
  finally { rmSync(f.dir, { recursive: true, force: true }); }
});
