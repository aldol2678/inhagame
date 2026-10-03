import assert from 'node:assert/strict';
import test from 'node:test';

import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import { createTmlProgressionReadAdapter, createTmlWalletReadAdapter } from '../tml/runtime/economic-read-adapters.mjs';
import { createTmlRewardReceiptRead } from '../tml/runtime/reward-settlement.mjs';
import { createTmlTraceRecorder } from '../tml/runtime/trace.mjs';

const EAST = '2026-10-03T10:30:00+09:00';
const WEST = '2026-10-03T10:30:00-09:00';
const QUEST = 'quest.campus_navigation_intro_v1';

function recordIds(read) {
  return [...read.observations, ...read.facts].map(({ id }) => id);
}

function assertClosed(reads) {
  const trace = createTmlTraceRecorder({ id: 'trace.reference-generators', module: 'module.test', profile: 'profile.test', startedAt: EAST });
  for (const read of reads) trace.appendReadResult(read);
  const closed = trace.close(WEST);
  const ids = new Set(closed.records.map(({ id }) => id));
  assert.equal(ids.size, closed.records.length);
  for (const observation of closed.records.filter(({ kind }) => kind === 'observation')) {
    for (const id of observation.facts) {
      assert.equal(closed.records.filter((record) => record.id === id && record.kind === 'fact').length, 1);
    }
  }
  return closed;
}

test('D06 quest reader references retain lexical time and account identity without changing status reads', async () => {
  let reads = 0;
  let mutations = 0;
  async function read(userId, time) {
    const adapter = createTmlQuestReadAdapter({
      questStore: async (_userId, event, questId) => {
        if (event === 'status') reads += 1;
        else mutations += 1;
        return { quest_id: questId, stage: 4, available: true };
      },
      now: () => time
    });
    return adapter.read({ userId, questRef: QUEST });
  }
  const first = await read('user:a', EAST);
  const same = await read('user:a', EAST);
  const otherTime = await read('user:a', WEST);
  const otherUser = await read('user/a', EAST);
  assert.deepEqual(recordIds(first), recordIds(same));
  assert.equal(new Set([...recordIds(first), ...recordIds(otherTime), ...recordIds(otherUser)]).size, 12);
  assert.equal(assertClosed([first, same, otherTime, otherUser]).records.length, 12);
  assert.equal(reads, 4);
  assert.equal(mutations, 0);
  assert.equal(first.observedAt, EAST);
  assert.equal(otherTime.observedAt, WEST);
});

test('D06 wallet punctuation collisions remain separate facts in one closed batch', async () => {
  const adapter = createTmlWalletReadAdapter({
    readWallet: async () => ({ currencies: [{ id: 'currency.a/b', balance: 5 }, { id: 'currency.a-b', balance: 6 }] }),
    now: () => EAST
  });
  const read = await adapter.read({ userId: 'user.wallet' });
  assert.equal(new Set(recordIds(read)).size, 4);
  assert.deepEqual(read.facts.map(({ subject, value }) => [subject, value.value]), [
    ['wallet.currency.a/b', 5], ['wallet.currency.a-b', 6]
  ]);
  assert.equal(assertClosed([read]).records.length, 4);
});

test('D06 economic reader references distinguish formerly colliding timestamp offsets', async () => {
  const progression = {
    totalExp: 100, level: 2, currentLevelStartExp: 100, nextLevelExp: 300,
    progressExp: 0, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false
  };
  const reads = [];
  for (const time of [EAST, WEST]) {
    reads.push(await createTmlWalletReadAdapter({
      readWallet: async () => ({ currencies: [{ id: 'currency.induck_coin', balance: 180 }] }),
      now: () => time
    }).read({ userId: 'user.economy' }));
    reads.push(await createTmlProgressionReadAdapter({
      readProgression: async () => progression,
      now: () => time
    }).read({ userId: 'user.economy' }));
  }
  assert.equal(new Set(reads.flatMap(recordIds)).size, 12);
  assert.equal(assertClosed(reads).records.length, 12);
});

function receipt(transactionId, entries = [
  { grantType: 'CURRENCY', targetId: 'currency.induck_coin', granted: 180, status: 'GRANTED' },
  { grantType: 'EXP', targetId: 'exp.campus', granted: 100, status: 'GRANTED' }
]) {
  return {
    rewardId: 'reward.quest.navigation_intro', rewardVersion: 1,
    rewardTransactionId: transactionId, status: 'SUCCESS', replayed: false, entries
  };
}

test('D06 reward references retain original receipt identities without attributing effects', () => {
  const first = createTmlRewardReceiptRead({ reward: receipt('tx:a'), observedAt: EAST });
  const same = createTmlRewardReceiptRead({ reward: receipt('tx:a'), observedAt: EAST });
  const second = createTmlRewardReceiptRead({ reward: receipt('tx/a'), observedAt: EAST });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(recordIds(first), recordIds(same));
  assert.equal(new Set([...recordIds(first), ...recordIds(second)]).size, 20);
  assert.equal(assertClosed([first, same, second]).records.length, 20);
});

test('D06 receipt grant reference tuples preserve the original type and target fields', () => {
  // This tests reference encoding only; settlement admission still restricts
  // supported grants and full receipt/effect binding remains separate work.
  const read = createTmlRewardReceiptRead({
    reward: receipt('tx.grants', [
      { grantType: 'CURRENCY', targetId: 'currency.a/b', granted: 5, status: 'GRANTED' },
      { grantType: 'CURRENCY', targetId: 'currency.a-b', granted: 6, status: 'GRANTED' },
      { grantType: 'currency', targetId: 'currency.a/b', granted: 5, status: 'GRANTED' }
    ]),
    observedAt: EAST
  });
  const grants = read.facts.filter(({ predicate }) => predicate === 'reward.granted');
  assert.equal(grants.length, 3);
  assert.equal(new Set(grants.map(({ id }) => id)).size, 3);
  assert.equal(assertClosed([read]).records.length, 12);
});
