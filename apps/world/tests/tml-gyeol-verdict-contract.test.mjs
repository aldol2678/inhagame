import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTmlGyeolVerdictRequest,
  GYEOL_VERDICT_STATUS,
  TML_GYEOL_VERDICT_BRIDGE_CONTRACT,
  validateTmlGyeolVerdictRequest,
  validateTmlGyeolVerdictResponse
} from '../tml/runtime/gyeol-verdict-contract.mjs';

const NOW = '2026-10-04T18:30:00+09:00';

function evidence(id = 'evidence.main2.stage.post') {
  return {
    kind: 'evidence',
    id,
    claim: {
      op: 'eq',
      subject: 'quest.campus_navigation_intro_v1',
      predicate: 'quest.stage',
      value: { type: 'number', value: 9 }
    },
    observations: ['observation.main2.stage'],
    facts: ['fact.main2.stage']
  };
}

function verification(overrides = {}) {
  return {
    kind: 'verification',
    id: 'verification.main2.8_to_9.post',
    transition: 'transition.inha-world.campus_navigation_intro_v1.8_to_9',
    evidence: ['evidence.main2.stage.post'],
    status: 'SATISFIED',
    checked_at: NOW,
    ...overrides
  };
}

function request() {
  return buildTmlGyeolVerdictRequest({
    verification: verification(),
    evidence: [evidence()],
    context: {
      domain: 'quest',
      runtimeDisposition: 'VERIFIED'
    },
    policyRef: 'gyeol.inha-world.shadow@0.1',
    requestedAt: NOW
  });
}

function verdict(status = 'VERIFIED', overrides = {}) {
  return {
    schema: 'gyeol.verdict',
    version: '0.1',
    contract: TML_GYEOL_VERDICT_BRIDGE_CONTRACT,
    request_id: request().id,
    status,
    reasons: [{ code: 'REFERENCE_TEST' }],
    evidence_used: ['evidence.main2.stage.post'],
    evaluated_at: NOW,
    advisory_only: true,
    runtime_effect: 'NONE',
    persistence_effect: 'NONE',
    authority_change_allowed: false,
    mutation_requests: [],
    ...overrides
  };
}

test('P19 builds an immutable shadow-only TML→Gyeol request without conflating verification and verdict', () => {
  const built = request();

  assert.equal(built.schema, 'tml.gyeol-verdict-request');
  assert.equal(built.version, '0.1');
  assert.equal(built.contract, TML_GYEOL_VERDICT_BRIDGE_CONTRACT);
  assert.equal(built.mode, 'SHADOW_ONLY');
  assert.equal(built.verification.status, 'SATISFIED');
  assert.equal(built.boundary.tmlVerificationIsNotGyeolVerdict, true);
  assert.equal(built.boundary.advisoryOnly, true);
  assert.equal(built.boundary.runtimeEffect, 'NONE');
  assert.equal(built.boundary.persistenceEffect, 'NONE');
  assert.equal(built.boundary.authorityChangeAllowed, false);
  assert.ok(Object.isFrozen(built));
  assert.ok(Object.isFrozen(built.verification));
  assert.ok(Object.isFrozen(built.evidence));
});

test('P19 requires every Evidence id referenced by TML Verification', () => {
  assert.throws(
    () => buildTmlGyeolVerdictRequest({
      verification: verification({ evidence: ['evidence.missing'] }),
      evidence: [evidence()],
      requestedAt: NOW
    }),
    (error) => error?.code === 'VERIFICATION_EVIDENCE_MISSING'
  );
});

test('P19 preserves TML UNKNOWN and CONFLICT as inputs without inventing a Gyeol verdict mapping', () => {
  for (const status of ['UNKNOWN', 'CONFLICT']) {
    const built = buildTmlGyeolVerdictRequest({
      verification: verification({ status }),
      evidence: [evidence()],
      requestedAt: NOW
    });
    assert.equal(built.verification.status, status);
    assert.equal('status' in built && built.status, false);
  }
});

test('P19 request validator rejects contract, boundary, identity and extra-field tampering', () => {
  const base = request();
  const cases = [
    [{ ...base, mode: 'AUTHORITATIVE' }, 'INVALID_GYEOL_REQUEST_CONTRACT'],
    [{ ...base, id: 'gyeol-request.forged' }, 'GYEOL_REQUEST_ID_INVALID'],
    [{ ...base, boundary: { ...base.boundary, authorityChangeAllowed: true } }, 'GYEOL_REQUEST_BOUNDARY_INVALID'],
    [{ ...base, execute: { capability: 'world.quest.advance' } }, 'GYEOL_REQUEST_FIELD_FORBIDDEN']
  ];

  for (const [candidate, code] of cases) {
    assert.throws(
      () => validateTmlGyeolVerdictRequest(candidate),
      (error) => error?.code === code
    );
  }
});

test('P19 accepts exactly the four Gyeol verdict statuses', () => {
  for (const status of Object.values(GYEOL_VERDICT_STATUS)) {
    const response = verdict(status);
    const validated = validateTmlGyeolVerdictResponse({ request: request(), response });
    assert.equal(validated.status, status);
    assert.ok(Object.isFrozen(validated));
  }

  assert.throws(
    () => validateTmlGyeolVerdictResponse({ request: request(), response: verdict('CONFLICT') }),
    (error) => error?.code === 'INVALID_GYEOL_VERDICT_STATUS'
  );
});

test('P19 rejects evidence citations that were not supplied by TML or are duplicated', () => {
  assert.throws(
    () => validateTmlGyeolVerdictResponse({
      request: request(),
      response: verdict('VERIFIED', { evidence_used: ['evidence.external'] })
    }),
    (error) => error?.code === 'GYEOL_EVIDENCE_OUT_OF_SCOPE'
  );

  assert.throws(
    () => validateTmlGyeolVerdictResponse({
      request: request(),
      response: verdict('VERIFIED', {
        evidence_used: ['evidence.main2.stage.post', 'evidence.main2.stage.post']
      })
    }),
    (error) => error?.code === 'DUPLICATE_GYEOL_EVIDENCE_USED'
  );
});

test('P19 rejects authority, runtime, persistence, mutation and unknown execution effects', () => {
  const invalid = [
    [{ runtime_effect: 'EXECUTE' }, 'GYEOL_EFFECT_BOUNDARY_INVALID'],
    [{ persistence_effect: 'WRITE' }, 'GYEOL_EFFECT_BOUNDARY_INVALID'],
    [{ authority_change_allowed: true }, 'GYEOL_EFFECT_BOUNDARY_INVALID'],
    [{ advisory_only: false }, 'GYEOL_EFFECT_BOUNDARY_INVALID'],
    [{ mutation_requests: [{ capability: 'world.quest.advance' }] }, 'GYEOL_MUTATION_FORBIDDEN'],
    [{ execute: { capability: 'world.quest.advance' } }, 'GYEOL_RESPONSE_FIELD_FORBIDDEN']
  ];

  for (const [override, code] of invalid) {
    assert.throws(
      () => validateTmlGyeolVerdictResponse({
        request: request(),
        response: verdict('HOLD', override)
      }),
      (error) => error?.code === code
    );
  }
});

test('P19 rejects unknown reason fields instead of creating a hidden side channel', () => {
  assert.throws(
    () => validateTmlGyeolVerdictResponse({
      request: request(),
      response: verdict('HOLD', {
        reasons: [{ code: 'TEST', action: 'world.quest.advance' }]
      })
    }),
    (error) => error?.code === 'GYEOL_REASON_FIELD_FORBIDDEN'
  );
});

test('P19 revalidates a supplied request before accepting a response', () => {
  const base = request();
  assert.throws(
    () => validateTmlGyeolVerdictResponse({
      request: { ...base, boundary: { ...base.boundary, runtimeEffect: 'EXECUTE' } },
      response: verdict('VERIFIED')
    }),
    (error) => error?.code === 'GYEOL_REQUEST_BOUNDARY_INVALID'
  );
});

test('P19 is contract-only and is not wired into live gameplay or provider surfaces', () => {
  const source = readFileSync(new URL('../tml/runtime/gyeol-verdict-contract.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /grant|wallet\.(?:add|credit)|inventory\.(?:add|grant)|quest\.(?:complete|advance)\s*\(/i);
  assert.doesNotMatch(main, /gyeol-verdict-contract|gyeol\.verdict|GYEOL_VERDICT/);
  assert.doesNotMatch(runtime, /gyeol-verdict-contract|gyeol\.verdict|GYEOL_VERDICT/);
});
