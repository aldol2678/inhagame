import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBiryongProgress, BIRYONG_STORAGE_KEY, BR01_STEP } from '../src/biryong/biryong-state.js';
import { createBiryongCloudSync } from '../src/biryong/biryong-cloud-sync.js';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const values = new Map(), calls = [], notices = [], locks = [], timers = new Map();
  let nextTimer = 0, sync;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const progress = createBiryongProgress({ storage, now: () => 1000, onChange: snapshot => sync?.queue(snapshot) });
  const client = { rpc(name, args) { return new Promise((resolve, reject) => calls.push({ name, args, resolve, reject })); } };
  sync = createBiryongCloudSync({ getClient: () => client, progress,
    onStatus: value => notices.push(value), onAccountSyncing: value => locks.push(value),
    setTimer: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id) });
  const finish = async (index, data = null, error = null) => { calls[index].resolve({ data, error }); await settle(); };
  return { sync, progress, calls, notices, locks, timers, storage,
    finish, tick() { const work = [...timers.values()]; timers.clear(); work.forEach(({ fn }) => fn()); },
    async login(id = 'A') { sync.setAccount(id); await finish(calls.length - 1); await finish(calls.length - 1); } };
}

test('failed cloud save stays dirty and explicit retry sends the latest locally persisted progress', async () => {
  const f = fixture(); await f.login();
  f.progress.discover(); f.progress.recordShout();
  assert.equal(f.sync.status().state, 'pending');
  assert.equal(f.timers.size, 1);
  f.tick(); assert.equal(f.sync.status().state, 'saving');
  await f.finish(2, null, { message: 'synthetic offline' });
  assert.deepEqual(f.sync.status(), { state: 'failed', dirty: true, canRetry: true });
  f.progress.recordShout();
  assert.equal(f.timers.size, 0, 'progress while failed does not spin automatic retries');
  assert.equal(JSON.parse(f.storage.getItem(BIRYONG_STORAGE_KEY)).shouts, 2);
  assert.equal(f.sync.retry(), true);
  assert.equal(f.calls[3].args.p_progress.shouts, 2);
  assert.equal(f.sync.retry(), false, 'duplicate retry cannot create another write');
  await f.finish(3, { shouts: 2 });
  assert.deepEqual(f.sync.status(), { state: 'saved', dirty: false, canRetry: false });
});

test('initial read failure is visible and retry reads server progress before migrating local progress', async () => {
  const f = fixture(); f.progress.discover(); f.progress.recordShout();
  f.sync.setAccount('A'); await f.finish(0, null, { message: 'offline' });
  assert.equal(f.sync.status().state, 'failed');
  assert.equal(f.locks.at(-1), false, 'offline read releases gameplay');
  f.progress.recordShout(); f.sync.retry();
  assert.equal(f.calls[1].name, 'get_my_biryong_progress_v1');
  await f.finish(1, { discoveredAt: 500, step: BR01_STEP.COMPLETE, shouts: 4, completedAt: 900 });
  assert.equal(f.calls[2].name, 'merge_my_biryong_progress_v1');
  assert.equal(f.calls[2].args.p_migrated_from_local, true);
  assert.equal(f.calls[2].args.p_progress.shouts, 4);
  assert.equal(f.calls[2].args.p_progress.step, BR01_STEP.COMPLETE);
  await f.finish(2); assert.equal(f.sync.status().state, 'saved');
});

test('initial merge failure retries the merge without losing migration or refetching', async () => {
  const f = fixture(); f.progress.discover(); f.sync.setAccount('A'); await f.finish(0);
  await f.finish(1, null, { message: 'offline' });
  f.sync.retry();
  assert.equal(f.calls[2].name, 'merge_my_biryong_progress_v1');
  assert.equal(f.calls[2].args.p_migrated_from_local, true);
  await f.finish(2); f.progress.recordShout(); f.tick();
  assert.equal(f.calls[3].args.p_migrated_from_local, false);
  await f.finish(3);
});

test('continuous changes cannot postpone the first save and in-flight changes coalesce to one latest save', async () => {
  const f = fixture(); await f.login();
  for (let i = 0; i < 100; i++) f.progress.recordShout();
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, 250);
  f.tick(); assert.equal(f.calls[2].args.p_progress.shouts, 100);
  for (let i = 0; i < 100; i++) f.progress.recordShout();
  assert.equal(f.calls.length, 3, 'only one merge is in flight');
  await f.finish(2, { shouts: 100 });
  assert.equal(f.progress.shouts, 200, 'late server snapshot never rolls local progress back');
  assert.equal(f.sync.status().state, 'pending');
  assert.equal(f.sync.status().dirty, true);
  f.tick(); assert.equal(f.calls[3].args.p_progress.shouts, 200);
  await f.finish(3, { shouts: 200 }); assert.equal(f.sync.status().state, 'saved');
});

test('A to B to A ignores the first A response and serializes transport across account generations', async () => {
  const f = fixture(); f.sync.setAccount('A'); f.sync.setAccount('B'); f.sync.setAccount('A');
  assert.equal(f.calls.length, 1, 'new account waits for old transport to settle');
  await f.finish(0, { discoveredAt: 500, step: BR01_STEP.COMPLETE, shouts: 99 });
  assert.equal(f.progress.shouts, 0); assert.equal(f.progress.complete, false);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].name, 'get_my_biryong_progress_v1');
  await f.finish(1); await f.finish(2); assert.equal(f.sync.status().state, 'saved');
});

test('ordinary save acknowledgement preserves an active REACTION dialogue phase', async () => {
  const f = fixture(); await f.login(); f.progress.discover(); f.progress.advance(BR01_STEP.SHOUT); f.tick();
  f.progress.advance(BR01_STEP.REACTION);
  await f.finish(2, { discoveredAt: 1000, step: BR01_STEP.SHOUT });
  assert.equal(f.progress.step, BR01_STEP.REACTION, 'save acknowledgement must not apply reload-only phase normalization');
  f.tick(); assert.equal(f.calls[3].args.p_progress.step, BR01_STEP.REACTION); await f.finish(3);
});

test('logout clears pending state and a late merge cannot touch the guest or a subsequent account', async () => {
  const f = fixture(); await f.login(); f.progress.recordShout(); f.tick();
  f.sync.setAccount(null);
  assert.deepEqual(f.sync.status(), { state: 'idle', dirty: false, canRetry: false });
  assert.equal(f.progress.localScope, 'guest'); assert.equal(f.sync.retry(), false);
  await f.finish(2, { shouts: 100 }); assert.equal(f.progress.shouts, 0);
  await f.login('B'); f.progress.recordShout(); f.sync.setAccount(null); f.tick();
  assert.equal(f.calls.length, 5, 'logout cancels the debounce');
});

test('same-account identity callbacks do not duplicate sync or clear a failure', async () => {
  const f = fixture(); f.sync.setAccount('A'); f.sync.setAccount('A');
  assert.equal(f.calls.length, 1); await f.finish(0, null, { message: 'offline' });
  f.sync.setAccount('A'); assert.equal(f.calls.length, 1); assert.equal(f.sync.status().state, 'failed');
});

test('promise rejection is recoverable; disposal cancels queued work and ignores an active response', async () => {
  const f = fixture(); f.sync.setAccount('A'); f.calls[0].reject(new Error('network')); await settle();
  assert.equal(f.sync.status().state, 'failed'); f.sync.retry(); f.sync.dispose();
  const noticeCount = f.notices.length; await f.finish(1, { shouts: 100 });
  assert.equal(f.progress.shouts, 0); assert.equal(f.notices.length, noticeCount);
  assert.equal(f.sync.retry(), false); assert.equal(f.sync.queue({ shouts: 9 }), false);
  assert.equal(f.sync.setAccount('B'), false); assert.equal(f.calls.length, 2);
  const q = fixture(); await q.login(); q.progress.recordShout(); q.sync.dispose(); q.tick();
  assert.equal(q.calls.length, 2); assert.equal(q.timers.size, 0);
});

test('first unresolved identity preserves legacy cache and guests never enqueue cloud writes', () => {
  const f = fixture(); f.progress.discover(); f.sync.setAccount(null);
  assert.equal(f.progress.discovered, true); assert.equal(f.progress.localScope, null);
  assert.equal(f.sync.queue(f.progress.snapshot()), false); assert.equal(f.calls.length, 0);
});

test('main wires progress, status, explicit retry and lifecycle disposal to the same controller', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /onProgress: snapshot => biryongCloudSync\.queue\(snapshot\)/);
  assert.match(main, /onCloudRetry: \(\) => biryongCloudSync\.retry\(\)/);
  assert.match(main, /onStatus: status => biryong\?\.setCloudSyncStatus\(status\)/);
  assert.match(main, /biryongCloudSync\.setAccount\(identity\?\.userId \?\? null\)/);
  assert.match(main, /if \(!event\.persisted\) \{\s*biryongCloudSync\.dispose\(\);\s*biryong\?\.destroy\(\)/);
});
