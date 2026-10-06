// Runs INSIDE the actual Docker image. No source-copy or host-Node fallback is supported.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { ACTORS, PUBLIC_ENV, TOKENS } from './collection-book-fixture.mjs';
import { IMAGE_CMD, packagedSourceHashes, verifyRuntimeReport } from './collection-book-package.mjs';

let stage = 'packaged-runtime';
let child;
const report = { status: 'failed', checks: [] };
const pending = new Map();
let messageId = 0;
function snapshot() {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('AUDIT_TIMEOUT')); }, 2000);
    pending.set(id, counts => { clearTimeout(timer); resolve(counts); });
    child.send({ type: 'audit-snapshot', id });
  });
}
function request({ path = '/collection-book', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 8080, path, method, headers,
      agent: false, timeout: 2000 }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (text.length > 1048576) req.destroy(Error('RESPONSE_TOO_LARGE')); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => req.destroy(Error('HTTP_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}
function assertProjection(response, label) {
  const data = JSON.parse(response.text);
  assert.deepEqual(Object.keys(data).sort(), ['discoveredCount', 'entries', 'trackableCount', 'version']);
  assert.equal(data.version, 1);
  assert.equal(data.trackableCount, 1);
  assert.equal(data.discoveredCount, label === 'a' ? 1 : 0);
  assert.equal(data.entries.length, 2);
  for (const entry of data.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['discoveryCount', 'firstDiscoveredAt', 'hint', 'key', 'sourceLabel', 'state', 'title']);
    assert.equal(entry.sourceLabel, null);
  }
  const [fish, owner] = data.entries;
  assert.equal(fish.state, label === 'a' ? 'DISCOVERED' : 'UNKNOWN');
  assert.equal(fish.key, label === 'a' ? 'collection.fish.carp' : 'unrevealed:0');
  assert.equal(fish.discoveryCount, label === 'a' ? 2 : 0);
  assert.equal(fish.firstDiscoveredAt, label === 'a' ? '2026-01-01T00:00:00.000Z' : null);
  assert.equal(owner.key, 'collection.place.biryong_tower');
  assert.equal(owner.state, 'OWNER_DERIVED');
  assert.equal(owner.discoveryCount, null);
  assert.equal(owner.firstDiscoveredAt, null);
  assert.doesNotMatch(response.text, /FIXTURE_PRIVATE|sourceRef|userId|ownerRef|ownerDomain|campus_leaf|campus_fragment|fixture\.hidden/);
  for (const privateValue of [...Object.values(ACTORS), ...Object.values(TOKENS), PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY]) {
    assert.ok(!response.text.includes(privateValue));
  }
  if (label === 'b') assert.doesNotMatch(response.text, /carp|붕어/);
}
const auth = label => ({ authorization: `Bearer ${TOKENS[label]}` });
try {
  assert.match(process.version, /^v22\./, 'actual image Node 22 is required');
  assert.equal(process.cwd(), '/app');
  const expected = JSON.parse(readFileSync(0, 'utf8'));
  assert.match(expected.head, /^[a-f0-9]{40}$/);
  Object.assign(report, { head: expected.head, node: process.version, platform: process.platform,
    arch: process.arch, cmd: [...IMAGE_CMD], sourceHashes: packagedSourceHashes('/app') });
  assert.deepEqual(report.sourceHashes, expected.sourceHashes);

  stage = 'real-entrypoint-startup';
  child = spawn(process.execPath, ['--import', '/qa/collection-book-preload.mjs', ...IMAGE_CMD.slice(1)], {
    cwd: '/app', env: { ...PUBLIC_ENV }, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  child.on('message', message => {
    if (message?.type === 'fixture-runtime') report.childRuntime = {
      node: message.node, platform: message.platform, arch: message.arch
    };
    if (message?.type === 'audit-snapshot') { pending.get(message.id)?.(message.counts); pending.delete(message.id); }
  });
  // GET without credentials is safe to retry for readiness and cannot reach Auth or RPC.
  let listening = false;
  for (let attempt = 0; attempt < 50 && !listening; attempt++) {
    assert.equal(child.exitCode, null, 'packaged entrypoint must stay running');
    listening = await request().then(res => res.status === 401, () => false);
    if (!listening) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(listening, 'packaged entrypoint must serve real loopback HTTP');
  assert.deepEqual(await snapshot(), {});
  assert.equal(report.childRuntime?.node, process.version);
  const checks = [
    { name: 'unauthenticated', status: 401, error: 'AUTH_REQUIRED' },
    { name: 'malformed-bearer', headers: { authorization: 'Bearer invalid' }, status: 401, error: 'AUTH_REQUIRED' },
    { name: 'authenticated-a-filtered', headers: auth('a'), status: 200, actor: 'a', delta: { 'auth-a': 1, 'rpc-a': 1 } },
    { name: 'authenticated-b-filtered', headers: auth('b'), status: 200, actor: 'b', delta: { 'auth-b': 1, 'rpc-b': 1 } },
    { name: 'anonymous', headers: auth('anonymous'), status: 401, error: 'AUTH_REQUIRED', delta: { 'auth-anonymous': 1 } },
    { name: 'expired', headers: auth('expired'), status: 401, error: 'AUTH_REQUIRED', delta: { 'auth-expired': 1 } },
    { name: 'foreign-ledger', headers: auth('foreign'), status: 503, error: 'COLLECTION_BOOK_UNAVAILABLE', delta: { 'auth-foreign': 1, 'rpc-foreign': 1 } },
    { name: 'query-rejected', path: `/collection-book?userId=${ACTORS.b}`, headers: auth('a'), status: 400 },
    { name: 'bare-query-rejected', path: '/collection-book?', headers: auth('a'), status: 400 },
    { name: 'content-length-body-rejected', headers: { ...auth('a'), 'content-length': '2' }, body: '{}', status: 400 },
    { name: 'chunked-body-rejected', headers: { ...auth('a'), 'transfer-encoding': 'chunked' }, body: '{}', status: 400 },
    { name: 'zero-length-get', headers: { ...auth('b'), 'content-length': '0' }, status: 200, actor: 'b', delta: { 'auth-b': 1, 'rpc-b': 1 } },
    { name: 'post-rejected', method: 'POST', headers: auth('a'), status: 405 },
    { name: 'cross-origin-rejected', headers: { ...auth('a'), origin: 'https://foreign-fixture.invalid' }, status: 403 },
    { name: 'existing-quest-noauth', path: '/quest', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', status: 401, error: 'QUEST_AUTH_REQUIRED' },
    { name: 'existing-default-ai-noauth', path: '/', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', status: 401, error: 'PILOT_AUTH_REQUIRED' }
  ];
  let audit = {};
  for (const check of checks) {
    stage = check.name;
    const response = await request(check);
    assert.equal(response.status, check.status);
    if (!check.path || check.path.startsWith('/collection-book')) {
      assert.equal(response.headers['cache-control'], 'private, no-store');
      assert.equal(response.headers.vary, 'Authorization');
    }
    if (check.status === 405) assert.equal(response.headers.allow, 'GET');
    if (check.error) assert.deepEqual(JSON.parse(response.text), { error: check.error });
    if (check.actor) assertProjection(response, check.actor);
    const current = await snapshot();
    const expectedAudit = { ...audit };
    for (const [key, count] of Object.entries(check.delta ?? {})) expectedAudit[key] = (expectedAudit[key] ?? 0) + count;
    assert.deepEqual(current, expectedAudit, 'only the expected synthetic Auth/read RPC may occur');
    audit = current;
    report.checks.push({ name: check.name, status: response.status, auditDelta: check.delta ?? {} });
  }
  Object.assign(report, { status: 'passed', audit });
  stage = 'evidence-validation';
  verifyRuntimeReport(report, expected);
} catch {
  report.status = 'failed';
  report.failedCheck = stage;
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    await exited;
    clearTimeout(timer);
  }
}
// Only public source hashes, runtime metadata and synthetic status/count evidence leave the container.
console.log(JSON.stringify(report));
