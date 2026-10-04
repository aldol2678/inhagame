import { NPC_DIALOGUE_STATE } from './npc-dialogue-session.mjs';

export const NPC_DIALOGUE_RESPONSE_SOURCE = Object.freeze({
  QUEST: 'QUEST',
  AUTHORED: 'AUTHORED',
  CONTEXTUAL: 'CONTEXTUAL',
  MEMORY: 'MEMORY',
  GENERATIVE: 'GENERATIVE'
});

export const NPC_DIALOGUE_INTENT = Object.freeze({
  GREETING: 'GREETING',
  STATUS: 'STATUS',
  TOPIC: 'TOPIC',
  FOLLOW_UP: 'FOLLOW_UP',
  MEMORY_RECALL: 'MEMORY_RECALL',
  SOCIAL: 'SOCIAL',
  QUEST_HINT: 'QUEST_HINT',
  CLOSE: 'CLOSE'
});

export const NPC_DIALOGUE_CONTEXT_PRIORITY = Object.freeze({
  CURRENT_ACTIVITY: 'CURRENT_ACTIVITY',
  LAST_TOPIC: 'LAST_TOPIC',
  PLAYER_MEMORY: 'PLAYER_MEMORY',
  RELATIONSHIP: 'RELATIONSHIP',
  WEATHER: 'WEATHER',
  EVENT: 'EVENT',
  QUEST: 'QUEST'
});

const stringOrNull = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const bool = value => value === true;
const finiteOrNull = value => Number.isFinite(value) ? value : null;
const freeze = value => Object.freeze(value);

function uniqueStrings(values, max = 8) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = stringOrNull(value);
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= max) break;
  }
  return freeze(out);
}

function familiarity(memory) {
  const encounters = Number.isInteger(memory?.encounters) && memory.encounters > 0 ? memory.encounters : 0;
  if (encounters === 0) return 'FIRST';
  if (encounters === 1) return 'KNOWN';
  return 'REPEATED';
}

function tieStrength(row) {
  const bond = Number(row?.persistentBond) || 0;
  const affinity = Number(row?.affinity) || 0;
  const encounters = Number(row?.encounterCount) || 0;
  if (bond > 0 || encounters >= 2 || affinity >= 24) return 'ESTABLISHED';
  if (affinity >= 12 || encounters >= 1) return 'FAMILIAR';
  return 'WEAK';
}

function sanitizeSocialProfile(profile) {
  if (!profile) return freeze({ group: null, closeTies: freeze([]) });
  const group = profile.group ? freeze({
    groupId: stringOrNull(profile.group.groupId),
    label: stringOrNull(profile.group.label),
    status: stringOrNull(profile.group.status),
    role: stringOrNull(profile.group.role)
  }) : null;
  const closeTies = freeze((profile.closeTies ?? []).slice(0, 2).map(row => freeze({
    npcId: stringOrNull(row.npcId ?? row.otherNpcId),
    name: stringOrNull(row.name),
    strength: tieStrength(row)
  })));
  return freeze({ group, closeTies });
}

function sanitizeQuest(questState, priority) {
  const state = questState ?? {};
  return freeze({
    enabled: bool(state.enabled),
    signedIn: bool(state.signedIn),
    available: bool(state.available),
    complete: bool(state.complete),
    stage: Number.isInteger(state.stage) ? state.stage : null,
    objective: stringOrNull(state.objective),
    npcActionAvailable: bool(priority?.quest),
    sideEventAvailable: bool(priority?.sideEvent)
  });
}

function sanitizeWorld(world) {
  return freeze({
    weather: stringOrNull(world?.weather),
    environmentTime: stringOrNull(world?.environmentTime),
    placeZoneId: stringOrNull(world?.placeZoneId),
    eventId: stringOrNull(world?.eventId),
    eventPhase: stringOrNull(world?.eventPhase)
  });
}

export function buildNpcDialogueContext({
  npc,
  actor,
  rosterEntry = null,
  session,
  memoryRecord = null,
  socialProfile = null,
  questState = null,
  priority = null,
  world = null,
  generationAllowed = false,
  followUp = false
} = {}) {
  if (!npc?.npc_id || !actor?.id || npc.npc_id !== actor.id)
    throw new Error('NPC dialogue context requires matching npc and actor');
  if (!session?.state || !Object.values(NPC_DIALOGUE_STATE).includes(session.state))
    throw new Error('NPC dialogue context requires a valid session state');

  const identity = freeze({
    npcId: npc.npc_id,
    name: stringOrNull(npc.identity?.name ?? rosterEntry?.name ?? actor.name) ?? npc.npc_id,
    archetype: stringOrNull(npc.archetype),
    department: stringOrNull(rosterEntry?.department ?? npc.identity?.department),
    yearLevel: Number.isInteger(npc.identity?.year_level ?? rosterEntry?.year_level)
      ? (npc.identity?.year_level ?? rosterEntry?.year_level)
      : null,
    residence: stringOrNull(rosterEntry?.residence),
    interests: uniqueStrings(npc.interests, 4),
    traits: uniqueStrings(npc.personality?.traits, 6)
  });

  const memory = freeze({
    familiarity: familiarity(memoryRecord),
    lastPeriod: stringOrNull(memoryRecord?.lastPeriod),
    lastTopic: stringOrNull(memoryRecord?.topic)
  });

  const current = freeze({
    period: stringOrNull(actor.period),
    location: stringOrNull(actor.location),
    activity: stringOrNull(actor.activity),
    socialMode: stringOrNull(actor.social_mode),
    moving: bool(actor.moving)
  });

  const turn = freeze({
    state: session.state,
    topic: stringOrNull(session.topic),
    followUp: bool(followUp)
  });

  return freeze({
    schemaVersion: 'dialogue-context-p1',
    identity,
    current,
    world: sanitizeWorld(world),
    memory,
    social: sanitizeSocialProfile(socialProfile),
    quest: sanitizeQuest(questState, priority),
    turn,
    generationAllowed: bool(generationAllowed)
  });
}

function pushUnique(target, value) {
  if (!target.includes(value)) target.push(value);
}

export function buildNpcDialogueCandidates(context) {
  if (context?.schemaVersion !== 'dialogue-context-p1') throw new Error('Invalid NPC dialogue context');
  const sources = [];
  const intents = [];
  const priorities = [];

  pushUnique(sources, NPC_DIALOGUE_RESPONSE_SOURCE.AUTHORED);
  pushUnique(sources, NPC_DIALOGUE_RESPONSE_SOURCE.CONTEXTUAL);

  if (context.memory.familiarity !== 'FIRST' || context.memory.lastTopic)
    pushUnique(sources, NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY);
  if (context.quest.npcActionAvailable || context.quest.sideEventAvailable)
    pushUnique(sources, NPC_DIALOGUE_RESPONSE_SOURCE.QUEST);
  if (context.generationAllowed)
    pushUnique(sources, NPC_DIALOGUE_RESPONSE_SOURCE.GENERATIVE);

  switch (context.turn.state) {
    case NPC_DIALOGUE_STATE.HOME:
      pushUnique(intents, NPC_DIALOGUE_INTENT.GREETING);
      break;
    case NPC_DIALOGUE_STATE.STATUS:
      pushUnique(intents, NPC_DIALOGUE_INTENT.STATUS);
      pushUnique(intents, NPC_DIALOGUE_INTENT.SOCIAL);
      break;
    case NPC_DIALOGUE_STATE.TOPICS:
    case NPC_DIALOGUE_STATE.TOPIC_RESPONSE:
      pushUnique(intents, context.turn.followUp ? NPC_DIALOGUE_INTENT.FOLLOW_UP : NPC_DIALOGUE_INTENT.TOPIC);
      break;
    case NPC_DIALOGUE_STATE.MEMORY:
      pushUnique(intents, NPC_DIALOGUE_INTENT.MEMORY_RECALL);
      break;
    case NPC_DIALOGUE_STATE.QUEST:
      pushUnique(intents, NPC_DIALOGUE_INTENT.QUEST_HINT);
      break;
  }

  if (context.current.activity || context.current.location)
    pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.CURRENT_ACTIVITY);
  if (context.memory.lastTopic) pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.LAST_TOPIC);
  if (context.memory.familiarity !== 'FIRST') pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.PLAYER_MEMORY);
  if (context.social.group || context.social.closeTies.length)
    pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.RELATIONSHIP);
  if (context.world.weather) pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.WEATHER);
  if (context.world.eventId || context.world.eventPhase)
    pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.EVENT);
  if (context.quest.npcActionAvailable || context.quest.sideEventAvailable || context.quest.available)
    pushUnique(priorities, NPC_DIALOGUE_CONTEXT_PRIORITY.QUEST);

  return freeze({
    responseSources: freeze(sources),
    intents: freeze(intents),
    contextPriorities: freeze(priorities)
  });
}

export function resolveNpcDialogueBaseline(context) {
  const candidates = buildNpcDialogueCandidates(context);
  let responseSource = NPC_DIALOGUE_RESPONSE_SOURCE.AUTHORED;
  let intent = candidates.intents[0] ?? NPC_DIALOGUE_INTENT.CLOSE;

  if (context.turn.state === NPC_DIALOGUE_STATE.QUEST &&
      candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.QUEST)) {
    responseSource = NPC_DIALOGUE_RESPONSE_SOURCE.QUEST;
  } else if (context.turn.state === NPC_DIALOGUE_STATE.MEMORY &&
      candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY)) {
    responseSource = NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY;
  } else if (context.turn.state === NPC_DIALOGUE_STATE.STATUS) {
    responseSource = NPC_DIALOGUE_RESPONSE_SOURCE.CONTEXTUAL;
  } else if (context.turn.state === NPC_DIALOGUE_STATE.HOME &&
      candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY)) {
    responseSource = NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY;
  }

  return freeze({
    responseSource,
    intent,
    contextPriorities: candidates.contextPriorities,
    provider: 'DETERMINISTIC_BASELINE'
  });
}

export function validateNpcDialogueDecision(decision, candidates) {
  if (!decision || !candidates) return false;
  return candidates.responseSources.includes(decision.responseSource) &&
    candidates.intents.includes(decision.intent) &&
    (decision.contextPriority == null || candidates.contextPriorities.includes(decision.contextPriority));
}
