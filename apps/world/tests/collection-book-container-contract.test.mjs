import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = await import('./container/collection-book-fixture.mjs').catch(() => ({}));
const runner = await import('./container/collection-book-docker.mjs').catch(() => ({}));
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('container fixture authenticates only named synthetic actors and separates their ledgers', async () => {
  assert.equal(typeof fixture.createFixtureFetch, 'function');
  const events = [];
  const fetcher = fixture.createFixtureFetch(event => events.push(event));
  for (const label of ['a', 'b', 'foreign', 'anonymous', 'expired']) {
    const response = await fetcher(`${fixture.PUBLIC_ENV.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: fixture.PUBLIC_ENV.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${fixture.TOKENS[label]}` }
    });
    assert.equal(response.status, label === 'expired' ? 401 : 200);
    if (label !== 'expired') assert.equal((await response.json()).is_anonymous, label === 'anonymous');
  }
  for (const label of ['a', 'b', 'foreign']) {
    const response = await fetcher(`${fixture.PUBLIC_ENV.SUPABASE_URL}/rest/v1/rpc/world_collection_list_v1`, {
      method: 'POST', redirect: 'error', headers: { apikey: fixture.PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${fixture.PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: fixture.ACTORS[label] })
    });
    const raw = await response.json();
    assert.equal(raw.userId, fixture.ACTORS[label === 'foreign' ? 'b' : label]);
    assert.equal(raw.entries[0].discovered, label === 'a');
  }
  assert.equal(events.length, 8);
  assert.ok(events.every(event => Object.keys(event).join() === 'kind'));
  assert.doesNotMatch(JSON.stringify(events), /Bearer|sb_publishable|11111111|22222222/);
});

test('container fixture rejects unexpected networks, Auth requests and write RPCs', async () => {
  assert.equal(typeof fixture.createFixtureFetch, 'function');
  const events = [];
  const fetcher = fixture.createFixtureFetch(event => events.push(event));
  for (const [url, options] of [
    ['http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {}],
    [`${fixture.PUBLIC_ENV.SUPABASE_URL}/rest/v1/rpc/world_collection_list_v1`, { method: 'GET' }],
    [`${fixture.PUBLIC_ENV.SUPABASE_URL}/rest/v1/rpc/world_collection_discover_v1`, { method: 'POST' }],
    [`${fixture.PUBLIC_ENV.SUPABASE_URL}/auth/v1/user?unexpected=1`, {}],
    [`${fixture.PUBLIC_ENV.SUPABASE_URL}/auth/v1/user`, { method: 'POST' }],
    [`${fixture.PUBLIC_ENV.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: 'Bearer unrecognized' } }]
  ]) await assert.rejects(fetcher(url, options), /^Error: COLLECTION_FIXTURE_REQUEST_DENIED$/);
  assert.deepEqual(events, Array.from({ length: 6 }, () => ({ kind: 'denied' })));
});

test('Docker runtime uses the built image with isolated network and only read-only test fixtures', () => {
  assert.equal(typeof runner.containerArguments, 'function');
  const args = runner.containerArguments('sha256:test-image', '/checkout/tests/container', 'collection-test');
  const flags = args.join(' ');
  for (const required of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges',
    '--user 1000:1000', '--pids-limit 64', '--memory 256m', '--cpus 1']) assert.ok(flags.includes(required));
  assert.ok(flags.includes('type=bind,src=/checkout/tests/container,dst=/qa,readonly'));
  assert.deepEqual(args.slice(-3), ['sha256:test-image', 'node', '/qa/collection-book-verify.mjs']);
  assert.doesNotMatch(flags, /docker\.sock|--privileged|--env-file|--publish|--network host/);
});

test('hosted container QA checks exact PR head without credentials or deployment permissions', () => {
  let workflow = '';
  try { workflow = read('../../../.github/workflows/collection-book-container.yml'); } catch {}
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /timeout-minutes: 12/);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /node-version: '22'/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|id-token:|packages: write|docker login|deploy/i);
});

const packaging = await import('./container/collection-book-package.mjs').catch(() => ({}));
test('runtime evidence fails closed on a different head, source bytes or Node version', () => {
  assert.equal(typeof packaging.verifyRuntimeReport, 'function');
  const expected = { head: 'a'.repeat(40), sourceHashes: { 'server/collection-book-service.mjs': 'b'.repeat(64) } };
  const report = { ...expected, status: 'passed', node: 'v22.0.0', childRuntime: { node: 'v22.0.0' },
    cmd: ['node', 'npc-factory/npc-ai-cloud-run.mjs'], audit: {}, checks: Array(16).fill({ status: 200 }) };
  packaging.verifyRuntimeReport(report, expected);
  for (const override of [{ head: 'c'.repeat(40) }, { sourceHashes: {} }, { node: 'v24.0.0' },
    { childRuntime: { node: 'v24.0.0' } }, { audit: { denied: 1 } }, { checks: [] }, { cmd: ['node', 'fixture.mjs'] }]) {
    assert.throws(() => packaging.verifyRuntimeReport({ ...report, ...override }, expected));
  }
});

test('hosted runner resolves the real checkout and hashes every Docker COPY source', () => {
  assert.equal(runner.REPOSITORY_ROOT, new URL('../../../', import.meta.url).pathname);
  const manifest = packaging.packagedSourceHashes(new URL('../', import.meta.url).pathname);
  for (const path of ['npc-factory/npc-ai-cloud-run.mjs', 'npc-factory/collection-book-cloud-handler.mjs',
    'npc-factory/npc-ai-auth.mjs', 'server/collection-book-service.mjs',
    'src/config/supabase-public-config.mjs', 'src/collection/collection-discovery-contract.mjs']) {
    assert.match(manifest[path], /^[a-f0-9]{64}$/);
  }
  assert.ok(Object.keys(manifest).some(path => path.startsWith('data/')));
  assert.ok(Object.keys(manifest).every(path => packaging.PACKAGE_DIRECTORIES.includes(path.split('/')[0])));
});

test('public ledger fixtures exercise the real filtered projection and reject a foreign actor', async () => {
  const { projectCollectionBook } = await import('../server/collection-book-service.mjs');
  const fetcher = fixture.createFixtureFetch();
  for (const label of ['a', 'b', 'foreign']) {
    const response = await fetcher(`${fixture.PUBLIC_ENV.SUPABASE_URL}/rest/v1/rpc/world_collection_list_v1`, {
      method: 'POST', redirect: 'error', headers: { apikey: fixture.PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${fixture.PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: fixture.ACTORS[label] })
    });
    const raw = await response.json();
    if (label === 'foreign') {
      assert.throws(() => projectCollectionBook(raw, fixture.ACTORS[label]), /COLLECTION_BOOK_UNAVAILABLE/);
      continue;
    }
    const projected = projectCollectionBook(raw, fixture.ACTORS[label]);
    assert.equal(projected.entries.length, 2);
    assert.equal(projected.trackableCount, 1);
    assert.equal(projected.discoveredCount, label === 'a' ? 1 : 0);
    assert.equal(projected.entries[0].state, label === 'a' ? 'DISCOVERED' : 'UNKNOWN');
    assert.equal(projected.entries[1].state, 'OWNER_DERIVED');
    assert.doesNotMatch(JSON.stringify(projected), /FIXTURE_PRIVATE|campus_leaf|campus_fragment|fixture\.hidden|sourceRef|userId/);
  }
});
