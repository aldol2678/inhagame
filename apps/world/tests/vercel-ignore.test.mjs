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
    for (const changedPath of Array.isArray(path) ? path : [path]) {
      const target = join(dir, changedPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "changed: " + changedPath + "\n");
    }
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
  ['apps/induck-grow/package.json', 0],
  ['apps/induck-grow/v2/life-engine.mjs', 0],
  ['apps/induck-grow/v2/tests/life-engine.test.mjs', 0],
  [['apps/induck-grow/v2/session.mjs', 'docs/world/notes.md'], 0],
  [['apps/induck-grow/v2/session.mjs', 'apps/world/src/main.js'], 1],
  [['apps/induck-grow/package.json', 'tools/world-assets/package-lock.json'], 1],
  [['apps/induck-grow/package.json', 'apps/world/tests/recast-runtime/build-artifact.mjs'], 1],
  [['apps/induck-grow/package.json', 'apps/world/data/game-catalog.json'], 1],
  ['apps/induck-grow-extra/index.html', 1],
  ['apps/induck-grow', 1],
  ['apps/classic/index.html', 1],
  ['scripts/public-ci.sh', 1],
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
    const f = fixture('apps/induck-grow/v2/session.mjs');
    try { assert.equal(result(f.world, sha).status, 1); }
    finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}
test('no changes since the previous deployment => skip', () => {
  const f = fixture();
  try { assert.equal(result(f.world, f.base).status, 0); }
  finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('deleting a grow-only source file => skip', () => {
  const f = fixture('apps/induck-grow/v2/obsolete.mjs');
  try {
    const base = run(f.dir, ['rev-parse', 'HEAD']);
    run(f.dir, ['rm', 'apps/induck-grow/v2/obsolete.mjs']);
    run(f.dir, ['commit', '-qm', 'delete grow source']);
    assert.equal(result(f.world, base).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

for (const [from, to, expected] of [
  ['apps/induck-grow/v2/before.mjs', 'apps/induck-grow/v2/after.mjs', 0],
  ['apps/induck-grow/v2/source.mjs', 'apps/world/src/source.mjs', 1],
  ['apps/world/src/source.mjs', 'apps/induck-grow/v2/source.mjs', 1],
]) {
  test('rename ' + from + ' to ' + to + ' => ' + (expected === 0 ? 'skip' : 'build'), () => {
    const f = fixture(from);
    try {
      const base = run(f.dir, ['rev-parse', 'HEAD']);
      mkdirSync(dirname(join(f.dir, to)), { recursive: true });
      run(f.dir, ['mv', from, to]);
      run(f.dir, ['commit', '-qm', 'move source']);
      assert.equal(result(f.world, base).status, expected);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}
