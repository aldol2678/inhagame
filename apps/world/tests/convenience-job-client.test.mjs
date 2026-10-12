import test from 'node:test';
import assert from 'node:assert/strict';
import { createConvenienceJobClient } from '../src/income/convenience-job-client.mjs';
import { parseConvenienceJobStatus } from '../src/income/convenience-job-state.mjs';

export const posting = () => ({ enabled: true, posting: { id: 'quest.side.convenience_help', title: '편의점 짧은 근무',
  locationLabel: '위치 연결 준비 중', npcLabel: 'NPC 배정 미확정 · 개발용 계약', baseCoin: 30,
  remainingCoin: 60, remainingShifts: 1, budgetDate: '2026-10-11' }, session: null, receipt: null });
export const working = (revision = 0) => ({ ...posting(), session: { id: 'session-a', revision, status: 'ACTIVE',
  completedSteps: revision, totalSteps: 3, step: { id: `step-${revision}`, kind: ['STOCK', 'CHECKOUT', 'TIDY'][revision],
    prompt: '유통기한이 빠른 상품을 먼저 골라 주세요.', choices: [{ id: 'a', label: '오늘까지인 상품' }, { id: 'b', label: '다음 주까지인 상품' }] } } });
export const checkout = () => ({ ...posting(), session: { id: 'session-a', revision: 3, status: 'READY_TO_SETTLE', completedSteps: 3, totalSteps: 3, step: null } });
export const settled = () => ({ ...checkout(), session: { ...checkout().session, status: 'SETTLED', revision: 4 },
  receipt: { sessionId: 'session-a', settlementId: 'settlement-a', coin: 30, committed: true } });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function rig(enabled = true) {
  let data = posting(), calls = [], notices = [], behavior = {};
  const transport = Object.fromEntries(['status', 'start', 'step', 'complete'].map(method => [method, async payload => {
    calls.push({ method, payload }); return behavior[method] ? behavior[method](payload) : method === 'status' ? data : {};
  }]));
  const client = createConvenienceJobClient({ enabled, transport, makeRequestId: () => 'request-1', onCommitted: r => notices.push(r) });
  return { client, calls, notices, behavior, set data(v) { data = v; } };
}

test('closed by default and signed-out never calls transport', async () => {
  const r = rig(false); await r.client.setAccount('a'); await r.client.start(); assert.equal(r.calls.length, 0); assert.equal(r.client.state().phase, 'CLOSED');
  const s = rig(); await s.client.refresh(); assert.equal(s.calls.length, 0);
});
test('status parser strips secrets and rejects inconsistent settlement/steps', () => {
  const raw = working(); raw.seed = 'secret'; raw.session.step.answer = 'a';
  const s = parseConvenienceJobStatus(raw); assert.equal(s.seed, undefined); assert.equal(s.session.step.answer, undefined); assert.ok(Object.isFrozen(s.session.step.choices));
  for (const invalid of [ { ...settled(), receipt: null }, { ...settled(), receipt: { ...settled().receipt, committed: false } },
    { ...settled(), receipt: { ...settled().receipt, sessionId: 'wrong' } }, { ...working(), session: { ...working().session, totalSteps: 6 } } ])
    assert.equal(parseConvenienceJobStatus(invalid), null);
});
test('start sends no actor, coin, seed or completion assertion, and duplicate click is busy', async () => {
  const r = rig(), ack = defer(); await r.client.setAccount('a'); r.behavior.start = () => ack.promise;
  const first = r.client.start(); assert.deepEqual(await r.client.start(), { outcome: 'BUSY' });
  assert.deepEqual(r.calls.at(-1), { method: 'start', payload: { postingId: 'quest.side.convenience_help', requestId: 'request-1' } });
  r.data = working(); ack.resolve({ coin: 999999 }); await first; assert.equal(r.client.state().phase, 'WORKING'); assert.equal(r.notices.length, 0);
});
test('lost start response recovers server session; no mutation replay', async () => {
  const r = rig(); await r.client.setAccount('a'); r.behavior.start = () => { r.data = working(); throw new Error('network'); };
  await r.client.start(); assert.equal(r.client.state().phase, 'WORKING'); assert.equal(r.calls.filter(c => c.method === 'start').length, 1);
});
test('ambiguous unchanged readback locks mutation until a later status proves convergence', async () => {
  const r = rig(); await r.client.setAccount('a'); r.behavior.start = () => { throw new Error('network'); };
  await r.client.start(); assert.equal(r.client.state().error, 'OUTCOME_UNKNOWN'); await r.client.start(); assert.equal(r.calls.filter(c => c.method === 'start').length, 1);
  await r.client.refresh(); assert.equal(r.client.state().phase, 'RECOVERY'); r.data = working(); await r.client.refresh(); assert.equal(r.client.state().phase, 'WORKING');
});
test('wrong choice is explicitly correctable without any local reward penalty', async () => {
  const r = rig(); r.data = working(); await r.client.setAccount('a'); r.behavior.step = () => { throw { code: 'WRONG_CHOICE' }; };
  await r.client.choose('b'); assert.equal(r.client.state().phase, 'WORKING'); assert.equal(r.client.state().notice, 'WRONG_CHOICE');
  r.behavior.step = () => { r.data = working(1); }; await r.client.choose('a'); assert.equal(r.client.state().snapshot.session.completedSteps, 1);
  assert.equal(r.client.state().snapshot.posting.baseCoin, 30);
});
test('choices outside current server step and early checkout are refused', async () => {
  const r = rig(); r.data = working(); await r.client.setAccount('a'); await r.client.choose('forged'); await r.client.complete(); assert.equal(r.calls.length, 1);
});
test('commit ack alone never announces payment; readback receipt does, once', async () => {
  const r = rig(); r.data = checkout(); await r.client.setAccount('a'); r.behavior.complete = () => settled();
  r.behavior.status = () => { throw new Error('offline'); }; await r.client.complete(); assert.equal(r.client.state().phase, 'RECOVERY'); assert.equal(r.notices.length, 0);
  r.behavior.status = () => settled(); await r.client.refresh(); await r.client.refresh(); assert.equal(r.client.state().phase, 'CONFIRMED'); assert.equal(r.notices.length, 1);
});
test('older account mutation and status responses cannot affect new owner', async () => {
  const r = rig(), ack = defer(); await r.client.setAccount('a'); r.behavior.start = () => ack.promise;
  const first = r.client.start(); await r.client.setAccount('b'); ack.resolve(settled()); assert.equal((await first).outcome, 'STALE');
  assert.equal(r.client.state().accountId, 'b'); assert.equal(r.client.state().phase, 'POSTING'); assert.equal(r.notices.length, 0);
});
test('lower revision is rejected and cannot reopen old choices', async () => {
  const r = rig(); r.data = working(2); await r.client.setAccount('a'); r.data = working(1); await r.client.refresh();
  assert.equal(r.client.state().phase, 'RECOVERY'); assert.equal(r.client.state().snapshot.session.revision, 2);
});
test('reload recovers solely from server status and cannot auto-start or settle', async () => {
  const r = rig(); r.data = checkout(); await r.client.setAccount('a'); assert.equal(r.client.state().phase, 'CHECKOUT'); assert.deepEqual(r.calls.map(c => c.method), ['status']);
});
test('budget shortfall and daily count block starting', async () => {
  const r = rig(), raw = posting(); raw.posting.remainingCoin = 29; r.data = raw; await r.client.setAccount('a'); await r.client.start(); assert.equal(r.calls.length, 1);
  raw.posting.remainingCoin = 60; raw.posting.remainingShifts = 0; await r.client.refresh(); await r.client.start(); assert.equal(r.calls.length, 2);
});
test('prefixed explicit rejection allows correction but unavailable remains ambiguous', async () => {
  const r = rig(); r.data = working(); await r.client.setAccount('a');
  r.behavior.step = () => { throw { code: 'INCOME_WRONG_CHOICE' }; }; await r.client.choose('a'); assert.equal(r.client.state().phase, 'WORKING');
  r.behavior.step = () => { throw { code: 'INCOME_UNAVAILABLE' }; }; await r.client.choose('a'); assert.equal(r.client.state().phase, 'RECOVERY');
});
test('expired session is authoritative terminal state, not work or receipt', async () => {
  const r = rig(); r.data = { ...working(), session: { ...working().session, status: 'EXPIRED', step: null } };
  await r.client.setAccount('a'); assert.equal(r.client.state().phase, 'POSTING'); assert.equal(r.notices.length, 0);
  r.behavior.start = () => { r.data = { ...working(), session: { ...working().session, id: 'new-session' } }; };
  await r.client.start(); assert.equal(r.client.state().phase, 'WORKING');
});
test('new budget permits starting after prior receipt; lost ack cannot resolve against old session', async () => {
  const r = rig(); r.data = settled(); await r.client.setAccount('a');
  r.behavior.start = () => { throw new Error('network'); }; await r.client.start(); assert.equal(r.client.state().error, 'OUTCOME_UNKNOWN');
  r.data = { ...working(), session: { ...working().session, id: 'tomorrow-session' } }; await r.client.refresh(); assert.equal(r.client.state().phase, 'WORKING');
});
test('old read cannot overwrite a switched account; stale listeners cannot break readback', async () => {
  const r = rig(), old = defer(); r.behavior.status = () => old.promise;
  const a = r.client.setAccount('a'); r.behavior.status = () => working();
  r.client.subscribe(() => { throw new Error('UI failure'); }); await r.client.setAccount('b'); old.resolve(settled()); await a;
  assert.equal(r.client.state().accountId, 'b'); assert.equal(r.client.state().phase, 'WORKING'); assert.equal(r.notices.length, 0);
});
test('server CLOSED retains historical receipt without allowing new mutations', async () => {
  const r = rig(); r.data = { ...settled(), enabled: false }; await r.client.setAccount('a');
  assert.equal(r.client.state().phase, 'CONFIRMED'); assert.equal(r.client.state().snapshot.receipt.coin, 30);
  await r.client.start(); assert.equal(r.calls.length, 1);
});
test('documented Error.message fallback distinguishes definite rejection', async () => {
  const r = rig(); r.data = working(); await r.client.setAccount('a'); r.behavior.step = () => { throw new Error('INCOME_WRONG_CHOICE'); };
  await r.client.choose('b'); assert.equal(r.client.state().phase, 'WORKING'); assert.equal(r.client.state().notice, 'WRONG_CHOICE');
});
