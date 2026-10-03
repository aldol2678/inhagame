// v2.1 regressions: one build/runtime mode policy and marker-owned nested build leftovers.
// All values and requests are synthetic; these tests do not contact external services.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, resolveMode } from '../scripts/build-public-config.mjs';

const require = createRequire(import.meta.url);
const policy = require('../scripts/public-hosts.cjs');
const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = Object.freeze({
  INHAGAME_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'Ab1_'.repeat(8),
  INHAGAME_PUBLIC_HOST_CAMPUS: 'world-v21.vercel.app',
  INHAGAME_PUBLIC_HOST_CLASSIC: 'duck.world-v21.dev',
  INHAGAME_PUBLIC_HOST_INDUCKUP: 'up.world-v21.dev',
  INHAGAME_PUBLIC_HOST_SURVIVAL: 'survive.world-v21.dev',
  INHAGAME_PUBLIC_HOST_GROW: 'grow.world-v21.dev'
});
const CUSTOM = { ...GOOD, INHAGAME_PUBLIC_HOST_CAMPUS: 'world-v21.dev' };
const sandbox = fs.mkdtempSync(path.join(tmpdir(), 'world-deploy-v21-'));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
let next = 0;
function workdir() {
  const dir = path.join(sandbox, `case-${next++}`);
  fs.mkdirSync(dir);
  return dir;
}
function files(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, rel) : [rel];
  });
}
function digest(root) {
  const hash = createHash('sha256');
  for (const rel of files(root)) hash.update(rel + '\0').update(fs.readFileSync(path.join(root, rel)));
  return hash.digest('hex');
}
function callHubEntry(env, origin) {
  const script = `const handler = require(${JSON.stringify(path.join(WORLD, 'api/hub-entry.js'))});
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, end() { return this; }, json() { return this; } };
    Promise.resolve(handler({ method: 'OPTIONS', headers: { origin: ${JSON.stringify(origin)} }, body: '' }, res))
      .then(() => console.log(JSON.stringify({ code: res.code, origin: res.headers['Access-Control-Allow-Origin'] ?? null })));`;
  const result = spawnSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('v2.1 mode: explicit Preview without VERCEL_ENV builds and allows that same OPTIONS origin', () => {
  const env = { ...GOOD, VERCEL: '1', INHAGAME_BUILD_MODE: 'preview' };
  const built = build({ srcRoot: WORLD, outDir: path.join(workdir(), 'dist'), env });
  assert.equal(built.mode, 'preview');
  assert.match(fs.readFileSync(path.join(built.out, 'game-entry.js'), 'utf8'), /world-v21\.vercel\.app/);
  assert.deepEqual(callHubEntry(env, 'https://world-v21.vercel.app'), { code: 204, origin: 'https://world-v21.vercel.app' });
  assert.equal(callHubEntry(env, 'https://other.vercel.app').code, 403);
});

test('v2.1 mode: explicit Production rejects vercel.app hosts even without a hosting signal', () => {
  for (const hosted of [{}, { VERCEL: '1' }, { AWS_LAMBDA_FUNCTION_NAME: 'synthetic' }]) {
    const env = { ...GOOD, ...hosted, INHAGAME_BUILD_MODE: 'production' };
    assert.throws(() => build({ srcRoot: WORLD, outDir: path.join(workdir(), 'dist'), env }), /custom domain in production/);
    assert.equal(callHubEntry(env, 'https://world-v21.vercel.app').code, 403);
  }
});

for (const [name, modeEnv, pattern] of [
  ['explicit Preview conflicts with Production', { INHAGAME_BUILD_MODE: 'preview', VERCEL_ENV: 'production' }, /conflicts/],
  ['explicit Production conflicts with Preview', { INHAGAME_BUILD_MODE: 'production', VERCEL_ENV: 'preview' }, /conflicts/],
  ['unknown explicit mode', { INHAGAME_BUILD_MODE: 'Preview', VERCEL_ENV: 'preview' }, /unknown build mode/],
  ['unknown Vercel environment', { INHAGAME_BUILD_MODE: 'preview', VERCEL_ENV: 'staging' }, /unrecognised VERCEL_ENV/],
  ['local on hosted Vercel', { INHAGAME_BUILD_MODE: 'local', VERCEL: '1' }, /local mode is not allowed/]
]) {
  test(`v2.1 mode: ${name} fails closed in both build and runtime`, () => {
    const env = { ...CUSTOM, ...modeEnv };
    const out = path.join(workdir(), 'dist');
    assert.throws(() => build({ srcRoot: WORLD, outDir: out, env }), pattern);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(policy.runtimeOriginTargets(env), {});
    assert.equal(callHubEntry(env, 'https://world-v21.dev').code, 403);
  });
}

test('v2.1 mode: CLI mode cannot conceal an invalid or conflicting runtime mode variable', () => {
  assert.throws(() => resolveMode({ explicit: 'production', env: { INHAGAME_BUILD_MODE: 'preview' } }), /conflicts with INHAGAME_BUILD_MODE/);
  assert.throws(() => resolveMode({ explicit: 'preview', env: { INHAGAME_BUILD_MODE: 'garbage' } }), /unknown build mode/);
  assert.equal(resolveMode({ explicit: 'preview', env: { INHAGAME_BUILD_MODE: 'preview' } }), 'preview');
});

test('v2.1 mode: hosted runtime with no deployment mode refuses valid custom domains', () => {
  assert.deepEqual(policy.runtimeOriginTargets({ ...CUSTOM, VERCEL: '1' }), {});
  assert.equal(callHubEntry({ ...CUSTOM, VERCEL: '1' }, 'https://world-v21.dev').code, 403);
  assert.equal(callHubEntry({}, 'https://inhagame.example').code, 204, 'unconfigured local fixtures retain their contract');
});

function fixture() {
  const root = path.join(workdir(), 'source');
  fs.cpSync(WORLD, root, { recursive: true, filter: source => !/[\\/](node_modules|dist|\.git|tests)([\\/]|$)/.test(source.slice(WORLD.length)) });
  return root;
}
const buildFixture = (srcRoot, outDir, extra = {}) => build({ srcRoot, outDir, env: CUSTOM, mode: 'production', ...extra });

test('v2.1 staging: nested output cleanup failure preserves the backup and retry never copies it', () => {
  const src = fixture();
  const out = path.join(src, 'build/nested/dist');
  const first = buildFixture(src, out);
  const original = digest(out);
  const logs = [];
  const failure = { ...fs, rmSync(target, ...args) {
    if (String(target).startsWith(path.join(path.dirname(out), '.dist.previous-'))) throw new Error('EPERM: injected cleanup failure');
    return fs.rmSync(target, ...args);
  } };
  const second = buildFixture(src, out, { fs: failure, log: line => logs.push(line) });
  assert.equal(second.tree, first.tree);
  assert.equal(digest(out), original);
  assert.ok(logs.some(line => /could not remove the previous output/.test(line)));
  const backupNames = fs.readdirSync(path.dirname(out)).filter(name => name.startsWith('.dist.previous-'));
  assert.equal(backupNames.length, 1);
  const backup = path.join(path.dirname(out), backupNames[0]);
  assert.equal(digest(backup), original);
  const retry = buildFixture(src, out);
  assert.equal(retry.tree, first.tree, 'retry must not incorporate the retained nested backup');
  assert.equal(digest(out), original);
  assert.equal(digest(backup), original, 'retry does not remove or mutate the only retained backup');
  assert.equal(files(out).some(rel => /\.(?:previous|staging)-/.test(rel)), false);
});

test('v2.1 staging: nested marker-owned staging left after cleanup failure is excluded on retry', () => {
  const src = fixture();
  const out = path.join(src, 'build/nested/dist');
  const first = buildFixture(src, out);
  const original = digest(out);
  const failure = { ...fs,
    copyFileSync(from, to, ...args) { if (String(to).endsWith('/hub.css')) throw new Error('EIO: injected copy failure'); return fs.copyFileSync(from, to, ...args); },
    rmSync(target, ...args) { if (/\.staging-/.test(String(target))) throw new Error('EPERM: injected cleanup failure'); return fs.rmSync(target, ...args); }
  };
  assert.throws(() => buildFixture(src, out, { fs: failure }), /injected copy failure/);
  assert.equal(digest(out), original);
  const leftovers = fs.readdirSync(path.dirname(out)).filter(name => name.startsWith('.dist.staging-'));
  assert.equal(leftovers.length, 1);
  const stale = path.join(path.dirname(out), leftovers[0]);
  const before = digest(stale);
  const retryFs = { ...fs, rmSync(target, ...args) { if (String(target) === stale) throw new Error('EPERM: still busy'); return fs.rmSync(target, ...args); } };
  assert.equal(buildFixture(src, out, { fs: retryFs }).tree, first.tree);
  assert.equal(digest(out), original);
  assert.equal(digest(stale), before, 'failed cleanup must not cause the retained directory to be copied or changed');
});

test('v2.1 staging: nested lookalike user directories without ownership markers remain ordinary source files', () => {
  const src = fixture();
  for (const name of ['.photos.previous-a1b2c3', '.photos.staging-a1b2c3']) {
    const dir = path.join(src, 'assets', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'user.txt'), 'ordinary user content');
  }
  const out = path.join(src, 'build/nested/dist');
  buildFixture(src, out);
  for (const name of ['.photos.previous-a1b2c3', '.photos.staging-a1b2c3']) {
    assert.equal(fs.readFileSync(path.join(out, 'assets', name, 'user.txt'), 'utf8'), 'ordinary user content');
    assert.equal(fs.readFileSync(path.join(src, 'assets', name, 'user.txt'), 'utf8'), 'ordinary user content');
  }
});

test('v2.1 staging: mixed-case stale names with either staging phase marker are never shipped', () => {
  const src = fixture();
  const out = path.join(src, 'build/nested/dist');
  const first = buildFixture(src, out);
  for (const [name, marker] of [
    ['.dist.staging-AbC123', '.inhagame-public-build-staging'],
    ['.old-output.staging-XyZ789', '.inhagame-public-build'],
    ['.old-output.previous-abc123', '.inhagame-public-build']
  ]) {
    const dir = path.join(src, 'retained/deep', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, marker), 'synthetic ownership marker\n');
    fs.writeFileSync(path.join(dir, 'retained.txt'), 'do not publish or delete');
  }
  assert.equal(buildFixture(src, out).tree, first.tree);
  assert.equal(fs.existsSync(path.join(out, 'retained')), false);
  assert.equal(files(path.join(src, 'retained')).length, 6, 'exclusion never deletes the retained files');
});

test('v2.1 staging: a nested symlink marker does not establish ownership of user content', () => {
  const src = fixture();
  const dir = path.join(src, 'assets/.photos.previous-AbC123');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'user.txt'), 'preserve me');
  fs.symlinkSync(path.join(src, 'index.html'), path.join(dir, '.inhagame-public-build'));
  const out = path.join(src, 'build/nested/dist');
  buildFixture(src, out);
  assert.equal(fs.readFileSync(path.join(out, 'assets/.photos.previous-AbC123/user.txt'), 'utf8'), 'preserve me');
});
