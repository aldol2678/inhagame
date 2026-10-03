import { MAIN2_QUEST_EVENTS, MAIN2_QUEST_ID, nextMain2QuestStage } from '../../npc-factory/main2-quest-contract.mjs';
import { assertTmlConformance } from './conformance.mjs';
import { snapshotTmlData } from './value-snapshot.mjs';

const QUEST_REF = `quest.${MAIN2_QUEST_ID}`;
let executionSequence = 0;

function fail(code, message) {
  throw Object.assign(new Error(message), { name: 'TmlWriteAdmissionError', code });
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultExecutionKey({ action }) {
  executionSequence += 1;
  return `tml-write.${action.id}.${Date.now()}.${executionSequence}`;
}

export function captureTmlAdapterMethod(adapter, method, label = method) {
  const invoke = adapter?.[method];
  if (typeof invoke !== 'function') throw new TypeError(`${label} requires a callable ${method} method`);
  const captured = { [method]: invoke.bind(adapter) };
  for (const field of ['capability', 'source']) {
    if (adapter[field] !== undefined) captured[field] = adapter[field];
  }
  return Object.freeze(captured);
}

function requiredEquality(expr, predicate, value) {
  if (expr?.op === 'and') return expr.args.some((arg) => requiredEquality(arg, predicate, value));
  return expr?.op === 'eq' && expr.subject === QUEST_REF && expr.predicate === predicate &&
    expr.value.type === (typeof value === 'boolean' ? 'boolean' : 'number') && expr.value.value === value;
}

// These are the existing Main 2 adapter's executable limits, not restrictions on
// the generic TML expression language. Unsupported compositions stay declarable.
function supportedAction(transition, actionId) {
  if (transition.actions.length !== 1) {
    fail('UNSUPPORTED_WRITE_COMPOSITION', 'candidate writes require exactly one action; action selection cannot omit other actions');
  }
  const action = transition.actions[0];
  if (actionId !== undefined && action.id !== actionId) fail('ACTION_NOT_RESOLVED', `TML action not found: ${actionId}`);
  if (action.capability !== 'world.quest.advance') fail('UNSUPPORTED_WRITE_CAPABILITY', 'candidate writes support only world.quest.advance');
  const questRef = action.args.quest?.type === 'ref' ? action.args.quest.value : null;
  const event = action.args.event?.type === 'string' ? action.args.event.value : null;
  const before = MAIN2_QUEST_EVENTS.indexOf(event) - 1;
  if (questRef !== QUEST_REF || before < 0 || nextMain2QuestStage(before, event) !== before + 1) {
    fail('WRITE_ARGUMENTS_INVALID', 'candidate writes require a supported Main 2 quest event');
  }
  if (transition.subject !== undefined && transition.subject !== questRef) {
    fail('WRITE_SUBJECT_MISMATCH', 'transition subject must match the action quest');
  }
  if (!requiredEquality(transition.precondition, 'quest.stage', before) ||
      (before === 0 && !requiredEquality(transition.precondition, 'quest.available', true))) {
    fail('UNSUPPORTED_WRITE_PRECONDITION', 'candidate writes require the corresponding Main 2 stage and start availability precondition');
  }
  const post = transition.postcondition;
  if (post.op !== 'eq' || !requiredEquality(post, 'quest.stage', before + 1)) {
    fail('UNSUPPORTED_WRITE_COMPLETION', 'candidate write completion requires the exact resulting Main 2 stage equality');
  }
  if (transition.trigger && (transition.trigger.event !== 'world.quest.event' ||
      transition.trigger.where?.quest?.type !== 'ref' || transition.trigger.where.quest.value !== questRef ||
      transition.trigger.where?.name?.type !== 'string' || transition.trigger.where.name.value !== event)) {
    fail('WRITE_TRIGGER_MISMATCH', 'transition trigger must match its Main 2 action');
  }
  return { action, questRef, event };
}

function requireQuestCapabilities(profile, readAdapter, advanceAdapter) {
  const write = profile.capabilities.find((capability) => capability.id === 'world.quest.advance');
  const read = profile.capabilities.find((capability) => capability.id === 'world.quest.read');
  if (write?.mutates !== true || write.provider_binding !== 'world.quest.store' ||
      write.verification?.predicate !== 'quest.stage' || write.verification?.authority !== 'server.quest' ||
      read?.mutates !== false || read.provider_binding !== 'world.quest.store' ||
      Object.keys(write.parameters).length !== 2 || write.parameters.quest?.type !== 'ref' || write.parameters.event?.type !== 'string' ||
      Object.keys(read.parameters).length !== 1 || read.parameters.quest?.type !== 'ref' ||
      (write.parameters.quest.entity !== undefined && write.parameters.quest.entity !== 'quest') ||
      (read.parameters.quest.entity !== undefined && read.parameters.quest.entity !== 'quest') ||
      profile.authority.find((rule) => rule.predicate === 'quest.available')?.authority !== 'server.quest') {
    fail('UNSUPPORTED_WRITE_BINDING', 'candidate writes require the existing mutating quest-store binding and quest readback capability');
  }
  if ((readAdapter.capability !== undefined && readAdapter.capability !== 'world.quest.read') ||
      (advanceAdapter.capability !== undefined && advanceAdapter.capability !== 'world.quest.advance')) {
    fail('UNSUPPORTED_WRITE_BINDING', 'quest adapter capability does not match its runtime binding');
  }
}

// Synchronous preparation deliberately performs no state/economic reads. Plan
// callers prepare all selected steps before executing the first one.
export function prepareTmlWriteTransition({
  module, profile, transitionId, actionId, context, readAdapter, advanceAdapter, traceId,
  now = () => new Date().toISOString(), createExecutionKey = defaultExecutionKey
} = {}) {
  const ownedModule = snapshotTmlData(module);
  const ownedProfile = snapshotTmlData(profile);
  const ownedContext = snapshotTmlData(context);
  assertTmlConformance(ownedModule, ownedProfile);
  if (!nonempty(transitionId)) fail('TRANSITION_ID_REQUIRED', 'candidate writes require transitionId');
  if (actionId !== undefined && !nonempty(actionId)) fail('ACTION_ID_REQUIRED', 'actionId must be a non-empty string');
  if (!nonempty(ownedContext?.userId)) throw new TypeError('verified write context requires userId');
  if (traceId !== undefined && !nonempty(traceId)) throw new TypeError('traceId must be a non-empty string');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createExecutionKey !== 'function') throw new TypeError('createExecutionKey must be a function');
  const read = captureTmlAdapterMethod(readAdapter, 'read', 'quest read adapter');
  const advance = captureTmlAdapterMethod(advanceAdapter, 'advance', 'quest advance adapter');
  requireQuestCapabilities(ownedProfile, read, advance);
  const transition = ownedModule.transitions.find((item) => item.id === transitionId);
  if (!transition) fail('TRANSITION_NOT_FOUND', `TML transition not found: ${transitionId}`);
  const { action, questRef, event } = supportedAction(transition, actionId);
  const executionKey = createExecutionKey({ module: ownedModule, profile: ownedProfile, transition, action, context: ownedContext });
  if (!nonempty(executionKey)) fail('EXECUTION_KEY_REQUIRED', 'createExecutionKey must return a non-empty string');
  return Object.freeze({
    module: ownedModule, profile: ownedProfile, context: ownedContext,
    transition, action, questRef, event, executionKey,
    readAdapter: read, advanceAdapter: advance, now, traceId
  });
}
