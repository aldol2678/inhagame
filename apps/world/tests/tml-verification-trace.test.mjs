import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTmlTraceRecorder } from '../tml/runtime/trace.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import {
  evaluateTmlExpression,
  TML_VERIFICATION_STATUS,
  verifyTmlTransition
} from '../tml/runtime/verification.mjs';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

const QUEST_REF = 'quest.campus_navigation_intro_v1';
const NOW = '2026-10-03T10:30:00+09:00';

function fact(id, value, source = 'server.quest') {
  return {
    kind: 'fact',
    id,
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value },
    source,
    observed_at: NOW,
    confidence: 1
  };
}

test('P4 authoritative atomic verification yields SATISFIED / UNSATISFIED / UNKNOWN / CONFLICT', () => {
  const claim = {
    op: 'eq',
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: 4 }
  };

  assert.equal(
    evaluateTmlExpression(claim, [fact('fact.ok', 4)], profile).status,
    TML_VERIFICATION_STATUS.SATISFIED
  );
  assert.equal(
    evaluateTmlExpression(claim, [fact('fact.no', 5)], profile).status,
    TML_VERIFICATION_STATUS.UNSATISFIED
  );
  assert.equal(
    evaluateTmlExpression(claim, [], profile).status,
    TML_VERIFICATION_STATUS.UNKNOWN
  );
  assert.equal(
    evaluateTmlExpression(claim, [fact('fact.a', 4), fact('fact.b', 5)], profile).status,
    TML_VERIFICATION_STATUS.CONFLICT
  );
});

test('P4 client fallback fact cannot impersonate server.quest authority', () => {
  const claim = {
    op: 'eq',
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: 4 }
  };
  const result = evaluateTmlExpression(claim, [fact('fact.client', 4, 'world.client')], profile);

  assert.equal(result.status, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.reason, 'AUTHORITATIVE_FACT_MISSING');
});

test('P4 boolean composition preserves uncertainty and contradiction', () => {
  const availableTrue = {
    kind: 'fact',
    id: 'fact.available',
    subject: QUEST_REF,
    predicate: 'quest.available',
    value: { type: 'boolean', value: true },
    source: 'server.quest',
    observed_at: NOW,
    confidence: 1
  };

  const andClaim = {
    op: 'and',
    args: [
      { op: 'eq', subject: QUEST_REF, predicate: 'quest.stage', value: { type: 'number', value: 4 } },
      { op: 'eq', subject: QUEST_REF, predicate: 'quest.available', value: { type: 'boolean', value: true } }
    ]
  };

  assert.equal(
    evaluateTmlExpression(andClaim, [fact('fact.stage', 4), availableTrue], profile).status,
    TML_VERIFICATION_STATUS.SATISFIED
  );
  assert.equal(
    evaluateTmlExpression(andClaim, [availableTrue], profile).status,
    TML_VERIFICATION_STATUS.UNKNOWN
  );
});

test('P4 turns P3 quest read output into Evidence + Verification for a real Main 2 transition', async () => {
  const adapter = createTmlQuestReadAdapter({
    questStore: async (_userId, event, questId) => {
      assert.equal(event, 'status');
      return { quest_id: questId, stage: 4, available: true };
    },
    now: () => NOW
  });

  const readResult = await adapter.read({ userId: 'p4-user', questRef: QUEST_REF });
  const transition = moduleFixture.transitions.find((item) => item.id.endsWith('.4_to_5'));

  const pre = verifyTmlTransition({
    transition,
    profile,
    observations: readResult.observations,
    facts: readResult.facts,
    checkedAt: NOW,
    phase: 'precondition'
  });
  const post = verifyTmlTransition({
    transition,
    profile,
    observations: readResult.observations,
    facts: readResult.facts,
    checkedAt: NOW,
    phase: 'postcondition'
  });

  assert.equal(pre.status, TML_VERIFICATION_STATUS.SATISFIED);
  assert.equal(post.status, TML_VERIFICATION_STATUS.UNSATISFIED);

  assert.deepEqual(pre.evidence.facts.length, 1);
  assert.deepEqual(pre.evidence.observations.length, 1);
  assert.equal(pre.verification.transition, transition.id);
  assert.deepEqual(pre.verification.evidence, [pre.evidence.id]);
  assert.equal(pre.verification.checked_at, NOW);
});

test('P4 trace records P3 observations/facts then evidence/verification without inventing action success', async () => {
  const adapter = createTmlQuestReadAdapter({
    questStore: async (_userId, _event, questId) => ({ quest_id: questId, stage: 4, available: true }),
    now: () => NOW
  });
  const readResult = await adapter.read({ userId: 'p4-user', questRef: QUEST_REF });
  const transition = moduleFixture.transitions.find((item) => item.id.endsWith('.4_to_5'));
  const verificationResult = verifyTmlTransition({
    transition,
    profile,
    observations: readResult.observations,
    facts: readResult.facts,
    checkedAt: NOW,
    phase: 'precondition'
  });

  const recorder = createTmlTraceRecorder({
    id: 'trace.main2.precondition',
    module: moduleFixture.id,
    profile: profile.id,
    startedAt: NOW
  });
  recorder.appendReadResult(readResult);
  recorder.appendVerificationResult(verificationResult);
  const trace = recorder.close('2026-10-03T10:30:01+09:00');

  assert.equal(trace.schema, 'tml.trace');
  assert.equal(trace.version, '0.1');
  assert.equal(trace.module, moduleFixture.id);
  assert.equal(trace.profile, profile.id);
  assert.equal(trace.records.filter((record) => record.kind === 'observation').length, 2);
  assert.equal(trace.records.filter((record) => record.kind === 'fact').length, 2);
  assert.equal(trace.records.filter((record) => record.kind === 'evidence').length, 1);
  assert.equal(trace.records.filter((record) => record.kind === 'verification').length, 1);
  assert.equal(trace.records.filter((record) => record.kind === 'action').length, 0);
  assert.equal(trace.records.at(-1).status, TML_VERIFICATION_STATUS.SATISFIED);
});

test('closed P4 trace is immutable to further append attempts', () => {
  const recorder = createTmlTraceRecorder({
    id: 'trace.closed',
    module: moduleFixture.id,
    profile: profile.id,
    startedAt: NOW
  });
  recorder.close('2026-10-03T10:30:01+09:00');

  assert.throws(
    () => recorder.append({ kind: 'fact', id: 'fact.too-late' }),
    /already closed/
  );
});
