import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MAIN_NPC_ID } from '../npc-factory/npc-presence.mjs';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';
import { createQuestClient } from '../npc-factory/quest-client.mjs';
import {
  createTmlFirstCampusGyeolShadow,
  TML_FIRST_CAMPUS_GYEOL_POLICY,
  TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE,
  TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS
} from '../tml/runtime/first-campus-gyeol-shadow.mjs';

const NOW = '2026-10-04T22:10:00+09:00';

test('P21 live First Campus incomplete stage yields TML UNSATISFIED + Gyeol HOLD parity', async () => {
  const shadow = createTmlFirstCampusGyeolShadow({ now: () => NOW });
  const report = await shadow.observeQuestResult({
    event: 'status',
    previousStage: 0,
    result: { quest_id: QUEST_ID, stage: 3 }
  });

  assert.equal(report.status, TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MATCH);
  assert.equal(report.legacyComplete, false);
  assert.equal(report.tmlVerification, 'UNSATISFIED');
  assert.equal(report.gyeolVerdict, 'HOLD');
  assert.equal(report.expectedVerdict, 'HOLD');
  assert.equal(report.policyRef, TML_FIRST_CAMPUS_GYEOL_POLICY);

  const status = shadow.status();
  assert.equal(status.mode, TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE);
  assert.equal(status.matches, 1);
  assert.equal(status.mismatches, 0);
  assert.equal(status.parityRatio, 1);
  assert.equal(status.authority, 'legacy-first-campus');
});

test('P21 live First Campus completion yields TML SATISFIED + Gyeol VERIFIED parity', async () => {
  const shadow = createTmlFirstCampusGyeolShadow({ now: () => NOW });
  const report = await shadow.observeQuestResult({
    event: 'talk_001',
    previousStage: 4,
    result: { quest_id: QUEST_ID, stage: 5 }
  });

  assert.equal(report.status, TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MATCH);
  assert.equal(report.legacyComplete, true);
  assert.equal(report.tmlVerification, 'SATISFIED');
  assert.equal(report.gyeolVerdict, 'VERIFIED');
  assert.match(report.requestId, /^gyeol-request\./);
  assert.match(report.evidenceId, /^evidence\.p21\.first-campus\.complete\./);
});

test('P21 malformed server result never becomes a positive shadow verdict', async () => {
  const shadow = createTmlFirstCampusGyeolShadow({ now: () => NOW });
  const report = await shadow.observeQuestResult({
    event: 'talk_001',
    previousStage: 4,
    result: { quest_id: 'wrong_quest', stage: 5 }
  });

  assert.equal(report.status, TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MISMATCH);
  assert.equal(report.reason, 'INVALID_SERVER_RESULT');
  assert.equal('gyeolVerdict' in report, false);
});

test('P21 quest client emits accepted authoritative result after generation guard', async () => {
  const observations = [];
  const responses = [
    { quest_id: QUEST_ID, stage: 0 },
    { quest_id: QUEST_ID, stage: 1 }
  ];
  const client = createQuestClient({
    enabled: true,
    endpoint: '/quest',
    getSession: async () => 'token',
    fetcher: async () => ({
      ok: true,
      async json() { return responses.shift(); }
    }),
    onServerResult: observation => observations.push(observation)
  });

  await client.setSignedIn(true);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].event, 'status');
  assert.equal(observations[0].previousStage, 0);
  assert.equal(observations[0].result.stage, 0);

  await client.advanceNpc(MAIN_NPC_ID);
  assert.equal(observations.length, 2);
  assert.equal(observations[1].event, 'start');
  assert.equal(observations[1].previousStage, 0);
  assert.equal(observations[1].result.stage, 1);
});

test('P21 observer errors never block authoritative quest progress', async () => {
  const client = createQuestClient({
    enabled: true,
    endpoint: '/quest',
    getSession: async () => 'token',
    fetcher: async () => ({
      ok: true,
      async json() { return { quest_id: QUEST_ID, stage: 0 }; }
    }),
    onServerResult: () => { throw new Error('diagnostic failure'); }
  });

  const result = await client.setSignedIn(true);
  assert.equal(result.stage, 0);
  assert.equal(client.status().ready, true);
});

test('P21 remains diagnostic-only and is wired into the NPC runtime snapshot', () => {
  const shadowSource = readFileSync(new URL('../tml/runtime/first-campus-gyeol-shadow.mjs', import.meta.url), 'utf8');
  const questClient = readFileSync(new URL('../npc-factory/quest-client.mjs', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(shadowSource, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(shadowSource, /wallet\.|inventory\.|grant\s*\(|advance_world_quest|questStore/i);
  assert.match(questClient, /onServerResult/);
  assert.match(runtime, /createTmlFirstCampusGyeolShadow/);
  assert.match(runtime, /tml_first_campus_gyeol_shadow/);
});
