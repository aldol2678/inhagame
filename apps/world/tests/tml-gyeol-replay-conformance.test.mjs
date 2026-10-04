import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTmlGyeolVerdictRequest,
  TML_GYEOL_VERDICT_BRIDGE_CONTRACT
} from '../tml/runtime/gyeol-verdict-contract.mjs';
import {
  createTmlGyeolMockAdapter,
  TML_GYEOL_MOCK_ADAPTER_CONTRACT
} from '../tml/runtime/gyeol-mock-adapter.mjs';
import {
  runTmlGyeolReplayConformance,
  TML_GYEOL_REPLAY_CONFORMANCE_CONTRACT
} from '../tml/runtime/gyeol-replay-conformance.mjs';

const NOW = '2026-10-04T19:10:00+09:00';

function request() {
  const evidence = {
    kind: 'evidence',
    id: 'evidence.main2.stage.post',
    claim: {
      op: 'eq',
      subject: 'quest.campus_navigation_intro_v1',
      predicate: 'quest.stage',
      value: { type: 'number', value: 9 }
    },
    observations: ['observation.main2.stage'],
    facts: ['fact.main2.stage']
  };
  return buildTmlGyeolVerdictRequest({
    verification: {
      kind: 'verification',
      id: 'verification.main2.8_to_9.post',
      transition: 'transition.inha-world.campus_navigation_intro_v1.8_to_9',
      evidence: [evidence.id],
      status: 'SATISFIED',
      checked_at: NOW
    },
    evidence: [evidence],
    context: { domain: 'quest', fixture: 'p20' },
    policyRef: 'gyeol.inha-world.shadow@0.1',
    requestedAt: NOW
  });
}

function deterministicAdapter(overrides = {}) {
  let tick = 0;
  return createTmlGyeolMockAdapter({
    now: () => `2026-10-04T19:10:0${tick++}+09:00`,
    decide: async (input) => ({
      status: 'HOLD',
      reasons: [{ code: 'MOCK_POLICY_HOLD', message: input.context.domain }],
      evidence_used: ['evidence.main2.stage.post']
    }),
    ...overrides
  });
}

test('P20 deterministic mock replay passes while evaluated_at may differ', async () => {
  const result = await runTmlGyeolReplayConformance({
    request: request(),
    adapter: deterministicAdapter(),
    attempts: 3
  });

  assert.equal(result.schema, 'tml.gyeol-replay-conformance');
  assert.equal(result.version, '0.1');
  assert.equal(result.contract, TML_GYEOL_REPLAY_CONFORMANCE_CONTRACT);
  assert.equal(result.status, 'PASS');
  assert.equal(result.mockOnly, true);
  assert.equal(result.liveAdapterInvocationAllowed, false);
  assert.equal(result.semanticReplayStable, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.outputs[0].response.status, 'HOLD');
  assert.notEqual(
    result.outputs[0].response.evaluated_at,
    result.outputs[1].response.evaluated_at
  );
  assert.deepEqual(
    result.outputs[0].projection,
    result.outputs[1].projection
  );
});

test('P20 deliberately provides no default TML verification → Gyeol verdict mapping', () => {
  assert.throws(
    () => createTmlGyeolMockAdapter(),
    (error) => error?.code === 'MOCK_DECIDE_REQUIRED'
  );
});

test('P20 detects nondeterministic semantic verdicts for the same request', async () => {
  let turn = 0;
  const adapter = createTmlGyeolMockAdapter({
    now: () => NOW,
    decide: async () => ({
      status: turn++ % 2 === 0 ? 'VERIFIED' : 'HOLD',
      reasons: [{ code: 'FLAPPING_MOCK' }],
      evidence_used: ['evidence.main2.stage.post']
    })
  });

  const result = await runTmlGyeolReplayConformance({
    request: request(),
    adapter,
    attempts: 3
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.semanticReplayStable, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'NONDETERMINISTIC_GYEOL_VERDICT'));
});

test('P20 mock responses still pass through P19 Evidence scope validation', async () => {
  const adapter = createTmlGyeolMockAdapter({
    now: () => NOW,
    decide: async () => ({
      status: 'VERIFIED',
      reasons: [{ code: 'BAD_EVIDENCE_TEST' }],
      evidence_used: ['evidence.not-supplied']
    })
  });

  const result = await runTmlGyeolReplayConformance({
    request: request(),
    adapter,
    attempts: 2
  });

  assert.equal(result.status, 'FAIL');
  assert.ok(result.diagnostics.some((item) => item.code === 'GYEOL_EVIDENCE_OUT_OF_SCOPE'));
});

test('P20 refuses live-looking adapters before invocation', async () => {
  let called = 0;
  const adapter = {
    contract: TML_GYEOL_MOCK_ADAPTER_CONTRACT,
    mockOnly: false,
    source: 'PRODUCTION',
    async evaluate() {
      called += 1;
      return {};
    }
  };

  const result = await runTmlGyeolReplayConformance({
    request: request(),
    adapter,
    attempts: 2
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(called, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'MOCK_ADAPTER_REQUIRED'));
});

test('P20 validates adapter brand at construction', () => {
  assert.throws(
    () => createTmlGyeolMockAdapter({
      mockOnly: false,
      source: 'PRODUCTION',
      decide: async () => ({})
    }),
    (error) => error?.code === 'MOCK_BRAND_REQUIRED'
  );
});

test('P20 remains effect-free and disconnected from live gameplay', () => {
  const adapterSource = readFileSync(new URL('../tml/runtime/gyeol-mock-adapter.mjs', import.meta.url), 'utf8');
  const replaySource = readFileSync(new URL('../tml/runtime/gyeol-replay-conformance.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  for (const source of [adapterSource, replaySource]) {
    assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
    assert.doesNotMatch(source, /setAuthority\s*\(|routeUser\s*\(|deploy\s*\(|grant\s*\(/i);
  }
  assert.doesNotMatch(main, /gyeol-mock-adapter|gyeol-replay-conformance|tml\.gyeol-replay-conformance/);
  assert.doesNotMatch(runtime, /gyeol-mock-adapter|gyeol-replay-conformance|tml\.gyeol-replay-conformance/);
});

test('P20 test request remains a P19 request', () => {
  assert.equal(request().contract, TML_GYEOL_VERDICT_BRIDGE_CONTRACT);
});
