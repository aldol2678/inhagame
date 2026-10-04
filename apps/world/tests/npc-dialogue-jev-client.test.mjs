import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcJevDialogueRouter } from '../npc-factory/npc-dialogue-jev-client.mjs';

const context = {
  identity: { npcId: 'INKYUNG-NPC-001' },
  current: {}, world: {}, memory: {}, social: {}, quest: {}, turn: {}, generationAllowed: true
};
const candidates = {
  responseSources: ['AUTHORED','CONTEXTUAL','GENERATIVE'],
  intents: ['STATUS','SOCIAL'],
  contextPriorities: ['CURRENT_ACTIVITY','WEATHER']
};
const baseline = {
  responseSource: 'CONTEXTUAL', intent: 'STATUS',
  contextPriorities: ['CURRENT_ACTIVITY','WEATHER'], provider: 'DETERMINISTIC_BASELINE'
};

test('disabled and unauthenticated Jev routing fall back without breaking dialogue', async () => {
  let fetched = 0;
  const disabled = createNpcJevDialogueRouter({ enabled: false, fetcher: async () => { fetched++; } });
  assert.equal((await disabled.route({ context, candidates, baseline })).fallbackReason, 'DISABLED');
  assert.equal(fetched, 0);

  const unauth = createNpcJevDialogueRouter({ enabled: true, getSession: async () => null,
    fetcher: async () => { fetched++; } });
  const fallback = await unauth.route({ context, candidates, baseline });
  assert.equal(fallback.provider, 'DETERMINISTIC_BASELINE');
  assert.equal(fallback.fallbackReason, 'AUTH_REQUIRED');
  assert.equal(fetched, 0);
});

test('valid Jev result is accepted while invalid or failed result falls back', async () => {
  const router = createNpcJevDialogueRouter({
    enabled: true,
    getSession: async () => 'x'.repeat(30),
    now: (() => { let t=100; return () => ++t; })(),
    fetcher: async () => ({ ok: true, json: async () => ({
      role: 'EXPERIMENT_ONLY', authorityEffect: 'NONE', model: 'jev-latest',
      decision: { responseSource: 'GENERATIVE', intent: 'SOCIAL', contextPriority: 'WEATHER' },
      confidence: { responseSource: .7 }
    }) })
  });
  const result = await router.route({ context, candidates, baseline });
  assert.equal(result.provider, 'JEV');
  assert.equal(result.responseSource, 'GENERATIVE');
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(router.status().accepted, 1);

  const invalid = createNpcJevDialogueRouter({
    enabled: true, getSession: async () => 'x'.repeat(30),
    fetcher: async () => ({ ok: true, json: async () => ({
      role: 'EXPERIMENT_ONLY', authorityEffect: 'NONE',
      decision: { responseSource: 'MAGIC', intent: 'SOCIAL', contextPriority: 'WEATHER' }
    }) })
  });
  assert.equal((await invalid.route({ context, candidates, baseline })).fallbackReason, 'INVALID_DECISION');

  const failed = createNpcJevDialogueRouter({
    enabled: true, getSession: async () => 'x'.repeat(30),
    fetcher: async () => ({ ok: false, status: 503, json: async () => ({}) })
  });
  assert.equal((await failed.route({ context, candidates, baseline })).fallbackReason, 'HTTP_503');
});
