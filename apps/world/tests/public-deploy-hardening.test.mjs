// Review follow-ups for the deployment wiring (v2): Git branch rules, explicit build mode, fail-closed runtime
// hosts, staged/atomic output, and the Preview NPC policy. Everything uses synthetic values in temporary
// directories and mocked transports; nothing talks to a network, Vercel, Supabase or Cloud Run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { branchDeploys, globMatches } from './support/vercel-branch-rules.mjs';

const require = createRequire(import.meta.url);
const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(WORLD, 'scripts/build-public-config.mjs');
const policy = require(path.join(WORLD, 'scripts/public-hosts.cjs'));
const { build, resolveMode } = await import(GENERATOR);
const { probeFeatureFlag, FLAG_ENABLED, FLAG_DISABLED, FLAG_UNAVAILABLE } = await import(pathToFileURL(path.join(WORLD, 'src/npc-feature-flags.js')).href);

const KEY = 'sb_publishable_' + 'Ab1_'.repeat(8);
const GOOD = Object.freeze({
  INHAGAME_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
  INHAGAME_PUBLIC_HOST_CAMPUS: 'world-test.dev',
  INHAGAME_PUBLIC_HOST_CLASSIC: 'duck.world-test.dev',
  INHAGAME_PUBLIC_HOST_INDUCKUP: 'up.world-test.dev',
  INHAGAME_PUBLIC_HOST_SURVIVAL: 'survive.world-test.dev',
  INHAGAME_PUBLIC_HOST_GROW: 'grow.world-test.dev'
});
const PREVIEW_HOSTS = Object.freeze({ ...GOOD, INHAGAME_PUBLIC_HOST_CAMPUS: 'world-preview-test.vercel.app' });
const cleanEnv = extra => ({ PATH: process.env.PATH, ...extra });

const sandbox = nodeFs.mkdtempSync(path.join(tmpdir(), 'world-hardening-'));
test.after(() => nodeFs.rmSync(sandbox, { recursive: true, force: true }));
let counter = 0;
const workdir = () => { const dir = path.join(sandbox, `case-${counter++}`); nodeFs.mkdirSync(dir); return dir; };
const listing = dir => nodeFs.readdirSync(dir).sort();
function treeHash(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of nodeFs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next); else hash.update(next + '\0').update(nodeFs.readFileSync(path.join(dir, next)));
    }
  };
  walk('');
  return hash.digest('hex');
}
const cli = (env, args = []) => spawnSync(process.execPath, [GENERATOR, ...args], { env: cleanEnv(env), encoding: 'utf8' });

// ---------------------------------------------------------------------------------------------------------
// 1. Git branch rules: everything blocked by default, only preview/** allowed
// ---------------------------------------------------------------------------------------------------------
const vercel = JSON.parse(nodeFs.readFileSync(path.join(WORLD, 'vercel.json'), 'utf8'));
const RULES = vercel.git.deploymentEnabled;
const V1_RULES = { main: false, integrate: false, 'preview/**': true, 'feat/**': false, 'fix/**': false, 'chore/**': false,
  'test/**': false, 'docs/**': false, 'refactor/**': false, 'ci/**': false, 'perf/**': false, 'style/**': false, 'catchup/**': false };

test('branch rules: the rule set is exactly "** disabled, preview/** enabled"', () => {
  assert.deepEqual(RULES, { '**': false, 'preview/**': true });
  assert.notEqual(RULES, false, 'a bare false would also disable preview/**');
});

test('branch rules: required branches are evaluated by real matching, not by counting true entries', () => {
  const expected = {
    main: false, 'preview/test': true, 'preview/team/test': true, 'catchup/test': false, 'release/test': false,
    'hotfix/test': false, 'codex/test': false, 'zz-new-prefix/anything': false, 'a/b/c/d': false,
    feature: false, hotfix: false, preview: false, 'previewx/test': false, 'xpreview/test': false,
    'a/preview/test': false, 'Preview/test': false, 'preview-1': false, 'feat/preview/x': false
  };
  for (const [branch, deploys] of Object.entries(expected)) assert.equal(branchDeploys(RULES, branch), deploys, branch);
});

test('branch rules: a branch matched by several patterns deploys if any matching rule is true', () => {
  assert.deepEqual(['**', 'preview/**'].map(pattern => globMatches(pattern, 'preview/test')), [true, true]);
  assert.equal(branchDeploys(RULES, 'preview/test'), true, '** says false, preview/** says true');
  assert.equal(branchDeploys({ 'preview/**': true, '**': false }, 'preview/test'), true, 'key order does not matter');
  assert.equal(branchDeploys({ 'experiment-*': false, '*-dev': true }, 'experiment-dev'), true, 'example from the Vercel docs');
  assert.equal(branchDeploys({ 'experiment-*': false, '*-dev': true }, 'experiment-x'), false);
});

test('branch rules: unspecified branches default to true, so the catch-all must cover every name', () => {
  assert.equal(branchDeploys({ dev: false }, 'main'), true, 'documented default');
  assert.equal(branchDeploys({ main: false, 'preview/**': true }, 'release/test'), true, 'a partial list leaves other branches enabled');
  const names = [];
  for (const prefix of ['', 'a', 'release', 'hotfix', 'codex', 'dependabot', 'user-x', 'ZZ', 'v1.2', 'x-y', 'preview', 'previews', 'preview-x']) {
    for (const rest of ['', 'x', 'x/y', 'x/y/z', 'a-b_c.d', 'feature/deep/branch/name']) names.push([prefix, rest].filter(Boolean).join('/') || 'main');
  }
  for (const branch of new Set(names)) {
    const matching = Object.keys(RULES).filter(pattern => globMatches(pattern, branch));
    assert.ok(matching.length >= 1, `${branch} is covered by an explicit rule (no reliance on the default)`);
    assert.equal(branchDeploys(RULES, branch), branch.startsWith('preview/') && branch.length > 'preview/'.length, branch);
  }
});

test('branch rules: the v1 rule set (main + prefix list) is rejected by the same checks', () => {
  assert.equal(branchDeploys(V1_RULES, 'release/test'), true, 'v1 let release/* deploy');
  assert.equal(branchDeploys(V1_RULES, 'codex/test'), true, 'v1 let codex/* deploy');
  assert.equal(branchDeploys(V1_RULES, 'hotfix'), true, 'v1 let slash-less names deploy');
  assert.notEqual(branchDeploys(V1_RULES, 'release/test'), branchDeploys(RULES, 'release/test'));
});

test('branch rules: only the git deployment rule is claimed, the Production Branch stays an open item', () => {
  // vercel.json cannot name the project's Production Branch; it is a dashboard setting that is not confirmed.
  assert.equal('productionBranch' in vercel, false);
  assert.equal(branchDeploys(RULES, 'main'), false, 'main is not auto-deployed by this rule set');
  // Manual deployments (CLI / deploy hooks / redeploy) are not governed by git.deploymentEnabled.
  assert.deepEqual(Object.keys(vercel.git), ['deploymentEnabled']);
});

// ---------------------------------------------------------------------------------------------------------
// 2. Build mode is never guessed
// ---------------------------------------------------------------------------------------------------------
function expectBuildFailure(env, args, pattern) {
  const dir = workdir();
  const out = path.join(dir, 'dist');
  const run = cli(env, ['--out', out, ...args]);
  assert.notEqual(run.status, 0, `expected failure, got ${run.stdout}`);
  assert.match(run.stderr, pattern);
  assert.equal(nodeFs.existsSync(out), false, 'no output on failure');
  assert.deepEqual(listing(dir), [], 'no staging directory is left behind');
  assert.equal(run.stdout.includes(KEY) || run.stderr.includes(KEY), false);
}

test('mode: no mode variable at all fails (no silent local build)', () => {
  expectBuildFailure({ ...GOOD }, [], /cannot tell whether this is a preview or production build/);
  expectBuildFailure({}, [], /INHAGAME_BUILD_MODE/);
});

test('mode: VERCEL=1 alone is not enough, and the message says VERCEL_ENV is unavailable', () => {
  expectBuildFailure({ ...GOOD, VERCEL: '1' }, [], /VERCEL_ENV is not available to this build/);
});

test('mode: VERCEL_ENV=development alone does not select local', () => {
  expectBuildFailure({ VERCEL_ENV: 'development' }, [], /VERCEL_ENV=development does not select a deploy mode/);
});

test('mode: local must be explicit and is refused on Vercel', () => {
  const dir = workdir();
  const out = path.join(dir, 'dist');
  const ok = cli({ INHAGAME_BUILD_MODE: 'local' }, ['--out', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(nodeFs.readFileSync(path.join(out, '.inhagame-public-build'), 'utf8'), /^mode=local\n/);
  assert.match(nodeFs.readFileSync(path.join(out, 'supabase-public-config.js'), 'utf8'), /sb_publishable_PUBLIC_PLACEHOLDER/);
  expectBuildFailure({ VERCEL: '1' }, ['--mode', 'local'], /local mode is not allowed on Vercel/);
  expectBuildFailure({ INHAGAME_BUILD_MODE: 'local', VERCEL: '1' }, [], /local mode is not allowed on Vercel/);
  expectBuildFailure({ VERCEL_ENV: 'production' }, ['--mode', 'local'], /conflicts with VERCEL_ENV=production|not allowed on Vercel/);
  expectBuildFailure({ VERCEL_ENV: 'preview' }, ['--mode', 'local'], /not allowed on Vercel/);
  const dev = cli({ VERCEL_ENV: 'development' }, ['--mode', 'local', '--out', path.join(workdir(), 'dist')]);
  assert.equal(dev.status, 0, 'an explicit local build is fine for `vercel dev`/`vercel build` development');
});

test('mode: valid preview and production builds, via INHAGAME_BUILD_MODE or VERCEL_ENV', () => {
  const marker = out => nodeFs.readFileSync(path.join(out, '.inhagame-public-build'), 'utf8').split('\n')[0];
  const run = (env, args = []) => { const out = path.join(workdir(), 'dist'); const result = cli(env, ['--out', out, ...args]); assert.equal(result.status, 0, result.stderr); return marker(out); };
  assert.equal(run({ ...GOOD, INHAGAME_BUILD_MODE: 'production' }), 'mode=production');
  assert.equal(run({ ...PREVIEW_HOSTS, INHAGAME_BUILD_MODE: 'preview' }), 'mode=preview');
  assert.equal(run({ ...GOOD, VERCEL_ENV: 'production' }), 'mode=production');
  assert.equal(run({ ...PREVIEW_HOSTS, VERCEL_ENV: 'preview' }), 'mode=preview');
  assert.equal(run({ ...GOOD, VERCEL: '1', INHAGAME_BUILD_MODE: 'production' }), 'mode=production', 'VERCEL_ENV not exposed, explicit mode given');
  assert.equal(run({ ...GOOD, INHAGAME_BUILD_MODE: 'production', VERCEL_ENV: 'production' }), 'mode=production');
});

test('mode: invalid values, unknown VERCEL_ENV and conflicts fail', () => {
  expectBuildFailure({ ...GOOD, INHAGAME_BUILD_MODE: 'Production' }, [], /unknown build mode/);
  expectBuildFailure({ ...GOOD }, ['--mode', 'staging'], /unknown build mode/);
  expectBuildFailure({ ...GOOD, VERCEL_ENV: 'staging' }, ['--mode', 'production'], /unrecognised VERCEL_ENV/);
  expectBuildFailure({ ...GOOD, VERCEL_ENV: 'production' }, ['--mode', 'preview'], /conflicts with VERCEL_ENV=production/);
  expectBuildFailure({ ...PREVIEW_HOSTS, VERCEL_ENV: 'preview' }, ['--mode', 'production'], /conflicts with VERCEL_ENV=preview/);
  expectBuildFailure({ ...GOOD, VERCEL_ENV: 'development' }, ['--mode', 'production'], /conflicts with VERCEL_ENV=development/);
  expectBuildFailure({ ...GOOD, INHAGAME_BUILD_MODE: 'preview', VERCEL_ENV: 'production' }, [], /conflicts/);
});

test('mode: resolveMode treats empty variables as unset', () => {
  assert.throws(() => resolveMode({ env: { INHAGAME_BUILD_MODE: '', VERCEL_ENV: '' } }), /cannot tell/);
  assert.equal(resolveMode({ env: { INHAGAME_BUILD_MODE: 'local' } }), 'local');
  assert.equal(resolveMode({ explicit: 'preview', env: {} }), 'preview');
  assert.equal(resolveMode({ env: { VERCEL_ENV: 'production' } }), 'production');
});

// ---------------------------------------------------------------------------------------------------------
// 3. The runtime decision matches the build (api/hub-entry)
// ---------------------------------------------------------------------------------------------------------
function callHubEntry(env, origin) {
  const script = `
    const handler = require(${JSON.stringify(path.join(WORLD, 'api/hub-entry.js'))});
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, end() { return this; }, json() { return this; } };
    Promise.resolve(handler({ method: 'OPTIONS', headers: ${JSON.stringify(origin ? { origin } : {})}, body: '' }, res)).then(() => console.log(JSON.stringify(res.code)));`;
  const run = spawnSync(process.execPath, ['-e', script], { env: cleanEnv(env), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const TEMPLATE_ORIGINS = ['https://inhagame.example', 'https://duck.inhagame.example', 'https://evil.example.org'];

test('runtime: any hosted signal without a valid host set fails closed, even for the template origins', () => {
  for (const hosted of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' },
    { VERCEL_URL: 'x.vercel.app' }, { VERCEL_REGION: 'iad1' }, { AWS_LAMBDA_FUNCTION_NAME: 'fn' }, { LAMBDA_TASK_ROOT: '/var/task' }, { AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x' }]) {
    for (const origin of TEMPLATE_ORIGINS) assert.equal(callHubEntry(hosted, origin), 403, `${JSON.stringify(hosted)} ${origin}`);
  }
  const partial = { ...GOOD, VERCEL: '1' }; delete partial.INHAGAME_PUBLIC_HOST_GROW;
  assert.equal(callHubEntry(partial, 'https://world-test.dev'), 403);
});

test('runtime: the template fallback exists only outside a hosted runtime (local node, tests)', () => {
  assert.equal(callHubEntry({}, 'https://inhagame.example'), 204);
  assert.equal(callHubEntry({ INHAGAME_BUILD_MODE: 'local' }, 'https://duck.inhagame.example'), 204);
  assert.equal(callHubEntry({}, 'https://evil.example.org'), 403);
  assert.deepEqual(Object.keys(policy.runtimeOriginTargets({})).sort(),
    Object.values(policy.templateHosts()).map(host => `https://${host}`).sort());
});

test('runtime: build mode and runtime policy agree for the same environment', () => {
  const cases = [
    { name: 'production, valid custom domains', env: GOOD, vercelEnv: 'production', buildOk: true },
    { name: 'preview, valid custom domains', env: GOOD, vercelEnv: 'preview', buildOk: true },
    { name: 'preview, vercel.app campus host', env: PREVIEW_HOSTS, vercelEnv: 'preview', buildOk: true },
    { name: 'production, vercel.app campus host', env: PREVIEW_HOSTS, vercelEnv: 'production', buildOk: false },
    { name: 'VERCEL_ENV unavailable, vercel.app host (treated as production)', env: PREVIEW_HOSTS, vercelEnv: undefined, buildOk: false }
  ];
  for (const { name, env, vercelEnv, buildOk } of cases) {
    const runtimeEnv = { ...env, VERCEL: '1', ...(vercelEnv ? { VERCEL_ENV: vercelEnv } : {}) };
    const targets = policy.runtimeOriginTargets(runtimeEnv);
    if (buildOk) {
      assert.deepEqual(Object.keys(targets).sort(), Object.keys(policy.originTargets(policy.validateHosts(policy.readHostInput(env), { mode: vercelEnv }))).sort(), name);
    } else {
      assert.deepEqual(targets, {}, `${name}: the runtime refuses what the build refuses`);
      const mode = vercelEnv ?? 'production';
      const result = cli({ ...env, VERCEL: '1', ...(vercelEnv ? { VERCEL_ENV: vercelEnv } : {}), INHAGAME_BUILD_MODE: mode }, ['--out', path.join(workdir(), 'dist')]);
      assert.notEqual(result.status, 0, name);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------
// 4. Staged output: failures never damage the previous output, and a retry works
// ---------------------------------------------------------------------------------------------------------
const FIXTURE = path.join(sandbox, 'fixture-src');
nodeFs.cpSync(WORLD, FIXTURE, { recursive: true, filter: source => !/[\\/](node_modules|dist|\.git|tests)([\\/]|$)/.test(source.slice(WORLD.length)) });
const REAL_FS = Object.freeze(Object.fromEntries(['chmodSync', 'copyFileSync', 'lstatSync', 'mkdirSync', 'mkdtempSync', 'readdirSync',
  'readFileSync', 'realpathSync', 'renameSync', 'rmSync', 'writeFileSync'].map(name => [name, nodeFs[name]])));
const buildFixture = (outDir, extra = {}) => build({ srcRoot: FIXTURE, outDir, env: GOOD, mode: 'production', ...extra });
const MARKER = '.inhagame-public-build';

// Mutations are applied to the fixture only and always undone, so tests stay independent.
function withMutation(file, transform, run) {
  const target = path.join(FIXTURE, file);
  const original = nodeFs.readFileSync(target, 'utf8');
  nodeFs.writeFileSync(target, transform(original));
  try { return run(); } finally { nodeFs.writeFileSync(target, original); }
}
const EXTRA_TEMPLATE_HOST = text => text + '\n// https://duck.inhagame.example/\n';

function assertPreserved(out, parent, hash, parentListing, message = '') {
  assert.equal(treeHash(out), hash, `the previous output is unchanged ${message}`);
  assert.ok(nodeFs.existsSync(path.join(out, MARKER)), 'marker kept');
  assert.deepEqual(listing(parent), parentListing, `no staging or backup directory is left behind ${message}`);
}

test('staging: a late host-count mismatch keeps the previous dist byte-identical, and a retry succeeds', () => {
  const parent = workdir();
  const out = path.join(parent, 'dist');
  const first = buildFixture(out);
  const hash = treeHash(out);
  const before = listing(parent);
  let copies = 0;
  const counting = { ...REAL_FS, copyFileSync: (...args) => { copies++; return REAL_FS.copyFileSync(...args); } };
  withMutation('src/main.js', EXTRA_TEMPLATE_HOST, () => {
    assert.throws(() => buildFixture(out, { fs: counting }), /src\/main\.js: host references changed/);
  });
  assert.ok(copies > 100, `the failure came late (${copies} files copied before it)`);
  assertPreserved(out, parent, hash, before);
  const retry = buildFixture(out);
  assert.equal(retry.tree, first.tree, 'the retry reproduces the original output');
  assert.equal(treeHash(out), hash);
  assert.deepEqual(listing(parent), before);
});

test('staging: a failure on the very first run leaves no partial output at all', () => {
  const parent = workdir();
  const out = path.join(parent, 'dist');
  withMutation('src/main.js', EXTRA_TEMPLATE_HOST, () => assert.throws(() => buildFixture(out), /host references changed/));
  assert.equal(nodeFs.existsSync(out), false);
  assert.deepEqual(listing(parent), [], 'no staging directory either');
  assert.equal(buildFixture(out).files > 100, true, 'the next run is not blocked by the failed one');
  assert.ok(nodeFs.existsSync(path.join(out, MARKER)));
});

for (const [name, override, pattern] of [
  ['a copy failure', copies => ({ copyFileSync: (...args) => { if (++copies.n === 50) throw new Error('EIO: injected copy failure'); return REAL_FS.copyFileSync(...args); } }), /injected copy failure/],
  ['a write failure on a generated file', () => ({ writeFileSync: (file, ...rest) => { if (String(file).endsWith('src/config/supabase-public-config.js')) throw new Error('ENOSPC: injected write failure'); return REAL_FS.writeFileSync(file, ...rest); } }), /injected write failure/],
  ['a silently skipped copy (verification)', copies => ({ copyFileSync: (...args) => { if (++copies.n === 80) return undefined; return REAL_FS.copyFileSync(...args); } }), /verification failed: the staged file set/],
  ['a truncated generated file (verification)', () => ({ writeFileSync: (file, content, ...rest) => REAL_FS.writeFileSync(file, String(file).endsWith('/hub-account.js') ? String(content).slice(0, -5) : content, ...rest) }), /verification failed: staged content differs/]
]) {
  test(`staging: ${name} keeps the previous output and cleans up`, () => {
    const parent = workdir();
    const out = path.join(parent, 'dist');
    buildFixture(out);
    const hash = treeHash(out);
    const before = listing(parent);
    assert.throws(() => buildFixture(out, { fs: { ...REAL_FS, ...override({ n: 0 }) } }), pattern);
    assertPreserved(out, parent, hash, before, name);
    const fresh = path.join(workdir(), 'dist');
    assert.throws(() => buildFixture(fresh, { fs: { ...REAL_FS, ...override({ n: 0 }) } }), pattern);
    assert.equal(nodeFs.existsSync(fresh), false, `${name}: no partial final output on a first run`);
    assert.deepEqual(listing(path.dirname(fresh)), []);
    buildFixture(out);
    assert.equal(treeHash(out), hash, 'retry after the cause is gone');
  });
}

test('staging: when the swap fails the previous output is restored; when restore fails too it is preserved', () => {
  const parent = workdir();
  const out = path.join(parent, 'dist');
  buildFixture(out);
  const hash = treeHash(out);
  const before = listing(parent);
  // (a) moving the new build into place fails once -> the old output is moved back
  let swapFailures = 0;
  const failSwap = { ...REAL_FS, renameSync: (from, to) => { if (to === out && /\.staging-/.test(from) && swapFailures++ === 0) throw new Error('EXDEV: injected swap failure'); return REAL_FS.renameSync(from, to); } };
  assert.throws(() => buildFixture(out, { fs: failSwap }), /injected swap failure.*previous output was restored/);
  assertPreserved(out, parent, hash, before, '(restored)');
  // (b) the first rename (old output aside) fails -> nothing changed
  const failAside = { ...REAL_FS, renameSync: (from, to) => { if (from === out) throw new Error('EBUSY: injected rename failure'); return REAL_FS.renameSync(from, to); } };
  assert.throws(() => buildFixture(out, { fs: failAside }), /injected rename failure/);
  assertPreserved(out, parent, hash, before, '(aside failed)');
  // (c) the swap fails and the restore fails -> the backup is kept and named in the error
  const failBoth = { ...REAL_FS, renameSync: (from, to) => { if (to === out) throw new Error('EIO: injected swap+restore failure'); return REAL_FS.renameSync(from, to); } };
  let message = '';
  try { buildFixture(out, { fs: failBoth }); } catch (error) { message = error.message; }
  const backup = (message.match(/preserved at (\S+)/) ?? [])[1];
  assert.ok(backup && /\.dist\.previous-[0-9a-f]+$/.test(backup), `the error names the preserved backup: ${message}`);
  assert.equal(treeHash(backup), hash, 'the backup holds the previous output untouched');
  assert.equal(listing(parent).filter(name => name.includes('.staging-')).length, 0, 'staging is cleaned up');
  nodeFs.rmSync(out, { recursive: true, force: true });
  REAL_FS.renameSync(backup, out); // an operator would do this
  assert.equal(treeHash(out), hash);
  assert.deepEqual(listing(parent), before);
});

test('staging: a backup that cannot be removed does not fail the build and is never deleted automatically', () => {
  const parent = workdir();
  const out = path.join(parent, 'dist');
  buildFixture(out);
  const logs = [];
  const stuck = { ...REAL_FS, rmSync: (target, ...rest) => { if (/\.previous-/.test(String(target))) throw new Error('EPERM: injected'); return REAL_FS.rmSync(target, ...rest); } };
  const result = buildFixture(out, { fs: stuck, log: line => logs.push(line) });
  assert.ok(logs.some(line => /warning: could not remove the previous output/.test(line)));
  assert.ok(result.tree);
  const leftovers = listing(parent).filter(name => name.includes('.previous-'));
  assert.equal(leftovers.length, 1);
  buildFixture(out);
  assert.deepEqual(listing(parent).filter(name => name.includes('.previous-')), leftovers, 'a later run leaves the backup alone');
});

test('staging: directories the generator did not create are never deleted or replaced', () => {
  // non-empty directory without the marker
  const dir = workdir();
  const userDir = path.join(dir, 'dist');
  nodeFs.mkdirSync(userDir);
  nodeFs.writeFileSync(path.join(userDir, 'precious.txt'), 'keep me');
  const hash = treeHash(userDir);
  assert.throws(() => buildFixture(userDir), /not a previous build output/);
  assert.equal(treeHash(userDir), hash);
  assert.deepEqual(listing(dir), ['dist'], 'no staging was created for a refused target');
  // a marker that is a directory/symlink does not count
  const fake = path.join(workdir(), 'dist');
  nodeFs.mkdirSync(path.join(fake, MARKER), { recursive: true });
  assert.throws(() => buildFixture(fake), /not a previous build output/);
  // output path is a regular file
  const file = path.join(workdir(), 'dist');
  nodeFs.writeFileSync(file, 'x');
  assert.throws(() => buildFixture(file), /not a directory/);
  assert.equal(nodeFs.readFileSync(file, 'utf8'), 'x');
  // an empty directory may be replaced
  const empty = path.join(workdir(), 'dist');
  nodeFs.mkdirSync(empty);
  assert.ok(buildFixture(empty).files > 100);
});

test('staging: symlinks, path normalisation and source protection', () => {
  // the output itself is a symlink to a user directory
  const dir = workdir();
  const target = path.join(dir, 'user-data');
  nodeFs.mkdirSync(target);
  nodeFs.writeFileSync(path.join(target, 'precious.txt'), 'keep me');
  const link = path.join(dir, 'dist');
  nodeFs.symlinkSync(target, link, 'dir');
  assert.throws(() => buildFixture(link), /symbolic link/);
  assert.deepEqual(listing(target), ['precious.txt']);
  // the output is the source, a parent of the source, or reaches the source through `..` or a symlink
  assert.throws(() => buildFixture(FIXTURE), /source tree/);
  assert.throws(() => buildFixture(path.dirname(FIXTURE)), /source tree/);
  assert.throws(() => buildFixture(path.join(FIXTURE, 'src', '..')), /source tree/);
  const srcLink = path.join(workdir(), 'link-to-src');
  nodeFs.symlinkSync(FIXTURE, srcLink, 'dir');
  assert.throws(() => buildFixture(srcLink), /symbolic link|source tree/);
  assert.throws(() => buildFixture(path.parse(FIXTURE).root), /own|source tree/);
  assert.ok(nodeFs.existsSync(path.join(FIXTURE, 'index.html')), 'the source is intact');
  // a symlinked parent directory is resolved: the build lands in the real parent and leaves nothing behind
  const realParent = workdir();
  const linkedParent = path.join(workdir(), 'via-link');
  nodeFs.symlinkSync(realParent, linkedParent, 'dir');
  const result = buildFixture(path.join(linkedParent, 'dist'));
  assert.equal(result.out, path.join(nodeFs.realpathSync(realParent), 'dist'));
  assert.deepEqual(listing(realParent), ['dist']);
});

test('staging: an output inside the source does not copy its own staging directory, and rebuilds are stable', () => {
  const inside = path.join(FIXTURE, 'dist');
  try {
    const first = buildFixture(inside);
    const second = buildFixture(inside);
    assert.equal(second.tree, first.tree, 'the previous output is not part of the next build');
    assert.deepEqual(listing(FIXTURE).filter(name => name.startsWith('.dist.')), [], 'no staging directory remains in the source');
    assert.equal(nodeFs.existsSync(path.join(inside, 'dist')), false);
    // a leftover staging directory of an interrupted run sits in the source: it is never shipped
    nodeFs.mkdirSync(path.join(FIXTURE, '.dist.staging-deadbeef'));
    nodeFs.writeFileSync(path.join(FIXTURE, '.dist.staging-deadbeef', 'leak.txt'), 'x');
    const third = buildFixture(inside);
    assert.equal(third.tree, first.tree);
    assert.equal(nodeFs.existsSync(path.join(inside, '.dist.staging-deadbeef')), false);
  } finally {
    nodeFs.rmSync(inside, { recursive: true, force: true });
    for (const name of listing(FIXTURE).filter(entry => entry.startsWith('.dist.'))) nodeFs.rmSync(path.join(FIXTURE, name), { recursive: true, force: true });
  }
});

test('staging: only staging directories that carry our marker are cleaned up', () => {
  const parent = workdir();
  const out = path.join(parent, 'dist');
  const ours = path.join(parent, '.dist.staging-aaaa1111');
  const foreign = path.join(parent, '.dist.staging-bbbb2222');
  const oldBackup = path.join(parent, '.dist.previous-cccc3333');
  for (const dir of [ours, foreign, oldBackup]) { nodeFs.mkdirSync(dir); nodeFs.writeFileSync(path.join(dir, 'file.txt'), 'x'); }
  nodeFs.writeFileSync(path.join(ours, '.inhagame-public-build-staging'), 'in progress\n');
  nodeFs.writeFileSync(path.join(oldBackup, MARKER), 'mode=production\n');
  const logs = [];
  buildFixture(out, { log: line => logs.push(line) });
  assert.equal(nodeFs.existsSync(ours), false, 'our stale staging directory was removed');
  assert.equal(nodeFs.existsSync(foreign), true, 'a directory without our marker is not ours to delete');
  assert.equal(nodeFs.existsSync(oldBackup), true, 'a previous-output backup is never removed automatically');
  assert.ok(logs.some(line => /removed stale staging directory \.dist\.staging-aaaa1111/.test(line)));
});

// ---------------------------------------------------------------------------------------------------------
// 5. Preview NPC policy: what the configuration enables vs. what reaches a backend
// ---------------------------------------------------------------------------------------------------------
const previewBuild = (() => { const out = path.join(workdir(), 'dist'); build({ srcRoot: WORLD, outDir: out, env: PREVIEW_HOSTS, mode: 'preview' }); return out; })();
const productionBuild = (() => { const out = path.join(workdir(), 'dist'); build({ srcRoot: WORLD, outDir: out, env: GOOD, mode: 'production' }); return out; })();

function bootBranches(distDir, hostname, search = '') {
  const text = nodeFs.readFileSync(path.join(distDir, 'src/main.js'), 'utf8');
  const startup = text.match(/const startupParams = [^\n]*\n/)?.[0];
  const preview = text.match(/const previewHost = [^\n]*\n/)?.[0];
  const from = text.indexOf('const npcTestMode');
  const to = text.indexOf('\n', text.indexOf('const npcEnabled'));
  assert.ok(startup && preview && from > 0 && to > from, 'the NPC boot-selection block of src/main.js was found');
  const names = ['previewHost', 'npcTestMode', 'npcAiPilotMode', 'npcProductionMode', 'npcPreviewMode', 'npcSharedScheduleMode', 'npcRosterPreviewMode', 'npcSocialMode', 'npcEnabled'];
  return new Function('location', `${startup}${preview}${text.slice(from, to)};\nreturn { ${names.join(', ')} };`)({ hostname, search });
}

test('preview policy: a configured Preview campus host turns the production NPC branch on (configuration only)', () => {
  const branches = bootBranches(previewBuild, 'world-preview-test.vercel.app');
  assert.equal(branches.previewHost, true);
  assert.equal(branches.npcProductionMode, true, 'the generator puts the Preview campus host into the production host list');
  assert.equal(branches.npcSharedScheduleMode, true);
  assert.equal(branches.npcSocialMode, true);
  assert.equal(branches.npcEnabled, true);
  assert.equal(bootBranches(previewBuild, 'www.world-preview-test.vercel.app').npcProductionMode, true, 'www alias of the campus host');
  const main = nodeFs.readFileSync(path.join(previewBuild, 'src/main.js'), 'utf8');
  assert.match(main, /\['world-preview-test\.vercel\.app', 'www\.world-preview-test\.vercel\.app'\]\.includes\(location\.hostname\)/);
  assert.equal(/inhagame\.example/.test(main), false);
});

test('preview policy: other Preview URLs keep the opt-in preview behaviour only', () => {
  const other = bootBranches(previewBuild, 'some-other-preview.vercel.app');
  assert.deepEqual([other.npcProductionMode, other.npcSharedScheduleMode, other.npcSocialMode, other.npcEnabled], [false, false, false, false]);
  const optIn = bootBranches(previewBuild, 'some-other-preview.vercel.app', '?npcTest=a-r1');
  assert.deepEqual([optIn.npcProductionMode, optIn.npcPreviewMode, optIn.npcEnabled], [false, true, true], 'the explicit ?npcTest opt-in, not the production branch');
  assert.equal(bootBranches(previewBuild, 'world-test.dev').npcProductionMode, false, 'another build\'s host is not enabled here');
  assert.equal(bootBranches(previewBuild, 'inhagame.example').npcProductionMode, false, 'the template host is gone');
  assert.equal(bootBranches(productionBuild, 'world-test.dev').npcProductionMode, true);
  assert.equal(bootBranches(productionBuild, 'world-preview-test.vercel.app').npcProductionMode, false);
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function flagDecisionBlock(distDir) {
  const text = nodeFs.readFileSync(path.join(distDir, 'src/main.js'), 'utf8');
  const block = text.match(/if \(npcProductionMode\) \{\n    const \[aiResult, questResult\] = await Promise\.all\(\[[\s\S]*?questFlagPending = questResult === FLAG_UNAVAILABLE;\n  \}/)?.[0];
  assert.ok(block, 'the flag decision block of loadOptionalNpcRuntime was found');
  return block;
}
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const FLAG_BEHAVIOUR = {
  on: () => response(200, { enabled: true }),
  off: () => response(404),
  'disabled-body': () => response(200, { enabled: false }),
  'server-error': () => response(503),
  'network-error': () => { throw new TypeError('offline'); },
  'bad-body': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
  slow: () => new Promise(() => {})
};

async function runFlagDecision(distDir, { ai, quest, productionMode = true }) {
  const requests = [];
  const behaviour = { '/api/npc-ai': ai, '/api/world-quest': quest };
  const fetcher = async (url, options = {}) => { requests.push({ url, method: options.method ?? 'GET', cache: options.cache, hasBody: 'body' in options, hasAuth: Boolean(options.headers) }); return FLAG_BEHAVIOUR[behaviour[url]](); };
  const run = new AsyncFunction('probeFeatureFlag', 'FLAG_ENABLED', 'FLAG_UNAVAILABLE', 'npcProductionMode',
    `let npcAiEnabled = false, npcQuestEnabled = false, questFlagPending = false;\n${flagDecisionBlock(distDir)}\nreturn { npcAiEnabled, npcQuestEnabled, questFlagPending };`);
  const probe = url => probeFeatureFlag(url, { fetcher, timeoutMs: 25 });
  const outcome = await run(probe, FLAG_ENABLED, FLAG_UNAVAILABLE, productionMode);
  return { outcome, requests };
}

test('preview policy: the flag probes decide what starts; failures and delays never switch a feature on', async () => {
  const table = [
    ['on', 'on', { npcAiEnabled: true, npcQuestEnabled: true, questFlagPending: false }],
    ['on', 'off', { npcAiEnabled: true, npcQuestEnabled: false, questFlagPending: false }],
    ['off', 'on', { npcAiEnabled: false, npcQuestEnabled: true, questFlagPending: false }],
    ['off', 'off', { npcAiEnabled: false, npcQuestEnabled: false, questFlagPending: false }],
    ['disabled-body', 'disabled-body', { npcAiEnabled: false, npcQuestEnabled: false, questFlagPending: false }],
    ['server-error', 'on', { npcAiEnabled: false, npcQuestEnabled: true, questFlagPending: false }],
    ['network-error', 'network-error', { npcAiEnabled: false, npcQuestEnabled: false, questFlagPending: true }],
    ['bad-body', 'server-error', { npcAiEnabled: false, npcQuestEnabled: false, questFlagPending: true }],
    ['slow', 'on', { npcAiEnabled: false, npcQuestEnabled: true, questFlagPending: false }],
    ['on', 'slow', { npcAiEnabled: true, npcQuestEnabled: false, questFlagPending: true }]
  ];
  for (const [ai, quest, expected] of table) {
    const { outcome, requests } = await runFlagDecision(previewBuild, { ai, quest });
    assert.deepEqual(outcome, expected, `ai=${ai} quest=${quest}`);
    assert.deepEqual(requests.map(request => request.url).sort(), ['/api/npc-ai', '/api/world-quest'], 'exactly the two same-origin flag endpoints');
    for (const request of requests) {
      assert.equal(request.method, 'GET');
      assert.equal(request.cache, 'no-store');
      assert.equal(request.hasBody || request.hasAuth, false, 'a flag probe sends no body and no credentials');
      assert.equal(/^[a-z]+:/i.test(request.url) || request.url.startsWith('//'), false, 'relative URL: only the page\'s own origin can be reached');
    }
  }
  const idle = await runFlagDecision(previewBuild, { ai: 'on', quest: 'on', productionMode: false });
  assert.deepEqual(idle.requests, [], 'without the production branch no flag is probed at all');
  assert.deepEqual(idle.outcome, { npcAiEnabled: false, npcQuestEnabled: false, questFlagPending: false });
  assert.equal(await probeFeatureFlag('/x', { fetcher: async () => response(404) }), FLAG_DISABLED);
});

// The browser only ever calls its own origin; whether a backend is reached depends on server settings.
function callFunction(file, env, request) {
  const script = `
    const calls = [];
    globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), method: init.method, authorization: Boolean(init.headers && init.headers.Authorization) }); return { status: 200, json: async () => ({ ok: true }) }; };
    const handler = require(${JSON.stringify(path.join(WORLD, 'api', file))});
    const res = { headers: {}, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    Promise.resolve(handler(${JSON.stringify(request)}, res)).then(() => console.log(JSON.stringify({ code: res.code, calls })));`;
  const run = spawnSync(process.execPath, ['-e', script], { env: cleanEnv(env), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('preview policy: a flag probe never reaches a backend; only an authorised POST does, and only to the configured URL', () => {
  const BACKEND = 'https://npc-backend.invalid';
  const ENABLED = { NPC_AI_ENABLED: '1', NPC_QUEST_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: BACKEND };
  const bearer = 'Bearer ' + 'a'.repeat(32);
  const post = (body, extra = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', host: 'preview.test', authorization: bearer, ...extra } });
  for (const [file, expectedUrl, body] of [['npc-ai.js', BACKEND, { x: 1 }], ['world-quest.js', `${BACKEND}/quest`, { event: 'e' }]]) {
    assert.deepEqual(callFunction(file, {}, post(body)), { code: 404, calls: [] }, `${file}: flags off -> nothing is called`);
    assert.deepEqual(callFunction(file, ENABLED, { method: 'GET', headers: {} }), { code: 200, calls: [] }, `${file}: the flag probe answers locally`);
    const used = callFunction(file, ENABLED, post(body));
    assert.equal(used.code, 200);
    assert.deepEqual(used.calls, [{ url: expectedUrl, method: 'POST', authorization: true }], `${file}: the only upstream target is the configured URL`);
    assert.deepEqual(callFunction(file, ENABLED, post(body, { authorization: '' })), { code: 401, calls: [] }, 'no credentials -> no upstream call');
    assert.deepEqual(callFunction(file, ENABLED, post(body, { origin: 'https://evil.example.org' })), { code: 403, calls: [] }, 'foreign origin -> no upstream call');
    assert.equal(callFunction(file, { ...ENABLED, NPC_AI_CLOUD_RUN_URL: 'http://insecure.invalid' }, post(body)).calls.length, 0, 'a non-https target is never used');
  }
  assert.equal(callFunction('world-quest.js', { NPC_AI_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: BACKEND }, post({ event: 'e' })).code, 404, 'the quest flag is independent of the AI flag');
});
