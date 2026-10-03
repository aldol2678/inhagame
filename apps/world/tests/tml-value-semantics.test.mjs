import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTmlVerifiedWriteCapabilityRegistry } from '../tml/runtime/capability-registry.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import { executeTmlVerifiedWriteTransition } from '../tml/runtime/verified-write-runtime.mjs';
import { executeTmlVerifiedWritePlan } from '../tml/runtime/verified-write-plan.mjs';
import { executeTmlRewardAwarePipeline } from '../tml/runtime/reward-aware-pipeline.mjs';
import {
  canonicalTmlData,
  canonicalTmlValue,
  sameTmlValue,
  snapshotTmlData
} from '../tml/runtime/value-snapshot.mjs';

const number = (value) => ({ type: 'number', value });
const object = (value) => ({ type: 'object', value });
const list = (value) => ({ type: 'list', value });

test('D12 canonical TML values ignore member insertion order at every object level', () => {
  assert.equal(sameTmlValue(number(5), { value: 5, type: 'number' }), true);
  const left = object({ first: number(5), nested: object({ a: number(1), b: number(2) }) });
  const right = {
    value: { nested: { value: { b: number(2), a: number(1) }, type: 'object' }, first: { value: 5, type: 'number' } },
    type: 'object'
  };
  assert.equal(sameTmlValue(left, right), true);
  assert.equal(canonicalTmlValue(left), canonicalTmlValue(right));
});

test('D12 lists, primitive variants and actual values remain distinct', () => {
  assert.equal(sameTmlValue(list([number(1), number(2)]), list([number(2), number(1)])), false);
  assert.equal(sameTmlValue(number(5), { type: 'string', value: '5' }), false);
  assert.equal(sameTmlValue(object({ a: number(1) }), object({ a: number(2) })), false);
  assert.equal(sameTmlValue(number(-0), number(0)), true);
  assert.equal(new Set([canonicalTmlData(5), canonicalTmlData('5'), canonicalTmlData(number(5))]).size, 3);
});

test('D12 canonical plain data preserves undefined and uses deterministic key ordering', () => {
  const representations = [undefined, null, 'undefined', {}, { value: undefined }, { value: null }]
    .map(canonicalTmlData);
  assert.equal(new Set(representations).size, representations.length);
  assert.notEqual(canonicalTmlData([undefined]), canonicalTmlData([null]));
  assert.equal(canonicalTmlData({ z: 1, '10': 2, '2': 3, A: 4 }), '{"10":2,"2":3,"A":4,"z":1}');
  assert.equal(canonicalTmlData({ b: { y: true, x: false }, a: [1, 2] }),
    canonicalTmlData({ a: [1, 2], b: { x: false, y: true } }));
});

test('D12 time equality retains the current lexical interpretation', () => {
  const utc = { type: 'time', value: '2026-10-03T00:00:00Z' };
  const offset = { type: 'time', value: '2026-10-03T09:00:00+09:00' };
  assert.equal(Date.parse(utc.value), Date.parse(offset.value));
  assert.equal(sameTmlValue(utc, offset), false);
  assert.equal(sameTmlValue(utc, { value: utc.value, type: 'time' }), true);
});

test('D12 malformed typed values reject without normalization', async (t) => {
  const hidden = number(5);
  Object.defineProperty(hidden, 'extra', { value: true });
  const cases = {
    'raw number': 5,
    'raw string': '5',
    'wrong number payload': { type: 'number', value: '5' },
    'missing payload': { type: 'number' },
    'extra field': { ...number(5), extra: true },
    'hidden extra field': hidden,
    'null with payload': { type: 'null', value: null },
    'empty ref': { type: 'ref', value: '' },
    'invalid time': { type: 'time', value: '2026-02-30T00:00:00Z' },
    'raw nested member': object({ raw: 5 }),
    'undefined nested member': object({ raw: undefined }),
    'NaN': number(Number.NaN),
    'Infinity': number(Infinity),
    '-Infinity': number(-Infinity)
  };
  for (const [name, value] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => canonicalTmlValue(value),
      (error) => error.code === 'INVALID_TML_VALUE'));
  }
});

test('D12 unsupported plain data rejects without invoking accessors', async (t) => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { getterCalls += 1; return 5; } });
  const cycle = {};
  cycle.self = cycle;
  const sparse = new Array(1);
  const extra = [1];
  extra.extra = true;
  const hidden = {};
  Object.defineProperty(hidden, 'extra', { value: true });
  const customArray = Object.setPrototypeOf([], Object.create(Array.prototype));
  const nullPrototypeArray = Object.setPrototypeOf([], null);
  const cases = {
    accessor,
    cycle,
    sparse,
    'extra array field': extra,
    'hidden object field': hidden,
    'symbol key': { [Symbol('key')]: 1 },
    'symbol value': { value: Symbol('value') },
    function: { value() {} },
    date: new Date('2026-10-03T00:00:00Z'),
    'custom object prototype': Object.create({ inherited: true }),
    'custom array prototype': customArray,
    'null array prototype': nullPrototypeArray,
    'array subclass': new (class extends Array {})(),
    'nonfinite number': { value: Infinity }
  };
  for (const [name, value] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => canonicalTmlData(value), TypeError));
  }
  assert.equal(getterCalls, 0);
  assert.throws(() => canonicalTmlValue({ type: 'number', get value() { getterCalls += 1; return 5; } }));
  assert.equal(getterCalls, 0);
});

test('D13 ownership remains recursive, preserves PR1 undefined and leaves caller data mutable', () => {
  const caller = { nested: { values: [{ number: 5 }], optional: undefined } };
  const owned = snapshotTmlData(caller);
  assert.equal(Object.isFrozen(owned), true);
  assert.equal(Object.isFrozen(owned.nested), true);
  assert.equal(Object.isFrozen(owned.nested.values), true);
  assert.equal(Object.isFrozen(owned.nested.values[0]), true);
  assert.equal(Object.isFrozen(caller), false);
  assert.equal(Object.isFrozen(caller.nested), false);
  caller.nested.values[0].number = 6;
  caller.nested.values.push({ number: 7 });
  caller.nested.optional = 'changed';
  assert.deepEqual(owned, { nested: { values: [{ number: 5 }], optional: undefined } });
  const nullPrototype = Object.assign(Object.create(null), { value: number(5) });
  assert.equal(canonicalTmlData(nullPrototype), canonicalTmlData({ value: number(5) }));
  assert.throws(() => snapshotTmlData(new (class extends Array {})()), TypeError);
});

test('D12 ownership cannot silently drop hidden malformed data before admission', () => {
  const caller = { nested: number(5) };
  Object.defineProperty(caller.nested, 'extra', { value: true });
  assert.throws(() => snapshotTmlData(caller), /hidden/);
  assert.equal(Object.isFrozen(caller), false);
  assert.equal(Object.isFrozen(caller.nested), false);
});

const profile = JSON.parse(readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8'));
const moduleFixture = JSON.parse(readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8'));
const transition = moduleFixture.transitions.find((item) => item.id.endsWith('.4_to_5'));
const action = transition.actions[0];
const NOW = '2026-10-03T10:50:00+09:00';

function registryHarness() {
  const counts = { dispatches: 0, mutations: 0 };
  let stage = 4;
  const questStore = async (_userId, event, questId) => {
    if (event !== 'status') {
      counts.dispatches += 1;
      counts.mutations += 1;
      stage = 5;
    }
    return { quest_id: questId, stage, available: true };
  };
  const registry = createTmlVerifiedWriteCapabilityRegistry({
    module: moduleFixture,
    profile,
    questReadAdapter: createTmlQuestReadAdapter({ questStore, now: () => NOW }),
    questAdvanceAdapter: createTmlQuestAdvanceAdapter({ questStore, now: () => NOW }),
    now: () => NOW,
    createExecutionKey: () => 'exec.pr2.arguments'
  });
  const context = { userId: 'pr2-value-user', transitionId: transition.id, actionId: action.id };
  return { registry, context, counts };
}

test('D12 equivalent action arguments with reordered members are accepted', async () => {
  const harness = registryHarness();
  const args = Object.fromEntries(Object.entries(action.args).reverse().map(([key, value]) =>
    [key, Object.fromEntries(Object.entries(value).reverse())]));
  const result = await harness.registry.invoke('world.quest.advance', args, harness.context);
  assert.equal(result.disposition, 'VERIFIED');
  assert.deepEqual(harness.counts, { dispatches: 1, mutations: 1 });
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('D12 different action argument values reject before dispatch', async () => {
  const harness = registryHarness();
  await assert.rejects(() => harness.registry.invoke('world.quest.advance',
    { ...action.args, event: { type: 'string', value: 'visit_back_gate' } }, harness.context),
  (error) => error.code === 'ACTION_ARGUMENT_MISMATCH');
  assert.deepEqual(harness.counts, { dispatches: 0, mutations: 0 });
});

test('D04 malformed action argument values reject before dispatch', async () => {
  const harness = registryHarness();
  await assert.rejects(() => harness.registry.invoke('world.quest.advance',
    { ...action.args, event: { type: 'string', value: 5 } }, harness.context),
  (error) => error.code === 'INVALID_TML_VALUE');
  assert.deepEqual(harness.counts, { dispatches: 0, mutations: 0 });
});

test('D04/D11 static copies reject hidden malformed values across transition, plan and pipeline entry points', async (t) => {
  for (const mode of ['transition', 'plan', 'pipeline']) await t.test(mode, async () => {
    const module = structuredClone(moduleFixture);
    Object.defineProperty(module.transitions.at(-1).actions[0].args.quest, 'extra', { value: true });
    const counts = { reads: 0, dispatches: 0, mutations: 0 };
    let stage = 4;
    const questStore = async (_userId, event, questId) => {
      if (event === 'status') counts.reads += 1;
      else { counts.mutations += 1; stage += 1; }
      return { quest_id: questId, stage, available: true };
    };
    const readAdapter = createTmlQuestReadAdapter({ questStore, now: () => NOW });
    const provider = createTmlQuestAdvanceAdapter({ questStore, now: () => NOW });
    const advanceAdapter = { async advance(request) { counts.dispatches += 1; return provider.advance(request); } };
    const common = { module, profile, context: { userId: 'pr2.hidden' }, now: () => NOW,
      createExecutionKey: ({ action }) => `exec.${action.id}` };
    let run;
    if (mode === 'transition') {
      run = () => executeTmlVerifiedWriteTransition({ ...common, readAdapter, advanceAdapter, transitionId: transition.id });
    } else if (mode === 'plan') {
      run = () => executeTmlVerifiedWritePlan({ ...common, readAdapter, advanceAdapter,
        transitionIds: module.transitions.slice(4).map(({ id }) => id) });
    } else {
      const rewardSpec = JSON.parse(readFileSync(new URL('../tml/fixtures/main2-navigation-reward-v1.json', import.meta.url), 'utf8'));
      const economicReader = { async read() { counts.reads += 1; return { facts: [], observations: [] }; } };
      run = () => executeTmlRewardAwarePipeline({ ...common,
        questReadAdapter: readAdapter, questAdvanceAdapter: advanceAdapter,
        walletReadAdapter: economicReader, progressionReadAdapter: economicReader,
        transitionIds: module.transitions.slice(4, -1).map(({ id }) => id),
        rewardTransitionId: module.transitions.at(-1).id, rewardSpec });
    }
    await assert.rejects(run, /hidden/);
    assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  });
});
