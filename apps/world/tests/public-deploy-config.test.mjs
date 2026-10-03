// Deployment wiring: generated browser config, host policy, CORS, routing and the Vercel contract.
// Everything runs on synthetic values in temporary directories; nothing here talks to a network,
// a database or Vercel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { branchDeploys } from './support/vercel-branch-rules.mjs';

const require = createRequire(import.meta.url);
const WORLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(WORLD, 'scripts/build-public-config.mjs');
const policy = require(path.join(WORLD, 'scripts/public-hosts.cjs'));

const KEY = 'sb_publishable_' + 'Ab1_'.repeat(8);
const SUPABASE = 'https://abcdefghijkl.supabase.co';
const GOOD = Object.freeze({
  INHAGAME_PUBLIC_SUPABASE_URL: SUPABASE,
  INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
  INHAGAME_PUBLIC_HOST_CAMPUS: 'world-test.dev',
  INHAGAME_PUBLIC_HOST_CLASSIC: 'duck.world-test.dev',
  INHAGAME_PUBLIC_HOST_INDUCKUP: 'up.world-test.dev',
  INHAGAME_PUBLIC_HOST_SURVIVAL: 'survive.world-test.dev',
  INHAGAME_PUBLIC_HOST_GROW: 'grow.world-test.dev'
});
const HOSTS = { campus: 'world-test.dev', classic: 'duck.world-test.dev', induckup: 'up.world-test.dev',
  survival: 'survive.world-test.dev', grow: 'grow.world-test.dev' };

const sandbox = mkdtempSync(path.join(tmpdir(), 'world-deploy-'));
test.after(() => rmSync(sandbox, { recursive: true, force: true }));
let counter = 0;
const outDir = () => path.join(sandbox, `out-${counter++}`);
const cleanEnv = extra => ({ PATH: process.env.PATH, ...extra });

function generate(env, args = []) {
  const out = outDir();
  const result = spawnSync(process.execPath, [GENERATOR, '--out', out, ...args], { env: cleanEnv(env), encoding: 'utf8' });
  return { ...result, out };
}
const production = (over = {}) => generate({ ...GOOD, ...over }, ['--mode', 'production']);
const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');
function treeHash(dir) {
  const hash = createHash('sha256');
  const walk = rel => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next); else hash.update(next + '\0').update(readFileSync(path.join(dir, next)));
    }
  };
  walk('');
  return hash.digest('hex');
}
const hostsIn = (text, suffix) => new Set(text.match(/(?:[a-z0-9-]+\.)*world-test\.dev/g) ?? []);

const built = production();
test('production build succeeds on synthetic values and is reproducible', () => {
  assert.equal(built.status, 0, built.stderr);
  const again = production();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(treeHash(built.out), treeHash(again.out));
});

test('the checked-in sources and templates are never modified by a build', () => {
  const before = treeHash(WORLD);
  const run = production();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(treeHash(WORLD), before);
  assert.match(readFileSync(path.join(WORLD, 'supabase-public-config.js'), 'utf8'), /sb_publishable_PUBLIC_PLACEHOLDER/);
});

test('local mode is a verbatim copy that keeps the local fixture contract', () => {
  const local = generate({}, ['--mode', 'local']);
  assert.equal(local.status, 0, local.stderr);
  for (const rel of ['supabase-public-config.js', 'src/config/supabase-public-config.js', 'hub.js', 'index.html', 'src/main.js']) {
    assert.equal(read(local.out, rel), readFileSync(path.join(WORLD, rel), 'utf8'), rel);
  }
});

test('the static output excludes server code, tests and tooling', () => {
  for (const rel of ['api', 'tests', 'scripts', 'Dockerfile', 'vercel.json', 'qa.mjs', 'dev-server.mjs', 'model-converter']) {
    assert.equal(existsSync(path.join(built.out, rel)), false, rel);
  }
  for (const rel of ['index.html', 'campus/index.html', 'profile/index.html', 'achievements/index.html', 'src/main.js']) {
    assert.equal(existsSync(path.join(built.out, rel)), true, rel);
  }
});

const FAILURES = [
  ['missing url', { INHAGAME_PUBLIC_SUPABASE_URL: '' }, /missing INHAGAME_PUBLIC_SUPABASE_URL/],
  ['missing key', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }, /missing INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY/],
  ['localhost url', { INHAGAME_PUBLIC_SUPABASE_URL: 'https://localhost' }, /localhost or a placeholder/],
  ['loopback url', { INHAGAME_PUBLIC_SUPABASE_URL: 'https://127.0.0.1' }, /localhost or a placeholder/],
  ['http url', { INHAGAME_PUBLIC_SUPABASE_URL: 'http://abcdefghijkl.supabase.co' }, /must use https/],
  ['url with path', { INHAGAME_PUBLIC_SUPABASE_URL: `${SUPABASE}/rest/v1` }, /bare origin/],
  ['url with credentials', { INHAGAME_PUBLIC_SUPABASE_URL: 'https://user:pw@abcdefghijkl.supabase.co' }, /bare origin/],
  ['invalid url', { INHAGAME_PUBLIC_SUPABASE_URL: 'not a url' }, /not a valid URL/],
  ['placeholder url', { INHAGAME_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co' }, /localhost or a placeholder/],
  ['placeholder key', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_PUBLIC_PLACEHOLDER' }, /placeholder or malformed/],
  ['short key', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }, /placeholder or malformed/],
  ['secret key', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_' + 'Zz9_'.repeat(8) }, /secret key/],
  ['unknown key type', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'abcdefghijklmnopqrstuvwxyz' }, /not a publishable key type/],
  ['service_role jwt', { INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }, /role "service_role"/],
  ['missing host', { INHAGAME_PUBLIC_HOST_GROW: '' }, /missing host/],
  ['template host', { INHAGAME_PUBLIC_HOST_CLASSIC: 'duck.inhagame.example' }, /reserved or placeholder/],
  ['vercel.app host in production', { INHAGAME_PUBLIC_HOST_CAMPUS: 'world.vercel.app' }, /custom domain/],
  ['host with scheme', { INHAGAME_PUBLIC_HOST_CAMPUS: 'https://world-test.dev' }, /bare DNS host/],
  ['host with port', { INHAGAME_PUBLIC_HOST_CAMPUS: 'world-test.dev:8443' }, /bare DNS host/],
  ['wildcard host', { INHAGAME_PUBLIC_HOST_CAMPUS: '*.world-test.dev' }, /bare DNS host/],
  ['upper-case host', { INHAGAME_PUBLIC_HOST_CAMPUS: 'World-Test.dev' }, /lower-case/],
  ['duplicate host', { INHAGAME_PUBLIC_HOST_GROW: 'duck.world-test.dev' }, /duplicates/]
];
function jwt(role) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, iss: 'supabase' })}.${'s'.repeat(20)}`;
}
for (const [name, override, expected] of FAILURES) {
  test(`production build fails: ${name}`, () => {
    const run = production(override);
    assert.notEqual(run.status, 0, 'must fail');
    assert.match(run.stderr, expected);
    assert.equal(existsSync(run.out), false, 'no output on failure');
    for (const value of Object.values(override)) if (value.length > 12) assert.equal((run.stdout + run.stderr).includes(value), false, 'secret echoed');
  });
}

test('a legacy anon JWT is accepted, a partial host set is not', () => {
  assert.equal(production({ INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).status, 0);
  const partial = { ...GOOD }; delete partial.INHAGAME_PUBLIC_HOST_SURVIVAL;
  assert.notEqual(generate(partial, ['--mode', 'production']).status, 0);
});

test('Preview and Production never share a build: mode must agree with VERCEL_ENV', () => {
  assert.notEqual(generate({ ...GOOD, VERCEL_ENV: 'production' }, ['--mode', 'preview']).status, 0);
  assert.notEqual(generate({ ...GOOD, VERCEL_ENV: 'production' }, ['--mode', 'local']).status, 0);
  assert.notEqual(generate({ ...GOOD, VERCEL_ENV: 'preview' }, ['--mode', 'production']).status, 0);
  assert.notEqual(generate({ ...GOOD, VERCEL_ENV: 'preview' }, ['--mode', 'local']).status, 0);
  assert.equal(generate({ ...GOOD, VERCEL_ENV: 'production' }).status, 0, 'derived production');
  const previewHosts = { ...GOOD, INHAGAME_PUBLIC_HOST_CAMPUS: 'world-preview.vercel.app', VERCEL_ENV: 'preview' };
  assert.equal(generate(previewHosts).status, 0, 'preview may use a vercel.app host');
  assert.notEqual(generate({ ...GOOD, VERCEL_ENV: 'preview', INHAGAME_PUBLIC_SUPABASE_URL: '' }).status, 0, 'preview values are validated too');
  assert.notEqual(generate({}, ['--mode', 'bogus']).status, 0);
});

test('the generator refuses to wipe a directory it did not create', () => {
  const dir = outDir();
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'keep.txt'), 'x');
  const run = spawnSync(process.execPath, [GENERATOR, '--mode', 'production', '--out', dir], { env: cleanEnv(GOOD), encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.equal(existsSync(path.join(dir, 'keep.txt')), true);
  const self = spawnSync(process.execPath, [GENERATOR, '--mode', 'production', '--out', WORLD], { env: cleanEnv(GOOD), encoding: 'utf8' });
  assert.notEqual(self.status, 0);
});

test('a moved or added host reference fails the build instead of being skipped', async () => {
  const { rewriteHosts } = await import(GENERATOR);
  const source = readFileSync(path.join(WORLD, 'hub.js'), 'utf8');
  assert.doesNotThrow(() => rewriteHosts('hub.js', source, HOSTS));
  assert.throws(() => rewriteHosts('hub.js', source + '\n// https://duck.inhagame.example/', HOSTS), /host references changed/);
  assert.throws(() => rewriteHosts('hub.js', source.replace('"grow.inhagame.example": "induck-grow"', '"grow.example.org": "induck-grow"'), HOSTS), /host references changed/);
  assert.throws(() => rewriteHosts('index.html', '<a href="https://duck.inhagame.example/">x</a>', HOSTS), /host references changed/);
});

test('classic and ESM configs carry identical values and honour the existing override contract', async () => {
  const classicCode = read(built.out, 'supabase-public-config.js');
  const classic = vm.createContext({});
  vm.runInContext(classicCode, classic);
  assert.deepEqual({ ...classic.__INHAGAME_PUBLIC_SUPABASE__ }, { url: SUPABASE, publishableKey: KEY });

  const preset = vm.createContext({ __INHAGAME_PUBLIC_SUPABASE__: { url: 'https://override.test', publishableKey: 'k' } });
  vm.runInContext(classicCode, preset);
  assert.equal(preset.__INHAGAME_PUBLIC_SUPABASE__.url, 'https://override.test', 'a pre-set global wins');

  const esm = read(built.out, 'src/config/supabase-public-config.js');
  const probe = (env) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import('data:text/javascript;base64,${Buffer.from(esm).toString('base64')}');
     console.log(JSON.stringify({ url: m.SUPABASE_URL, key: m.SUPABASE_PUBLISHABLE_KEY, global: globalThis.__INHAGAME_PUBLIC_SUPABASE__ }));`],
    { env: cleanEnv(env), encoding: 'utf8' });
  const plain = probe({});
  assert.equal(plain.status, 0, plain.stderr);
  const out = JSON.parse(plain.stdout);
  assert.deepEqual([out.url, out.key], [SUPABASE, KEY]);
  assert.deepEqual(out.global, { url: SUPABASE, publishableKey: KEY });
  const overridden = JSON.parse(probe({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_fixture_key' }).stdout);
  assert.equal(overridden.url, 'http://127.0.0.1:54321', 'the test/local env override still wins in the ESM config');
});

const scriptSources = html => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
function resolveLocal(dir, from, specifier) {
  if (/^(?:https?:)?\/\//.test(specifier)) return null;
  const clean = specifier.split(/[?#]/)[0];
  return clean.startsWith('/') ? path.join(dir, clean) : path.resolve(path.dirname(from), clean);
}
function moduleOrder(dir, entry) {
  const order = [], seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(existsSync(file), `import target exists: ${path.relative(dir, file)}`);
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n;]*?(?:from\s*)?['"]([^'"]+)['"]/g)) {
      const target = resolveLocal(dir, file, match[1]);
      if (target && /\.m?js$/.test(target)) visit(target);
    }
    order.push(path.relative(dir, file));
  };
  visit(path.join(dir, entry));
  return order;
}

test('the four entry points load the Supabase config before they consume it', () => {
  const dir = built.out;
  for (const [page, consumer] of [['index.html', '/hub-account.js'], ['profile/index.html', '/profile/profile.js'],
    ['achievements/index.html', '/achievements/achievements.js']]) {
    const scripts = scriptSources(read(dir, page));
    assert.ok(scripts.includes('/supabase-public-config.js'), `${page} loads the classic config`);
    assert.ok(scripts.indexOf('/supabase-public-config.js') < scripts.indexOf(consumer), `${page}: config before ${consumer}`);
    assert.ok(scripts.indexOf('/supabase-public-config.js') > scripts.findIndex(src => src.includes('supabase-js')) - 1);
  }
  // /campus/: no classic bootstrap; the ESM config is evaluated before main.js through its import graph.
  const campusScripts = scriptSources(read(dir, 'campus/index.html'));
  assert.ok(campusScripts.includes('/src/main.js'));
  assert.ok(!campusScripts.includes('/supabase-public-config.js'));
  const order = moduleOrder(dir, 'src/main.js');
  const config = order.indexOf('src/config/supabase-public-config.js');
  assert.ok(config >= 0, 'campus ESM graph reaches the generated config');
  assert.ok(config < order.indexOf('src/main.js'), 'config is evaluated before main.js');
  assert.ok(order.indexOf('src/online/world-online.js') > config, 'world-online evaluates after the config');
});

test('every local script and stylesheet of the entry pages exists in the static output', () => {
  for (const page of ['index.html', 'campus/index.html', 'profile/index.html', 'achievements/index.html']) {
    const html = read(built.out, page);
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      const target = resolveLocal(built.out, path.join(built.out, page), match[1]);
      if (target && !match[1].startsWith('#')) assert.ok(existsSync(target), `${page}: ${match[1]}`);
    }
  }
});

test('hosts, links, origins and auth redirects follow one input', () => {
  const dir = built.out;
  const four = [HOSTS.classic, HOSTS.induckup, HOSTS.survival, HOSTS.grow];
  const expected = {
    'hub.js': four, 'index.html': four, 'data/game-catalog.json': four, 'profile/profile.js': four,
    'game-entry.js': Object.values(HOSTS), 'hub-account.js': [HOSTS.campus, HOSTS.classic],
    'src/main.js': [HOSTS.campus, `www.${HOSTS.campus}`],
    'src/events/zombie-university-2026/event-route.js': [HOSTS.campus, `www.${HOSTS.campus}`]
  };
  for (const [rel, hosts] of Object.entries(expected)) {
    const text = read(dir, rel);
    assert.deepEqual([...hostsIn(text)].sort(), [...hosts].sort(), rel);
    assert.equal(/inhagame\.example/.test(text), false, `${rel} keeps no template host`);
  }
  assert.match(read(dir, 'hub-account.js'), new RegExp(`emailRedirectTo: 'https://${HOSTS.campus}/\\?panel=account'`));
  assert.match(read(dir, 'hub-account.js'), new RegExp(`emailRedirectTo: 'https://${HOSTS.classic}/verify-inha\\.html'`));
  assert.match(read(dir, 'game-entry.js'), new RegExp(`fetch\\("https://${HOSTS.campus}/api/hub-entry"`));
  assert.match(read(dir, 'src/main.js'), new RegExp(`\\['${HOSTS.campus}', 'www\\.${HOSTS.campus}'\\]\\.includes\\(location\\.hostname\\)`));
  const catalog = JSON.parse(read(dir, 'data/game-catalog.json'));
  for (const game of catalog.games.filter(item => /^https:/.test(item.playUrl ?? ''))) {
    assert.ok(four.includes(new URL(game.playUrl).hostname), game.id);
  }
  // The same input yields the runtime CORS allow-list used by api/hub-entry.js.
  const origins = policy.runtimeOriginTargets({ ...GOOD, VERCEL_ENV: 'production' });
  assert.deepEqual(Object.keys(origins).sort(), Object.values(HOSTS).map(host => `https://${host}`).sort());
  const gameEntry = read(dir, 'game-entry.js');
  for (const [origin, target] of Object.entries(origins)) {
    assert.match(gameEntry, new RegExp(`"${new URL(origin).hostname.replace(/\./g, '\\.')}": "${target}"`));
  }
});

test('Preview and Production host policies differ and never accept an arbitrary domain', () => {
  const validate = (over, mode) => policy.validateHosts(policy.readHostInput({ ...GOOD, ...over }), { mode });
  assert.deepEqual({ ...validate({}, 'production') }, HOSTS);
  assert.throws(() => validate({ INHAGAME_PUBLIC_HOST_GROW: 'g.vercel.app' }, 'production'));
  assert.doesNotThrow(() => validate({ INHAGAME_PUBLIC_HOST_GROW: 'g.vercel.app' }, 'preview'));
  assert.deepEqual(Object.keys(policy.hostnameTargets(validate({}, 'production'))).sort(),
    [...Object.values(HOSTS), `www.${HOSTS.campus}`].sort());
});

function callHubEntry(env, headers, method = 'OPTIONS') {
  const script = `
    const handler = require(${JSON.stringify(path.join(WORLD, 'api/hub-entry.js'))});
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, end() { return this; }, json() { return this; } };
    Promise.resolve(handler({ method: ${JSON.stringify(method)}, headers: ${JSON.stringify(headers)}, body: '' }, res))
      .then(() => console.log(JSON.stringify({ code: res.code, origin: res.headers['Access-Control-Allow-Origin'] ?? null })));`;
  const run = spawnSync(process.execPath, ['-e', script], { env: cleanEnv(env), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const PROD = { ...GOOD, VERCEL_ENV: 'production' };
test('api/hub-entry CORS accepts only the configured game origins', () => {
  for (const host of Object.values(HOSTS)) {
    assert.deepEqual(callHubEntry(PROD, { origin: `https://${host}` }), { code: 204, origin: `https://${host}` }, host);
  }
  for (const origin of ['https://evil.example.com', 'https://inhagame.example', 'https://duck.inhagame.example',
    `https://www.${HOSTS.campus}`, `http://${HOSTS.campus}`, `https://${HOSTS.campus}.evil.com`, 'null', undefined]) {
    assert.equal(callHubEntry(PROD, origin === undefined ? {} : { origin }).code, 403, String(origin));
  }
});

test('api/hub-entry fails closed in Production without a valid host set, and keeps the local template otherwise', () => {
  assert.equal(callHubEntry({ VERCEL_ENV: 'production' }, { origin: 'https://inhagame.example' }).code, 403, 'no hosts in production');
  const partial = { ...PROD }; delete partial.INHAGAME_PUBLIC_HOST_GROW;
  assert.equal(callHubEntry(partial, { origin: `https://${HOSTS.campus}` }).code, 403, 'partial set');
  assert.equal(callHubEntry({ ...PROD, INHAGAME_PUBLIC_HOST_CAMPUS: 'x.vercel.app' }, { origin: 'https://x.vercel.app' }).code, 403, 'invalid for production');
  assert.equal(callHubEntry({}, { origin: 'https://inhagame.example' }).code, 204, 'local/test template is unchanged');
  assert.equal(callHubEntry({ VERCEL_ENV: 'preview' }, { origin: 'https://duck.inhagame.example' }).code, 403, 'a hosted preview without hosts fails closed (the inert template is for local/test only)');
});

test('browser output holds public values only; server settings and secrets stay out', () => {
  const dir = built.out;
  const SERVER_ONLY = ['NPC_AI_CLOUD_RUN_URL', 'NPC_AI_ENABLED', 'NPC_QUEST_ENABLED', 'MODEL_CONVERT_CLOUD_RUN_URL',
    'MODEL_CONVERT_PROXY_SECRET', 'MODEL_CONVERT_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_'];
  const walk = rel => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(entry => {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(next) : [next];
  });
  for (const rel of walk('').filter(file => /\.(?:m?js|html|json)$/.test(file))) {
    const text = read(dir, rel);
    for (const name of SERVER_ONLY) assert.equal(text.includes(name), false, `${rel} mentions ${name}`);
  }
  for (const rel of ['supabase-public-config.js', 'src/config/supabase-public-config.js']) {
    const text = read(dir, rel);
    assert.equal(/service_role\s*[:=]|serviceRole|process\.env\.[A-Z_]*(?:SECRET|SERVICE)/.test(text), false, rel);
  }
  assert.equal((built.stdout + built.stderr).includes(KEY), false, 'the key is never logged');
  assert.match(built.stdout, /key=publishable\(\d+ chars\)/);
});

test('NPC and quest flags stay server-side: disabled by default, enabled only by explicit server settings', () => {
  const probe = (file, env, method = 'GET') => {
    const script = `
      const handler = require(${JSON.stringify(path.join(WORLD, 'api', file))});
      const res = { headers: {}, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
      Promise.resolve(handler({ method: ${JSON.stringify(method)}, headers: {} }, res)).then(() => console.log(JSON.stringify({ code: res.code, body: res.body ?? null })));`;
    const run = spawnSync(process.execPath, ['-e', script], { env: cleanEnv(env), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const URL_ = 'https://npc-service.invalid-run.test';
  assert.equal(probe('npc-ai.js', {}).code, 404);
  assert.equal(probe('world-quest.js', {}).code, 404);
  assert.equal(probe('npc-ai.js', { NPC_AI_ENABLED: '1' }).code, 404, 'enabled without a URL stays off');
  assert.equal(probe('npc-ai.js', { NPC_AI_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: 'http://insecure.test' }).code, 404, 'non-https stays off');
  assert.deepEqual(probe('npc-ai.js', { NPC_AI_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: URL_ }), { code: 200, body: { enabled: true } });
  assert.deepEqual(probe('world-quest.js', { NPC_QUEST_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: URL_ }), { code: 200, body: { enabled: true } });
  assert.equal(probe('world-quest.js', { NPC_AI_ENABLED: '1', NPC_AI_CLOUD_RUN_URL: URL_ }).code, 404, 'the quest flag is independent of the AI flag');
});

const vercel = JSON.parse(readFileSync(path.join(WORLD, 'vercel.json'), 'utf8'));
test('vercel.json matches the generator and the routing contract', () => {
  assert.equal(vercel.framework, null);
  assert.equal(vercel.buildCommand, 'node scripts/build-public-config.mjs');
  assert.equal(vercel.outputDirectory, 'dist');
  assert.ok(existsSync(path.join(WORLD, 'scripts/build-public-config.mjs')));
  assert.equal(vercel.ignoreCommand, 'sh vercel-ignore.sh');
  assert.ok(existsSync(path.join(WORLD, 'vercel-ignore.sh')));
  for (const file of Object.keys(vercel.functions)) assert.ok(existsSync(path.join(WORLD, file)), file);
  assert.deepEqual(Object.keys(vercel.functions).sort(), ['api/model-convert.js', 'api/npc-ai.js', 'api/world-quest.js']);
  assert.deepEqual(vercel.rewrites.map(rule => [rule.source, rule.destination]),
    [['/profile', '/profile/index.html'], ['/achievements', '/achievements/index.html']]);
  for (const rule of vercel.rewrites) assert.ok(existsSync(path.join(built.out, rule.destination.slice(1))), rule.destination);
  assert.equal(vercel.rewrites.some(rule => /^https?:/.test(rule.destination)), false, 'no external destination (no private ops link)');
  assert.equal(JSON.stringify(vercel).includes('inha-duck'), false, 'no reference to the private repository deployment');
  // Nothing may auto-deploy to Production on connect; only the preview/** namespace is enabled.
  const enabled = Object.entries(vercel.git.deploymentEnabled).filter(([, on]) => on).map(([branch]) => branch);
  assert.deepEqual(enabled, ['preview/**']);
  assert.equal(branchDeploys(vercel.git.deploymentEnabled, 'main'), false, 'main is not deployed by this rule set');
});

test('api functions stay single-file except for the shared host policy', () => {
  for (const file of readdirSync(path.join(WORLD, 'api'))) {
    const locals = [...readFileSync(path.join(WORLD, 'api', file), 'utf8').matchAll(/require\('(\.[^']*)'\)/g)].map(match => match[1]);
    assert.deepEqual(locals.filter(target => target !== '../scripts/public-hosts.cjs'), [], file);
  }
});

test('the ignored-build rule still builds when the generator, the Vercel config or the sources change', () => {
  const repo = path.join(sandbox, 'ignore-repo');
  const world = path.join(repo, 'apps/world');
  mkdirSync(path.join(world, 'scripts'), { recursive: true });
  mkdirSync(path.join(world, 'tests'), { recursive: true });
  cpSync(path.join(WORLD, 'vercel-ignore.sh'), path.join(world, 'vercel-ignore.sh'));
  const git = (...args) => { const run = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: cleanEnv({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.test' }) }); assert.equal(run.status, 0, run.stderr); return run.stdout.trim(); };
  git('init', '-q');
  writeFileSync(path.join(world, 'index.html'), 'a');
  git('add', '-A'); git('commit', '-qm', 'base');
  const ignored = () => spawnSync('sh', ['vercel-ignore.sh'], { cwd: world, encoding: 'utf8', env: cleanEnv({ VERCEL_GIT_PREVIOUS_SHA: git('rev-parse', 'HEAD~1') }) }).status;
  const change = (rel, text) => { mkdirSync(path.dirname(path.join(world, rel)), { recursive: true }); writeFileSync(path.join(world, rel), text); git('add', '-A'); git('commit', '-qm', rel); return ignored(); };
  assert.equal(change('tests/only.test.mjs', 't'), 0, 'a test-only change is skipped (existing rule)');
  assert.equal(change('README.md', 'doc'), 0, 'a docs-only change is skipped (existing rule)');
  assert.equal(change('scripts/build-public-config.mjs', 'x'), 1, 'a generator change builds');
  assert.equal(change('scripts/public-hosts.cjs', 'x'), 1, 'a host policy change builds');
  assert.equal(change('vercel.json', '{}'), 1, 'a Vercel config change builds');
  assert.equal(change('api/hub-entry.js', 'x'), 1, 'a function change builds');
  assert.equal(change('src/main.js', 'x'), 1, 'a source change builds');
});
