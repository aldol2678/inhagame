import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAIN2_QUEST_ID, nextMain2QuestStage } from '../npc-factory/main2-quest-contract.mjs';
import { validateTmlModule } from '../tml/runtime/conformance.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import { executeTmlVerifiedWriteTransition } from '../tml/runtime/verified-write-runtime.mjs';
import { prepareTmlWriteTransition } from '../tml/runtime/write-admission.mjs';

const fixture = JSON.parse(readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8'));
const profileFixture = JSON.parse(readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8'));
const NOW = '2026-10-03T12:00:00+09:00';

function harness() {
  const counts = { reads: 0, dispatches: 0, mutations: 0 };
  let stage = 4;
  const questStore = async (_userId, event, questId) => {
    if (event === 'status') counts.reads += 1;
    else {
      counts.mutations += 1;
      stage = nextMain2QuestStage(stage, event);
    }
    return { quest_id: questId, stage, available: true };
  };
  const adapter = createTmlQuestAdvanceAdapter({ questStore, now: () => NOW });
  const module = structuredClone(fixture);
  const profile = structuredClone(profileFixture);
  const options = {
    module, profile,
    transitionId: module.transitions[4].id,
    actionId: module.transitions[4].actions[0].id,
    context: { userId: 'pr1-admission-user' },
    readAdapter: createTmlQuestReadAdapter({ questStore, now: () => NOW }),
    advanceAdapter: { async advance(request) { counts.dispatches += 1; return adapter.advance(request); } },
    now: () => NOW,
    createExecutionKey: () => 'pr1-admission-execution'
  };
  return { options, counts };
}

test('D04 malformed executable documents, values, bindings and identities never reach a read or write', async (t) => {
  const cases = [
    ['missing module id', (o) => { delete o.module.id; }],
    ['missing module transitions', (o) => { delete o.module.transitions; }],
    ['missing profile authority', (o) => { delete o.profile.authority; }],
    ['missing transition id', (o) => { delete o.module.transitions[4].id; }],
    ['missing action id', (o) => { delete o.module.transitions[4].actions[0].id; }],
    ['missing action args', (o) => { delete o.module.transitions[4].actions[0].args; }],
    ['missing postcondition', (o) => { delete o.module.transitions[4].postcondition; }],
    ['number in string value', (o) => { o.module.transitions[4].actions[0].args.event.value = 42; }],
    ['object in ref value', (o) => { o.module.transitions[4].actions[0].args.quest.value = {}; }],
    ['string in number value', (o) => { o.module.transitions[4].postcondition.value.value = '5'; }],
    ['missing expression operand', (o) => { o.module.transitions[4].postcondition = { op: 'not' }; }],
    ['extra expression field', (o) => { o.module.transitions[4].postcondition.extra = true; }],
    ['unsupported provider binding', (o) => { o.profile.capabilities[0].provider_binding = 'other.store'; }],
    ['nonmutating write declaration', (o) => { o.profile.capabilities[0].mutates = false; }],
    ['missing quest read capability', (o) => { o.profile.capabilities.splice(1, 1); }],
    ['unsupported read binding', (o) => { o.profile.capabilities[1].provider_binding = 'other.store'; }],
    ['conflicting write entity', (o) => { o.profile.capabilities[0].parameters.quest.entity = 'vehicle'; }],
    ['conflicting read entity', (o) => { o.profile.capabilities[1].parameters.quest.entity = 'vehicle'; }],
    ['wrong adapter capability', (o) => { o.advanceAdapter.capability = 'other.advance'; }],
    ['uncallable write adapter', (o) => { o.advanceAdapter.advance = true; }],
    ['uncallable read adapter', (o) => { o.readAdapter = { read: true }; }],
    ['missing requested transition', (o) => { delete o.transitionId; }],
    ['empty requested action', (o) => { o.actionId = ''; }],
    ['empty user', (o) => { o.context.userId = ''; }],
    ['invalid trace identity', (o) => { o.traceId = 42; }],
    ['uncallable clock', (o) => { o.now = null; }],
    ['empty execution key', (o) => { o.createExecutionKey = () => ''; }],
    ['whitespace execution key', (o) => { o.createExecutionKey = () => '  '; }],
    ['missing execution key', (o) => { o.createExecutionKey = () => undefined; }],
    ['numeric execution key', (o) => { o.createExecutionKey = () => 42; }],
    ['asynchronous execution key', (o) => { o.createExecutionKey = async () => 'late-key'; }]
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { options, counts } = harness();
    change(options);
    await assert.rejects(executeTmlVerifiedWriteTransition(options));
    assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  });
});

test('D05 selecting one action cannot silently discard another declared action', async (t) => {
  for (const secondCapability of ['world.quest.advance', 'world.quest.read']) await t.test(secondCapability, async () => {
    const { options, counts } = harness();
    const transition = options.module.transitions[4];
    transition.actions.push({
      id: 'call.additional', capability: secondCapability,
      args: secondCapability === 'world.quest.advance' ? structuredClone(transition.actions[0].args)
        : { quest: structuredClone(transition.actions[0].args.quest) }
    });
    await assert.rejects(executeTmlVerifiedWriteTransition(options), { code: 'UNSUPPORTED_WRITE_COMPOSITION' });
    assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  });
});

test('D05 weak or unsupported completion expressions cannot replace the required Main 2 stage effect', async (t) => {
  const stage = fixture.transitions[4].postcondition;
  const available = { op: 'eq', subject: stage.subject, predicate: 'quest.available', value: { type: 'boolean', value: true } };
  const cases = [
    ['OR bypass', { op: 'or', args: [stage, available] }],
    ['exists', { op: 'exists', subject: stage.subject, predicate: stage.predicate }],
    ['NOT', { op: 'not', arg: { ...stage, op: 'ne' } }],
    ['weak comparison', { ...stage, op: 'gte', value: { type: 'number', value: 4 } }],
    ['wrong quest', { ...stage, subject: 'quest.other' }],
    ['wrong target stage', { ...stage, value: { type: 'number', value: 4 } }],
    ['unsupported AND composition', { op: 'and', args: [stage, available] }]
  ];
  for (const [name, completion] of cases) await t.test(name, async () => {
    const { options, counts } = harness();
    options.module.transitions[4].postcondition = structuredClone(completion);
    assert.equal(validateTmlModule(options.module, options.profile).ok, true, 'generic TML still permits these expressions');
    await assert.rejects(executeTmlVerifiedWriteTransition(options), { code: 'UNSUPPORTED_WRITE_COMPLETION' });
    assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  });
});

test('PR1 binds the supported quest, event, trigger and required pre-stage without changing Main 2 ordering', async (t) => {
  const cases = [
    ['other quest', (transition) => { transition.actions[0].args.quest.value = 'quest.other'; }],
    ['status read as write', (transition) => { transition.actions[0].args.event.value = 'status'; }],
    ['unknown event', (transition) => { transition.actions[0].args.event.value = 'invented_event'; }],
    ['wrong transition subject', (transition) => { transition.subject = 'quest.other'; }],
    ['wrong trigger event name', (transition) => { transition.trigger.where.name.value = 'visit_back_gate'; }],
    ['wrong pre-stage', (transition) => { transition.precondition.value.value = 3; }],
    ['optional precondition', (transition) => { delete transition.precondition; }]
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { options, counts } = harness();
    change(options.module.transitions[4]);
    await assert.rejects(executeTmlVerifiedWriteTransition(options));
    assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  });
});

test('PR1 preparation owns plain input data and prepares the identity without observing state', async () => {
  const { options, counts } = harness();
  const prepared = prepareTmlWriteTransition(options);
  options.module.transitions[4].postcondition.value.value = 99;
  options.profile.capabilities[0].mutates = false;
  options.context.userId = 'other-user';
  assert.equal(prepared.transition.postcondition.value.value, 5);
  assert.equal(prepared.profile.capabilities[0].mutates, true);
  assert.equal(prepared.context.userId, 'pr1-admission-user');
  assert.equal(prepared.executionKey, 'pr1-admission-execution');
  assert.deepEqual(counts, { reads: 0, dispatches: 0, mutations: 0 });
  assert.equal(Object.isFrozen(options.module), false, 'the caller object is not frozen');
  assert.equal(Object.isFrozen(prepared.transition.postcondition.value), true);
});

test('PR1 legitimate Main 2 single-action fixture remains state VERIFIED after exactly one attempt', async () => {
  const { options, counts } = harness();
  const result = await executeTmlVerifiedWriteTransition(options);
  assert.deepEqual(counts, { reads: 2, dispatches: 1, mutations: 1 });
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.attempt.requestedExecutionKey, result.executionKey);
  assert.equal(result.provider.identityMatched, true);
  assert.equal(result.precondition, 'SATISFIED');
  assert.equal(result.postcondition, 'SATISFIED');
  assert.equal(result.disposition, 'VERIFIED');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(result.traceComplete, true);
  assert.equal(result.provider.output.quest_id, MAIN2_QUEST_ID);
  assert.equal(Object.hasOwn(result, 'committedEffects'), false, 'a returned provider response is not commit proof');
});
