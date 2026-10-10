import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const consumer = readFileSync(new URL('../npc-factory/npc-shared-authority-consumer-p0.mjs', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/npc-shared-state.js', import.meta.url), 'utf8');

test('campus boot probes shared NPC authority independently and passes the Place Zone into runtime', () => {
  assert.match(main, /probeFeatureFlag\('\/api\/npc-shared-state'\)/);
  assert.match(main, /npcSharedAuthorityEnabled = sharedAuthorityResult === FLAG_ENABLED/);
  assert.match(main, /sharedAuthorityEnabled: npcSharedAuthorityEnabled/);
  assert.match(main, /sharedAuthorityEndpoint: '\/api\/npc-shared-state'/);
  assert.match(main, /getSharedAuthorityPlaceZoneId: \(\) => places\.getCurrentPlaceZone\(\)\?\.id \?\? null/);
});

test('runtime gives pilot NPC renderer state to the shared authority consumer before local simulation', () => {
  assert.match(runtime, /createSharedNpcAuthorityConsumerP0\(\{/);
  assert.match(runtime, /sharedAuthority\.update\(\)/);
  assert.match(runtime, /const authoritative = sharedAuthority\.stateFor\(actor\.id\)/);
  assert.match(runtime, /if \(authoritative\) \{[\s\S]*?visual\.avatar\.enabled = Boolean\(position\);[\s\S]*?return;/);
  assert.match(runtime, /shared_authority: sharedAuthority\.status\(\)/);
});

test('consumer is read-only, pilot-scoped and fail-closed until a valid snapshot exists', () => {
  assert.match(consumer, /new Set\(SHARED_NPC_P0_IDS\)/);
  assert.match(consumer, /ready: false, visible: false/);
  assert.match(consumer, /method: 'GET'/);
  assert.doesNotMatch(consumer, /POST|PUT|PATCH|DELETE|localStorage|sessionStorage|supabase/i);
});

test('feature endpoint supports a flag probe but still requires a Place Zone for state', () => {
  assert.match(api, /if \(!placeZoneId\) return res\.status\(200\)\.json\(\{ enabled: true \}\)/);
  assert.match(api, /INVALID_SHARED_NPC_PLACE_ZONE/);
  assert.match(api, /snapshot\(\{ placeZoneId \}\)/);
});
