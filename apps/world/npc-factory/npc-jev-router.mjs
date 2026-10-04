import {
  NPC_DIALOGUE_RESPONSE_SOURCE,
  NPC_DIALOGUE_INTENT,
  NPC_DIALOGUE_CONTEXT_PRIORITY,
  buildNpcDialogueCandidates,
  validateNpcDialogueDecision
} from './npc-dialogue-context.mjs';

export const JEV_DIALOGUE_PILOT_IDS = Object.freeze([
  'INKYUNG-NPC-001',
  'INKYUNG-NPC-002',
  'INKYUNG-NPC-021',
  'INKYUNG-NPC-022',
  'INKYUNG-NPC-023'
]);

const PILOT_IDS = new Set(JEV_DIALOGUE_PILOT_IDS);
const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const FORBIDDEN_KEYS = /^(email|userId|studentNumber|wallet|inventory|reward|accessToken|authorization)$/i;

const SOURCE_DESCRIPTION = Object.freeze({
  [NPC_DIALOGUE_RESPONSE_SOURCE.QUEST]: 'Use canonical quest or side-event content already authorized by the game.',
  [NPC_DIALOGUE_RESPONSE_SOURCE.AUTHORED]: 'Use authored NPC copy without generated language.',
  [NPC_DIALOGUE_RESPONSE_SOURCE.CONTEXTUAL]: 'Use deterministic current activity, place, time, weather, or social context.',
  [NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY]: 'Use the player-specific NPC memory summary already present in context.',
  [NPC_DIALOGUE_RESPONSE_SOURCE.GENERATIVE]: 'Escalate to the language provider for contextual wording; it still has no world authority.'
});
const INTENT_DESCRIPTION = Object.freeze({
  [NPC_DIALOGUE_INTENT.GREETING]: 'Greet or reopen conversation.',
  [NPC_DIALOGUE_INTENT.STATUS]: 'Talk about the NPC current situation.',
  [NPC_DIALOGUE_INTENT.TOPIC]: 'Discuss the selected interest topic.',
  [NPC_DIALOGUE_INTENT.FOLLOW_UP]: 'Continue the selected topic without repeating the first answer.',
  [NPC_DIALOGUE_INTENT.MEMORY_RECALL]: 'Naturally recall a previous player-NPC conversation.',
  [NPC_DIALOGUE_INTENT.SOCIAL]: 'Suggest or discuss a small social activity.',
  [NPC_DIALOGUE_INTENT.QUEST_HINT]: 'Explain or surface existing quest/event guidance.',
  [NPC_DIALOGUE_INTENT.CLOSE]: 'Close the dialogue.'
});
const PRIORITY_DESCRIPTION = Object.freeze({
  [NPC_DIALOGUE_CONTEXT_PRIORITY.CURRENT_ACTIVITY]: 'Prioritize what the NPC is doing or where they are now.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.LAST_TOPIC]: 'Prioritize the most recently discussed interest.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.PLAYER_MEMORY]: 'Prioritize prior player-NPC familiarity.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.RELATIONSHIP]: 'Prioritize relevant NPC group or close-tie context.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.WEATHER]: 'Prioritize current weather.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.EVENT]: 'Prioritize the active world event context.',
  [NPC_DIALOGUE_CONTEXT_PRIORITY.QUEST]: 'Prioritize current canonical quest state.'
});

function hasForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.test(key) || hasForbiddenKey(child));
}

function criteria(values, descriptions) {
  return Object.fromEntries(values.map(value => [value, descriptions[value] ?? value]));
}

function question(values, descriptions, instructions) {
  if (values.length < 2) return null;
  return { type: 'choice', instructions, criteria: criteria(values, descriptions) };
}

export function compactNpcDialogueJevState(context) {
  return {
    npc: {
      id: context.identity.npcId,
      archetype: context.identity.archetype,
      department: context.identity.department,
      yearLevel: context.identity.yearLevel,
      residence: context.identity.residence,
      interests: context.identity.interests,
      traits: context.identity.traits
    },
    current: context.current,
    world: context.world,
    memory: context.memory,
    social: context.social,
    quest: context.quest,
    turn: context.turn,
    generationAllowed: context.generationAllowed
  };
}

export function validateNpcJevRouterInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('JEV_INVALID_INPUT');
  const npcId = input.npcId;
  const context = input.context;
  if (!PILOT_IDS.has(npcId)) throw Error('JEV_NPC_NOT_PILOT');
  if (context?.schemaVersion !== 'dialogue-context-p1' || context.identity?.npcId !== npcId)
    throw Error('JEV_INVALID_CONTEXT');
  if (hasForbiddenKey(context)) throw Error('JEV_FORBIDDEN_CONTEXT');
  const serialized = JSON.stringify(context);
  if (serialized.length > 9000) throw Error('JEV_CONTEXT_TOO_LARGE');
  const candidates = buildNpcDialogueCandidates(context);
  if (!candidates.responseSources.length || !candidates.intents.length) throw Error('JEV_EMPTY_CANDIDATES');
  return { npcId, context, candidates };
}

export function buildNpcJevQuestions(candidates) {
  const questions = {};
  const source = question(candidates.responseSources, SOURCE_DESCRIPTION,
    'Choose the best response source for this exact dialogue turn. Prefer deterministic sources when sufficient; GENERATIVE is only an escalation.');
  if (source) questions.response_source = source;
  const intent = question(candidates.intents, INTENT_DESCRIPTION,
    'Choose the dialogue intent that best matches the current turn and player interaction.');
  if (intent) questions.intent = intent;
  const priority = question(candidates.contextPriorities, PRIORITY_DESCRIPTION,
    'Choose the single context signal that should matter most for this response.');
  if (priority) questions.context_priority = priority;
  return questions;
}

function answerChoice(answers, name, allowed) {
  if (allowed.length === 0) return null;
  if (allowed.length === 1) return allowed[0];
  const raw = answers?.[name];
  const choice = raw && typeof raw === 'object' && typeof raw.choice === 'string' ? raw.choice : null;
  if (!allowed.includes(choice)) throw Error('JEV_DECISION_OUTSIDE_CANDIDATES');
  return choice;
}

function answerMeta(answers, name) {
  const raw = answers?.[name];
  if (!raw || typeof raw !== 'object') return null;
  return {
    confidence: Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : null,
    probabilities: raw.probabilities && typeof raw.probabilities === 'object' && !Array.isArray(raw.probabilities)
      ? Object.fromEntries(Object.entries(raw.probabilities)
        .filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 1))
      : null
  };
}

export function parseNpcJevResponse(body, candidates) {
  const answers = body?.answers;
  const decision = {
    responseSource: answerChoice(answers, 'response_source', candidates.responseSources),
    intent: answerChoice(answers, 'intent', candidates.intents),
    contextPriority: answerChoice(answers, 'context_priority', candidates.contextPriorities)
  };
  if (!validateNpcDialogueDecision(decision, candidates)) throw Error('JEV_DECISION_OUTSIDE_CANDIDATES');
  return {
    schemaVersion: 'npc-dialogue-jev-v1',
    role: 'EXPERIMENT_ONLY',
    authorityEffect: 'NONE',
    provider: 'typesafe-jev',
    model: typeof body?.model === 'string' ? body.model : null,
    decision,
    confidence: {
      responseSource: answerMeta(answers, 'response_source')?.confidence ?? null,
      intent: answerMeta(answers, 'intent')?.confidence ?? null,
      contextPriority: answerMeta(answers, 'context_priority')?.confidence ?? null
    },
    probabilities: {
      responseSource: answerMeta(answers, 'response_source')?.probabilities ?? null,
      intent: answerMeta(answers, 'intent')?.probabilities ?? null,
      contextPriority: answerMeta(answers, 'context_priority')?.probabilities ?? null
    },
    usage: body?.usage ?? null
  };
}

export function createNpcJevDecisionProvider({
  apiKey,
  model = DEFAULT_MODEL,
  endpoint = DEFAULT_ENDPOINT,
  fetcher = fetch,
  timeoutMs = 1800
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 12) throw Error('JEV_API_KEY_REQUIRED');
  if (typeof fetcher !== 'function') throw Error('JEV_FETCH_REQUIRED');
  return {
    async decide(input) {
      const { context, candidates } = validateNpcJevRouterInput(input);
      const questions = buildNpcJevQuestions(candidates);
      const response = await fetcher(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          model,
          state: compactNpcDialogueJevState(context),
          questions
        })
      });
      const text = await response.text();
      if (!response.ok) throw Error(`JEV_HTTP_${response.status}`);
      let body;
      try { body = JSON.parse(text); } catch { throw Error('JEV_INVALID_JSON'); }
      return parseNpcJevResponse(body, candidates);
    }
  };
}
