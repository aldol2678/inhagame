// Offline contract for supabase/functions/ranked-run-finish: a run is found only for the token
// owner, the session moves started -> submitted -> accepted/rejected exactly once, the nonce
// and the score ledger are validated, and results are recorded with the service role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, fakeSupabase, invoke, loadEdgeFunction } from './harness.mjs';

const handler = await loadEdgeFunction('ranked-run-finish');
const USER = { id: '55555555-5555-4555-8555-555555555555' };
const OTHER = { id: '66666666-6666-4666-8666-666666666666' };
const RUN = '77777777-7777-4777-8777-777777777777';
const NONCE = '88888888-8888-4888-8888-888888888888';

function setup({ elapsedMs = 30_000, status = 'started', ruleset = 'secret-2.1-r1', runType = 'ranked', owner = USER.id } = {}) {
  const backend = fakeSupabase();
  backend.addUser('player-token', USER);
  backend.addUser('other-token', OTHER);
  const now = Date.now();
  backend.rows('ranked_sessions').push({
    run_id: RUN, user_id: owner, nonce: NONCE, status, run_type: runType, ruleset_version: ruleset,
    started_at: new Date(now - elapsedMs).toISOString(), expires_at: new Date(now - elapsedMs + 5 * 60_000).toISOString(),
  });
  backend.onRpc('record_ranked_result_v4', () => ({ data: 'record-v4' }));
  backend.onRpc('record_ranked_result_v5', () => ({ data: 'record-v5' }));
  backend.onRpc('get_my_rank_v3', () => ({ data: [{ best_score: 900, overall_rank: 3, department_rank: 1, ranked_grade: 'A', general_badge: null }] }));
  return backend;
}
// A plausible ruleset 2.1 run without the detailed hit breakdown.
const run21 = (overrides = {}) => ({
  runId: RUN, nonce: NONCE, score: 600, maxCombo: 20, annyongiHits: 5, indeokiHits: 3, goldHits: 2,
  totalHits: 60, durationMs: 30_000, ...overrides,
});
// A ruleset 2.2 run whose ledger adds up: base 55 (40 normal + 5 speedy*2 + 1 indeoki*5),
// + 1 moon*2 + 10 flight base + 20 combo bonus + 0 ascension = 87.
const run22 = (overrides = {}) => ({
  runId: RUN, nonce: NONCE, score: 87, maxCombo: 30, annyongiHits: 4, indeokiHits: 1, goldHits: 0,
  normalHits: 40, speedyHits: 5, totalHits: 50, durationMs: 30_000, dragonCalls: 1, completedCalls: 1,
  moonBonusHits: 1, flightHits: 5, comboBonus: 20, flightBasePoints: 10, tier1Hits: 0, tier2Hits: 0,
  tier1GroundAward: 0, tier2GroundAward: 0, ascensionBonus: 0, ...overrides,
});
const finish = (body, token = 'player-token') => invoke(handler, { headers: bearer(token), body });
const session = (backend) => backend.rows('ranked_sessions').find((row) => row.run_id === RUN);

test('a valid ruleset 2.1 run is accepted and recorded for the token owner', async () => {
  const backend = setup();
  const res = await finish(run21({ userId: OTHER.id }));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.accepted, true);
  assert.equal(res.json.recordId, 'record-v4');
  assert.equal(res.json.overallRank, 3);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const [record] = backend.rpcCalls('record_ranked_result_v4');
  assert.equal(record.role, 'service_role');
  assert.equal(record.args.p_user_id, USER.id);
  assert.equal(record.args.p_score, 600);
  assert.equal(session(backend).status, 'submitted', 'the RPC, not the function, finalizes the session');
  assert.equal(backend.rpcCalls('get_my_rank_v3')[0].role, 'anon', 'rank is read as the player');
});

test('a ruleset 2.2 run is checked against the score ledger and recorded with v5', async () => {
  const backend = setup({ ruleset: 'secret-2.2-r1' });
  const res = await finish(run22());
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.recordId, 'record-v5');
  assert.equal(backend.rpcCalls('record_ranked_result_v5').length, 1);
});

test('QA runs are accepted without a rank lookup', async () => {
  const backend = setup({ runType: 'qa' });
  const res = await finish(run21());
  assert.equal(res.status, 200);
  assert.equal(res.json.rankEligible, false);
  assert.equal(res.json.bestScore, null);
  assert.equal(backend.rpcCalls('get_my_rank_v3').length, 0);
});

test('unauthenticated callers get 401 and nothing changes', async () => {
  const backend = setup();
  const res = await finish(run21(), 'forged-token');
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'UNAUTHENTICATED');
  assert.equal(session(backend).status, 'started');
});

test("another player's run is not found", async () => {
  const backend = setup();
  const res = await finish(run21(), 'other-token');
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'RUN_NOT_FOUND');
  assert.equal(session(backend).status, 'started');
  assert.equal(backend.writes('ranked_runs').length, 0);
});

test('a run is processed at most once', async () => {
  for (const status of ['submitted', 'accepted', 'rejected', 'expired', 'abandoned']) {
    const backend = setup({ status });
    const res = await finish(run21());
    assert.equal(res.status, 409, status);
    assert.equal(res.json.error, 'RUN_ALREADY_PROCESSED');
    assert.equal(backend.rpcCalls('record_ranked_result_v4').length, 0);
  }
});

test('a late submission expires the session', async () => {
  const backend = setup({ elapsedMs: 7 * 60_000 });
  const res = await finish(run21({ durationMs: 60_000 }));
  assert.equal(res.status, 410);
  assert.equal(res.json.error, 'RUN_EXPIRED');
  assert.equal(session(backend).status, 'expired');
});

test('invalid submissions are rejected and logged as rejected runs', async () => {
  const cases = [
    ['nonce mismatch', run21({ nonce: 'guess' }), 403, 'NONCE_MISMATCH'],
    ['run type mismatch', run21({ runType: 'qa' }), 422, 'RUN_TYPE_MISMATCH'],
    ['ruleset mismatch', run21({ rulesetVersion: 'secret-2.2-r1' }), 422, 'RULESET_MISMATCH'],
    ['negative number', run21({ score: -1 }), 422, 'INVALID_NUMERIC'],
    ['non-numeric', run21({ totalHits: 'many' }), 422, 'INVALID_NUMERIC'],
    ['too short', run21({ durationMs: 6_999 }), 422, 'DURATION_OUT_OF_RANGE'],
    ['clock mismatch', run21({ durationMs: 60_000 }), 422, 'CLOCK_MISMATCH'],
    ['too many hits', run21({ totalHits: 181 }), 422, 'TOO_MANY_HITS'],
    ['impossible combo', run21({ maxCombo: 56 }), 422, 'COMBO_IMPOSSIBLE'],
    ['score over cap', run21({ score: 1801, totalHits: 150 }), 422, 'SCORE_ABOVE_CAP'],
  ];
  for (const [name, body, status, reason] of cases) {
    const backend = setup();
    const res = await finish(body);
    assert.equal(res.status, status, `${name}: ${res.text}`);
    assert.deepEqual(res.json, { error: 'RUN_REJECTED', reason }, name);
    assert.equal(session(backend).status, 'rejected', name);
    const [rejected] = backend.writes('ranked_runs');
    assert.equal(rejected.payload.validation_status, 'rejected', name);
    assert.equal(rejected.payload.reject_reason, reason, name);
    assert.equal(rejected.payload.user_id, USER.id, name);
    assert.equal(backend.rpcCalls('record_ranked_result_v4').length, 0, name);
  }
});

test('ruleset 2.2 ledger violations are rejected', async () => {
  for (const [name, body, reason] of [
    ['ledger missing', run22({ comboBonus: undefined }), 'LEDGER_REQUIRED'],
    ['score does not add up', run22({ score: 88 }), 'SCORE_LEDGER_MISMATCH'],
    ['flight ledger', run22({ flightBasePoints: 26 }), 'FLIGHT_LEDGER_INVALID'],
    ['tier before ascension', run22({ completedCalls: 0, tier1Hits: 1, tier1GroundAward: 1 }), 'TIER1_BEFORE_ASCENSION'],
  ]) {
    setup({ ruleset: 'secret-2.2-r1' });
    const res = await finish(body);
    assert.equal(res.status, 422, `${name}: ${res.text}`);
    assert.equal(res.json.reason, reason, name);
  }
});

test('a malformed body fails without touching the session', async () => {
  const backend = setup();
  const res = await invoke(handler, { headers: bearer('player-token'), body: '{oops' });
  // Current contract: JSON errors are caught by the outer handler (500, not 400). Documented gap.
  assert.equal(res.status, 500);
  assert.equal(res.json.error, 'FINISH_FAILED');
  assert.equal(session(backend).status, 'started');
  assert.equal(backend.writes('ranked_sessions').length, 0);
});

test('CORS preflight and wrong methods', async () => {
  setup();
  assert.equal((await invoke(handler, { method: 'OPTIONS' })).status, 200);
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
});
