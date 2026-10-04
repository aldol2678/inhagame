import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JEV_DIALOGUE_PILOT_IDS,
  buildNpcJevQuestions,
  compactNpcDialogueJevState,
  createNpcJevDecisionProvider,
  parseNpcJevResponse,
  validateNpcJevRouterInput
} from '../npc-factory/npc-jev-router.mjs';
import { buildNpcDialogueCandidates } from '../npc-factory/npc-dialogue-context.mjs';

const context = Object.freeze({
  schemaVersion: 'dialogue-context-p1',
  identity: Object.freeze({
    npcId: 'INKYUNG-NPC-001', name: '나나율', archetype: 'student', department: '문화콘텐츠문화경영학과',
    yearLevel: 4, residence: null, interests: Object.freeze(['architecture','cooking']), traits: Object.freeze(['thoughtful'])
  }),
  current: Object.freeze({ period: 'lunch', location: 'main_gate', activity: 'wait', socialMode: 'medium', moving: false }),
  world: Object.freeze({ weather: 'RAIN', environmentTime: 'EVENING', placeZoneId: 'AREA_MAIN_GATE', eventId: null, eventPhase: null }),
  memory: Object.freeze({ familiarity: 'REPEATED', lastPeriod: 'lunch', lastTopic: 'architecture' }),
  social: Object.freeze({ group: null, closeTies: Object.freeze([]) }),
  quest: Object.freeze({ enabled: true, signedIn: true, available: true, complete: false, stage: 2,
    objective: '본관 찾아가기', npcActionAvailable: false, sideEventAvailable: false }),
  turn: Object.freeze({ state: 'STATUS', topic: null, followUp: false }),
  generationAllowed: true
});

test('D3 pilot keeps the five campus pilots, admits eight Biryong shadow pilots, and rejects sensitive/non-pilot context', () => {
  const campusPilots = ['INKYUNG-NPC-001','INKYUNG-NPC-002','INKYUNG-NPC-021','INKYUNG-NPC-022','INKYUNG-NPC-023'];
  const biryongPilots = Array.from({ length: 8 }, (_, index) => `BR_NPC_${String(index + 1).padStart(3, '0')}`);
  assert.equal(JEV_DIALOGUE_PILOT_IDS.length, campusPilots.length + biryongPilots.length);
  for (const id of [...campusPilots, ...biryongPilots]) assert.ok(JEV_DIALOGUE_PILOT_IDS.includes(id), id);
  assert.deepEqual(validateNpcJevRouterInput({ npcId: 'INKYUNG-NPC-001', context }).npcId, 'INKYUNG-NPC-001');
  assert.throws(() => validateNpcJevRouterInput({ npcId: 'INKYUNG-NPC-024',
    context: { ...context, identity: { ...context.identity, npcId: 'INKYUNG-NPC-024' } } }), /JEV_NPC_NOT_PILOT/);
  assert.throws(() => validateNpcJevRouterInput({ npcId: 'INKYUNG-NPC-001',
    context: { ...context, email: 'leak@example.com' } }), /JEV_FORBIDDEN_CONTEXT/);
});

test('Jev questions ask only ambiguous closed choices', () => {
  const candidates = buildNpcDialogueCandidates(context);
  const questions = buildNpcJevQuestions(candidates);
  assert.ok(questions.response_source);
  assert.ok(questions.intent);
  assert.ok(questions.context_priority);
  assert.deepEqual(Object.keys(questions.response_source.criteria).sort(), [...candidates.responseSources].sort());
  const state = compactNpcDialogueJevState(context);
  assert.equal(state.npc.id, 'INKYUNG-NPC-001');
  assert.doesNotMatch(JSON.stringify(state), /name|email|studentNumber|wallet|inventory|reward/i);
});

test('provider parses typed Jev choices and preserves non-authoritative role', async () => {
  let request;
  const provider = createNpcJevDecisionProvider({
    apiKey: 'typesafe-test-key',
    fetcher: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({
        model: 'jev-latest',
        answers: {
          response_source: { choice: 'CONTEXTUAL', confidence: .82, probabilities: { CONTEXTUAL: .82, GENERATIVE: .18 } },
          intent: { choice: 'STATUS', confidence: .91, probabilities: { STATUS: .91, SOCIAL: .09 } },
          context_priority: { choice: 'WEATHER', confidence: .64, probabilities: { WEATHER: .64, CURRENT_ACTIVITY: .36 } }
        },
        usage: { input_tokens: 42 }
      }) };
    }
  });
  const result = await provider.decide({ npcId: 'INKYUNG-NPC-001', context });
  assert.equal(request.model, 'jev-latest');
  assert.equal(result.role, 'EXPERIMENT_ONLY');
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.decision.responseSource, 'CONTEXTUAL');
  assert.equal(result.decision.intent, 'STATUS');
  assert.equal(result.decision.contextPriority, 'WEATHER');
  assert.equal(result.confidence.responseSource, .82);
});

test('parser rejects choices outside D2 candidates', () => {
  const candidates = buildNpcDialogueCandidates(context);
  assert.throws(() => parseNpcJevResponse({
    answers: {
      response_source: { choice: 'MAGIC' },
      intent: { choice: 'STATUS' },
      context_priority: { choice: 'WEATHER' }
    }
  }, candidates), /JEV_DECISION_OUTSIDE_CANDIDATES/);
});
