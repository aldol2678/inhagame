import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createMain2QuestClient } from '../npc-factory/main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import {
  TML_MAIN2_SHADOW_REWARD,
  TML_MAIN2_SHADOW_TRANSITIONS
} from '../tml/runtime/main2-shadow-contract.mjs';
import {
  createTmlMain2Shadow,
  TML_MAIN2_SHADOW_STATUS
} from '../tml/runtime/main2-shadow.mjs';

const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);
const rewardSpec = JSON.parse(
  readFileSync(new URL('../tml/fixtures/main2-navigation-reward-v1.json', import.meta.url), 'utf8')
);

const NOW = '2026-10-03T11:55:00+09:00';

const rewardReceipt = Object.freeze({
  rewardId: 'reward.quest.navigation_intro',
  rewardVersion: 1,
  rewardTransactionId: 'tx-shadow',
  status: 'SUCCESS',
  replayed: false,
  completedAt: NOW,
  entries: [
    {
      grantType: 'CURRENCY',
      targetId: 'currency.induck_coin',
      requested: 180,
      granted: 180,
      status: 'GRANTED',
      reason: null
    },
    {
      grantType: 'EXP',
      targetId: 'exp.campus',
      requested: 100,
      granted: 100,
      status: 'GRANTED',
      reason: null
    }
  ]
});

test('P9 shadow transition/reward contract stays aligned with TML fixtures', () => {
  assert.equal(TML_MAIN2_SHADOW_TRANSITIONS.length, moduleFixture.transitions.length);
  assert.deepEqual(
    TML_MAIN2_SHADOW_TRANSITIONS.map(({ from, to, event, transitionId }) => ({ from, to, event, transitionId })),
    moduleFixture.transitions.map((transition, index) => ({
      from: index,
      to: index + 1,
      event: transition.actions[0].args.event.value,
      transitionId: transition.id
    }))
  );

  assert.equal(TML_MAIN2_SHADOW_REWARD.specId, rewardSpec.id);
  assert.equal(TML_MAIN2_SHADOW_REWARD.rewardId, rewardSpec.reward_id);
  assert.equal(TML_MAIN2_SHADOW_REWARD.rewardVersion, rewardSpec.reward_version);
  assert.deepEqual(
    TML_MAIN2_SHADOW_REWARD.grants,
    rewardSpec.grants.map((grant) => ({
      grantType: grant.grant_type,
      targetId: grant.target_id,
      amount: grant.amount
    }))
  );
});

test('P9 shadow matches the full observed Main 2 transition sequence without issuing writes', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  for (let stage = 0; stage < 9; stage += 1) {
    const expected = TML_MAIN2_SHADOW_TRANSITIONS[stage];
    const final = stage === 8;
    const report = shadow.observeQuestResult({
      event: expected.event,
      previousStage: stage,
      previousAvailable: true,
      result: {
        quest_id: MAIN2_QUEST_ID,
        stage: stage + 1,
        available: true,
        ...(final ? { reward: rewardReceipt } : {})
      },
      economicBefore: { walletBalance: 0, totalExp: 100 }
    });

    assert.equal(report.status, TML_MAIN2_SHADOW_STATUS.MATCH);
    assert.equal(report.transitionId, expected.transitionId);
    if (final) assert.equal(report.rewardStatus, TML_MAIN2_SHADOW_STATUS.PENDING);
  }

  const midway = shadow.observeEconomicState({ walletBalance: 180, totalExp: 100 });
  assert.equal(midway.rewardStatus, TML_MAIN2_SHADOW_STATUS.PENDING);

  const settled = shadow.observeEconomicState({ walletBalance: 180, totalExp: 200 });
  assert.equal(settled.status, TML_MAIN2_SHADOW_STATUS.MATCH);
  assert.equal(settled.rewardStatus, TML_MAIN2_SHADOW_STATUS.MATCH);
  assert.equal(settled.walletDelta, 180);
  assert.equal(settled.expDelta, 100);

  const status = shadow.status();
  assert.equal(status.pendingReward, false);
  assert.equal(status.mismatches, 0);
  assert.equal(status.latest.rewardReason, 'TML_SETTLEMENT_MATCH');
});

test('P9 shadow reports transition mismatch but never mutates or invents the next stage', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });

  const report = shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 4,
    previousAvailable: true,
    result: { quest_id: MAIN2_QUEST_ID, stage: 5, available: true }
  });

  assert.equal(report.status, TML_MAIN2_SHADOW_STATUS.MISMATCH);
  assert.equal(report.expectedEvent, 'resume_auto_building5');
  assert.equal(report.expectedStage, 5);
  assert.equal(report.actualStage, 5);
  assert.equal(shadow.status().mismatches, 1);
});

test('P9 reward receipt mismatch is visible before economic readback', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  const report = shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: { ...rewardReceipt, rewardVersion: 2 }
    },
    economicBefore: { walletBalance: 0, totalExp: 100 }
  });

  assert.equal(report.status, TML_MAIN2_SHADOW_STATUS.MISMATCH);
  assert.equal(report.rewardStatus, TML_MAIN2_SHADOW_STATUS.MISMATCH);
  assert.equal(shadow.status().pendingReward, false);
});

test('P9 shadow keeps settlement pending while only one authority has refreshed', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 40, totalExp: 120 });
  shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: rewardReceipt
    },
    economicBefore: { walletBalance: 40, totalExp: 120 }
  });

  const walletFirst = shadow.observeEconomicState({ walletBalance: 220, totalExp: 120 });
  assert.equal(walletFirst.rewardStatus, TML_MAIN2_SHADOW_STATUS.PENDING);
  assert.equal(shadow.status().pendingReward, true);

  const complete = shadow.observeEconomicState({ walletBalance: 220, totalExp: 220 });
  assert.equal(complete.rewardStatus, TML_MAIN2_SHADOW_STATUS.MATCH);
  assert.equal(shadow.status().pendingReward, false);
});

test('P9 shadow flags a real economic mismatch after authoritative readback', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });
  shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: rewardReceipt
    },
    economicBefore: { walletBalance: 0, totalExp: 100 }
  });

  const mismatch = shadow.observeEconomicState({ walletBalance: 100, totalExp: 200 });
  assert.equal(mismatch.rewardStatus, TML_MAIN2_SHADOW_STATUS.MISMATCH);
  assert.equal(mismatch.walletDelta, 100);
  assert.equal(mismatch.expDelta, 100);
  assert.equal(shadow.status().mismatches, 1);
});

test('Main 2 client shadow callback exceptions cannot block authoritative quest progress', async () => {
  let stage = 0;
  const seen = [];
  const client = createMain2QuestClient({
    enabled: true,
    endpoint: '/quest',
    getSession: async () => 'token',
    fetcher: async (_url, init) => {
      const { event } = JSON.parse(init.body);
      if (event === 'status') return {
        ok: true,
        json: async () => ({ quest_id: MAIN2_QUEST_ID, stage, available: true })
      };
      if (event === 'start' && stage === 0) stage = 1;
      return {
        ok: true,
        json: async () => ({ quest_id: MAIN2_QUEST_ID, stage, available: true })
      };
    },
    onServerResult: observation => {
      seen.push(observation);
      if (observation.event === 'start') throw new Error('shadow exploded');
    }
  });

  await client.setSignedIn(true);
  const result = await client.startFromGuide();

  assert.equal(result.stage, 1);
  assert.equal(client.stage, 1);
  assert.deepEqual(seen.map((item) => item.event), ['status', 'start']);
  assert.equal(seen[1].previousStage, 0);
});

test('P9 production wiring enables memory-only shadow and feeds existing economic readbacks', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(runtime, /createTmlMain2Shadow\(\{ enabled: tmlShadowEnabled \}\)/);
  assert.match(runtime, /onServerResult: observation => \{/);
  assert.match(runtime, /economicBefore: getTmlShadowEconomicState\?\.\(\) \?\? \{\}/);
  assert.match(runtime, /observeTmlShadowEconomicState: snapshot =>/);
  assert.match(runtime, /tml_main2_shadow: tmlMain2Shadow\.status\(\)/);

  assert.match(main, /tmlShadowEnabled: true/);
  assert.match(main, /getTmlShadowEconomicState: \(\) => \(\{[\s\S]*?walletBalance: wallet\.balance\(\)[\s\S]*?totalExp: progression\.snapshot\?\.totalExp/);
  assert.match(main, /progression\.onChange\([\s\S]*?observeTmlShadowEconomicState/);
  assert.match(main, /wallet\.onChange\([\s\S]*?observeTmlShadowEconomicState/);
  assert.doesNotMatch(runtime, /log_.*tml|fetch\([^)]*tml|rpc\([^)]*tml/i);
});
