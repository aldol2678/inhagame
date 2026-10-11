import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INCOME_CANDIDATE_POLICY, INCOME_QUEST_CANDIDATES, getNpcIncomeQuestCandidates } from '../src/income/income-catalog.mjs';
import { getQuestDefinition, listQuestDefinitions } from '../src/quest/quest-registry.js';
import { createIncomeService, createIncomeRpc } from '../server/income-service.mjs';
const user = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const definition = INCOME_QUEST_CANDIDATES[0];

test('candidate definition and explicit giver do not activate generated NPCs or live journal', () => {
  assert.equal(INCOME_CANDIDATE_POLICY.status, 'CLOSED');
  assert.equal(INCOME_CANDIDATE_POLICY.balanceValidated, false);
  assert.equal(listQuestDefinitions({ type: 'SIDE' }).length, 0);
  assert.equal(listQuestDefinitions({ type: 'SIDE', includeCandidates: true }).length, 2);
  assert.equal(getQuestDefinition(definition.questId).giverId, 'INKYUNG-NPC-013');
  assert.deepEqual(getNpcIncomeQuestCandidates('INKYUNG-NPC-013'), []);
  assert.equal(getNpcIncomeQuestCandidates('INKYUNG-NPC-013', { includeClosed: true }).length, 1);
  assert.deepEqual(getNpcIncomeQuestCandidates('INKYUNG-NPC-012', { includeClosed: true }), []);
  const repaired = JSON.parse(fs.readFileSync(new URL('../npc-factory/data/repaired/INKYUNG-20-A-R1.json', import.meta.url)));
  const npc = repaired.npcs.find(n => n.npc_id === definition.giverId);
  assert.equal(npc.constraints.can_start_quest, false);
  assert.deepEqual(npc.personality.traits, ['playful', 'generous']);
  assert.ok(npc.interests.includes('cooking'));
  const roster = JSON.parse(fs.readFileSync(new URL('../npc-factory/data/fixtures/public-roster.json', import.meta.url)));
  assert.equal(roster.npcs.find(n => n.npc_id === definition.giverId).department, '생명과학과');
  assert.equal(definition.acquisition.runtimeReady, false);
});

test('server derives actor/giver and does not accept money, clock, result or other actor', async () => {
  const calls = [];
  const service = createIncomeService({ enabled: true, verifyUser: async () => user, rpc: async (...args) => calls.push(args) });
  const body = { op: 'start', questId: definition.questId, requestId };
  await service('Bearer verified', body);
  assert.deepEqual(calls[0], ['world_income_start_v1', { p_user: user, p_quest_id: definition.questId, p_giver_id: definition.giverId, p_request_id: requestId }]);
  for (const field of ['accountId', 'userId', 'giverId', 'coin', 'quantity', 'finished', 'now', 'rewardPlan']) {
    await assert.rejects(service('Bearer verified', { ...body, [field]: 'forged' }), { message: 'INVALID_REQUEST' });
  }
  assert.equal(calls.length, 1);
});

test('closed service permits historical recovery only, failed authentication never calls RPC', async () => {
  const calls = [];
  const service = createIncomeService({ verifyUser: async () => user, rpc: async (...args) => calls.push(args) });
  await assert.rejects(service('', { op: 'complete', sessionId: session, requestId }), { message: 'INCOME_UNAVAILABLE' });
  await service('', { op: 'status', sessionId: session });
  assert.equal(calls[0][0], 'world_income_status_v1');
  const unauth = createIncomeService({ enabled: true, verifyUser: async () => null, rpc: async () => assert.fail() });
  await assert.rejects(unauth('', { op: 'status' }), { message: 'AUTH_REQUIRED' });
});

test('step uses bounded revision and identity, no arbitrary action or completion field', async () => {
  const calls = [];
  const service = createIncomeService({ enabled: true, verifyUser: async () => user, rpc: async (...args) => calls.push(args) });
  const body = { op: 'step', sessionId: session, stepId: `${session}:1`, choiceId: 'option_b', requestId, revision: 1 };
  await service('', body);
  assert.equal(calls[0][1].p_action, 'checkout');
  for (const extra of [{ revision: 3 }, { stepId: `${session}:0` }, { choiceId: {} }, { complete: true }]) {
    await assert.rejects(service('', { ...body, ...extra }), { message: 'INVALID_REQUEST' });
  }
  assert.equal(calls.length, 1);
});

test('uncertain RPC error is sanitized with no automatic retry', async () => {
  let count = 0;
  const rpc = createIncomeRpc({ url: 'https://example.invalid', serviceKey: 'test-only', fetcher: async () => { count++; throw new Error('private details'); } });
  await assert.rejects(rpc('world_income_finish_v1', {}), { message: 'INCOME_UNAVAILABLE', status: 503 });
  assert.equal(count, 1);
});

const { normalizeConvenienceIncomeSnapshot, createConvenienceIncomeTransport } = await import('../src/income/income-client-adapter.mjs');
const preview = { questId: 'quest.side.convenience_help', enabled: false, coin: 30, sessionId: null, state: null, receipt: null,
  budget: { remainingCoin: 60, remainingShifts: 1, budgetDate: '2026-10-11' } };
test('server preview normalizes CLOSED, unassigned NPC, reward budget before work', () => {
  const result = normalizeConvenienceIncomeSnapshot(preview);
  assert.equal(result.enabled, false);
  assert.equal(result.posting.baseCoin, 30);
  assert.match(result.posting.npcLabel, /배정 미확정/);
  assert.equal(result.posting.remainingCoin, 60);
  for (const invalid of [{ ...preview, coin: undefined }, { ...preview, enabled: true, questId: definition.questId }, { ...preview, budget: { ...preview.budget, remainingShifts: 2 } }]) {
    assert.throws(() => normalizeConvenienceIncomeSnapshot(invalid), /INVALID_INCOME_SNAPSHOT/);
  }
});
test('transport pins shift status and never leaks local account identity to authority', async () => {
  const sent = [];
  const transport = createConvenienceIncomeTransport({ request: async body => { sent.push(body); return preview; } });
  await transport.status({ accountId: user });
  await transport.start({ accountId: user, requestId });
  assert.deepEqual(sent, [{ op: 'status', questId: 'quest.side.convenience_help' }, { op: 'start', questId: 'quest.side.convenience_help', requestId }]);
});
test('expired readback is explicit and settled receipt requires matching identity', () => {
  const expired = normalizeConvenienceIncomeSnapshot({ ...preview, sessionId: session, revision: 1, state: 'EXPIRED' });
  assert.equal(expired.session.status, 'EXPIRED');
  assert.equal(expired.session.step, null);
  assert.throws(() => normalizeConvenienceIncomeSnapshot({ ...preview, sessionId: session, revision: 3, state: 'SETTLED' }), /INVALID_INCOME_SNAPSHOT/);
  const settled = normalizeConvenienceIncomeSnapshot({ ...preview, sessionId: session, revision: 3, state: 'SETTLED', receipt: { sessionId: session, settlementId: session, coin: 30, committed: true } });
  assert.equal(settled.receipt.coin, 30);
  assert.equal(settled.posting.remainingShifts, 1); // next-day budget can reopen a posting
});

const { createConvenienceJobClient } = await import('../src/income/convenience-job-client.mjs');
test('client → normalized transport → verified-actor service contract completes only from receipt readback (mock RPC)', async () => {
  let raw = { ...preview, enabled: true }, paid = 0, requestSequence = 0;
  const makeStep = revision => ({ id: `${session}:${revision}`, action: ['stock', 'checkout', 'tidy'][revision], prompt: '서버 제시 작업', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  const service = createIncomeService({ enabled: true, verifyUser: async () => user, rpc: async (name, args) => {
    assert.equal(args.p_user, user);
    if (name === 'world_income_start_v1') raw = { ...raw, sessionId: session, revision: 0, state: 'ACTIVE', nextChallenge: makeStep(0) };
    else if (name === 'world_income_action_v1') {
      assert.equal(args.p_session_id, session); assert.equal(args.p_revision, raw.revision);
      raw = { ...raw, revision: raw.revision + 1 };
      raw.state = raw.revision === 3 ? 'READY_TO_SETTLE' : 'ACTIVE';
      raw.nextChallenge = raw.revision === 3 ? null : makeStep(raw.revision);
    } else if (name === 'world_income_finish_v1') raw = { ...raw, state: 'SETTLED', receipt: { sessionId: session, settlementId: session, coin: 30, committed: true } };
    else { assert.equal(name, 'world_income_status_v1'); assert.equal(args.p_quest_id, 'quest.side.convenience_help'); }
    return raw;
  } });
  const client = createConvenienceJobClient({ enabled: true, makeRequestId: () => `33333333-3333-4333-8333-${String(++requestSequence).padStart(12, '0')}`,
    transport: createConvenienceIncomeTransport({ request: body => service('Bearer test', body) }), onCommitted: receipt => { paid += receipt.coin; } });
  await client.setAccount(user);
  await client.start();
  assert.equal(client.state().phase, 'WORKING');
  for (let i = 0; i < 3; i++) await client.choose('a');
  assert.equal(client.state().phase, 'CHECKOUT'); assert.equal(paid, 0);
  await client.complete();
  assert.equal(client.state().phase, 'CONFIRMED'); assert.equal(paid, 30);
  await client.refresh(); assert.equal(paid, 30);
});
test('authoritative material rejection is recoverable, not an ambiguous payment failure', async () => {
  for (const [message, code] of [['INSUFFICIENT_QUANTITY', 'INCOME_INSUFFICIENT_MATERIAL'], ['INPUT_UNAVAILABLE', 'INCOME_MATERIAL_UNAVAILABLE']]) {
    const rpc = createIncomeRpc({ url: 'http://127.0.0.1:54321', serviceKey: 'test-only', fetcher: async () => ({ ok: false, json: async () => ({ message }) }) });
    await assert.rejects(rpc('world_income_finish_v1', {}), { code, status: 409 });
  }
});
