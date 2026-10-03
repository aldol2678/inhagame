// CORE-15 ①: once the world is visible the first quest must be startable, even when the AI flag,
// the campus NPC expansion or the quest's first status read is late or fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAG_DISABLED, FLAG_ENABLED, FLAG_UNAVAILABLE, probeFeatureFlag, retryFeatureFlag } from '../src/npc-feature-flags.js';
import { loadNpcPopulation, NPC_POPULATION_URLS } from '../npc-factory/npc-population-loader.mjs';
import { MAIN_NPC_ID, QUEST_NPC_ID } from '../npc-factory/npc-presence.mjs';
import { createQuestClient } from '../npc-factory/quest-client.mjs';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';
import { createMain2QuestClient } from '../npc-factory/main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = body => ({ ok: true, status: 200, json: async () => body });
const status = code => ({ ok: code >= 200 && code < 300, status: code, json: async () => ({}) });

function manualTimers() {
  const pending = [];
  return {
    pending,
    setTimer: (fn, ms) => { const timer = { fn, ms }; pending.push(timer); return timer; },
    clearTimer: timer => { const index = pending.indexOf(timer); if (index >= 0) pending.splice(index, 1); },
    async fire(ms) {
      const index = pending.findIndex(timer => ms === undefined || timer.ms === ms);
      assert.ok(index >= 0, `a timer of ${ms}ms is armed`);
      const [timer] = pending.splice(index, 1);
      await timer.fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
  };
}

test('flag probe: 404 is off, 200 {enabled:true} is on, anything else is transient', async () => {
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => json({ enabled: true }) }), FLAG_ENABLED);
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => json({ enabled: false }) }), FLAG_DISABLED);
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => status(404) }), FLAG_DISABLED);
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => status(503) }), FLAG_UNAVAILABLE);
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => { throw new TypeError('offline'); } }), FLAG_UNAVAILABLE);
  assert.equal(await probeFeatureFlag('/f', { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw SyntaxError('bad'); } }) }),
    FLAG_UNAVAILABLE);
});

test('flag probe is bounded: a hanging AI flag resolves UNAVAILABLE and aborts the request', async () => {
  const timers = manualTimers();
  let signal;
  const result = probeFeatureFlag('/api/npc-ai', { timeoutMs: 4000, ...timers,
    fetcher: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  assert.equal(timers.pending[0].ms, 4000);
  await timers.fire(4000);
  assert.equal(await result, FLAG_UNAVAILABLE);
  assert.equal(signal.aborted, true);
});

test('quest flag retry turns the quest on after transient failures and stops when settled', async () => {
  const timers = manualTimers();
  const answers = [status(502), json({ enabled: true })];
  const urls = [];
  const resolved = [];
  retryFeatureFlag('/api/world-quest', { ...timers, retryDelays: [1000, 3000, 8000],
    fetcher: async url => { urls.push(url); return answers.shift(); }, onResolved: value => resolved.push(value) });
  await timers.fire(1000);
  assert.deepEqual(resolved, []);
  await timers.fire(3000);
  assert.deepEqual(resolved, [true]);
  assert.deepEqual(urls, ['/api/world-quest', '/api/world-quest']);
  assert.equal(timers.pending.length, 0);
});

test('quest flag retry gives up after its delays and can be cancelled', async () => {
  const timers = manualTimers();
  const resolved = [];
  retryFeatureFlag('/f', { ...timers, retryDelays: [1000], fetcher: async () => status(500), onResolved: v => resolved.push(v) });
  await timers.fire(1000);
  assert.deepEqual(resolved, [false]);

  const cancelTimers = manualTimers();
  let calls = 0;
  const cancel = retryFeatureFlag('/f', { ...cancelTimers, fetcher: async () => { calls++; return json({ enabled: true }); },
    onResolved: () => assert.fail('cancelled retry must not resolve') });
  cancel();
  assert.equal(cancelTimers.pending.length, 0);
  assert.equal(calls, 0);
});

function fileFetcher({ fail = {} } = {}) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const rule = fail[url];
    if (typeof rule === 'function') { const answer = rule(calls.filter(u => u === url).length); if (answer) return answer; }
    else if (rule) return rule;
    const body = readFileSync(new URL(`..${url}`, import.meta.url));
    return { ok: true, status: 200, json: async () => JSON.parse(body.toString('utf8')),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  return { fetcher, calls };
}
const noWait = async () => {};

test('population: the full campus loads 48 NPCs with the expansion READY', async () => {
  const { fetcher } = fileFetcher();
  const population = await loadNpcPopulation({ fetcher, wait: noWait });
  assert.equal(population.expansion, 'READY');
  assert.equal(population.batch.batch_id, 'INKYUNG-48-P2A');
  assert.equal(population.batch.npcs.length, 48);
});

test('population: a missing or broken expansion keeps the base 20 with both quest NPCs', async () => {
  for (const broken of [() => status(404), () => ({ ok: true, status: 200, json: async () => ({ expansion_id: 'WRONG' }) }),
    () => Promise.reject(new TypeError('offline'))]) {
    const errors = [];
    const { fetcher } = fileFetcher({ fail: { [NPC_POPULATION_URLS.expansion]: broken } });
    const population = await loadNpcPopulation({ fetcher, wait: noWait, onExpansionError: error => errors.push(error) });
    assert.equal(population.expansion, 'UNAVAILABLE');
    assert.equal(population.batch.batch_id, 'INKYUNG-20-A');
    assert.equal(population.batch.npcs.length, 20);
    assert.equal(population.roster.npcs.length, 20);
    const ids = new Set(population.batch.npcs.map(npc => npc.npc_id));
    assert.ok(ids.has(MAIN_NPC_ID) && ids.has(QUEST_NPC_ID), 'first-walk quest NPCs stay in the world');
    assert.equal(errors.length, 1);
  }
});

test('population: the base 20 schedule is the same with or without the expansion', async () => {
  const full = await loadNpcPopulation({ fetcher: fileFetcher().fetcher, wait: noWait });
  const base = await loadNpcPopulation({ wait: noWait,
    fetcher: fileFetcher({ fail: { [NPC_POPULATION_URLS.expansion]: status(503) } }).fetcher });
  for (const npc of base.batch.npcs) {
    assert.deepEqual(npc.schedule, full.batch.npcs.find(other => other.npc_id === npc.npc_id).schedule, npc.npc_id);
  }
});

test('population: a transient base failure is retried; integrity failures are not', async () => {
  const waits = [];
  const { fetcher, calls } = fileFetcher({ fail: { [NPC_POPULATION_URLS.roster]: n => n === 1 ? status(503) : null } });
  const population = await loadNpcPopulation({ fetcher, wait: async ms => { waits.push(ms); } });
  assert.equal(population.batch.npcs.length, 48);
  assert.deepEqual(waits, [1000]);
  assert.equal(calls.filter(url => url === NPC_POPULATION_URLS.roster).length, 2);

  const down = fileFetcher({ fail: { [NPC_POPULATION_URLS.candidate]: status(500) } });
  await assert.rejects(loadNpcPopulation({ fetcher: down.fetcher, wait: noWait, retryDelays: [1, 2] }), /unavailable/);
  assert.equal(down.calls.filter(url => url === NPC_POPULATION_URLS.candidate).length, 3);

  const tampered = fileFetcher({ fail: { [NPC_POPULATION_URLS.decision]: json({ candidate_sha256: '0', npc_count: 20 }) } });
  const tamperWaits = [];
  await assert.rejects(loadNpcPopulation({ fetcher: tampered.fetcher, wait: async ms => { tamperWaits.push(ms); } }),
    /fixture\/hash mismatch/);
  assert.deepEqual(tamperWaits, []);
});

function questHarness({ enabled = true, answers }) {
  const timers = manualTimers();
  const bodies = [];
  const client = createQuestClient({ enabled, endpoint: '/api/world-quest', getSession: async () => 'token', ...timers,
    fetcher: async (_url, init) => { bodies.push(JSON.parse(init.body).event); return answers.shift() ?? status(503); } });
  return { client, timers, bodies };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('first-walk status: a failed first read is retried until the quest is READY', async () => {
  const h = questHarness({ answers: [status(503), json({ quest_id: QUEST_ID, stage: 0 })] });
  await h.client.setSignedIn(true);
  assert.equal(h.client.status().statusState, 'RETRY');
  assert.equal(h.client.status().retryAttempt, 1);
  assert.equal(h.client.mapTarget(), null);
  await h.timers.fire(1000);
  assert.equal(h.client.status().statusState, 'READY');
  assert.equal(h.client.status().ready, true);
  assert.equal(h.client.status().retryAttempt, 0);
  assert.equal(h.client.eventForNpc(MAIN_NPC_ID), 'start');
  assert.deepEqual(h.bodies, ['status', 'status']);
});

test('first-walk status: retries stop after 1s/3s/8s and reset on sign-out', async () => {
  const h = questHarness({ answers: [] });
  await h.client.setSignedIn(true);
  await h.timers.fire(1000);
  await h.timers.fire(3000);
  await h.timers.fire(8000);
  assert.equal(h.timers.pending.length, 0);
  assert.equal(h.client.status().statusState, 'UNAVAILABLE');
  assert.equal(h.bodies.length, 4);
  await h.client.setSignedIn(true);
  assert.equal(h.client.status().retryAttempt, 1, 'a new sign-in starts a fresh retry budget');
  await h.client.setSignedIn(false);
  assert.equal(h.timers.pending.length, 0, 'sign-out cancels the pending retry');
  assert.equal(h.client.status().statusState, 'SIGNED_OUT');
});

test('first-walk quest can be switched on after the runtime is built', async () => {
  const h = questHarness({ enabled: false, answers: [json({ quest_id: QUEST_ID, stage: 2 })] });
  await h.client.setSignedIn(true);
  assert.equal(h.client.status().statusState, 'DISABLED');
  assert.deepEqual(h.bodies, []);
  await h.client.setEnabled(true);
  assert.equal(h.client.status().enabled, true);
  assert.equal(h.client.status().ready, true);
  assert.equal(h.client.stage, 2);
  assert.deepEqual(h.bodies, ['status']);
  assert.equal(await h.client.setEnabled(true), null, 'enabling twice does not re-read');
  assert.deepEqual(h.bodies, ['status']);
});

test('Main 2 can be switched on after the runtime is built', async () => {
  const bodies = [];
  const client = createMain2QuestClient({ enabled: false, endpoint: '/api/world-quest', getSession: async () => 'token',
    fetcher: async (_url, init) => { bodies.push(JSON.parse(init.body).event);
      return json({ quest_id: MAIN2_QUEST_ID, stage: 0, available: true }); } });
  await client.setSignedIn(true);
  assert.deepEqual(bodies, []);
  await client.setEnabled(true);
  await flush();
  assert.deepEqual(bodies, ['status']);
  assert.equal(client.status().ready, true);
  assert.equal(client.status().available, true);
});

test('wiring: NPCs never wait on an unbounded flag, and a late quest flag reaches the runtime', () => {
  const main = read('../src/main.js');
  const loader = main.slice(main.indexOf('async function loadOptionalNpcRuntime'),
    main.indexOf('places.onPlaceZoneChanged'));
  assert.doesNotMatch(loader, /fetch\('\/api\/(npc-ai|world-quest)'/, 'flags go through the bounded probe');
  assert.match(loader, /probeFeatureFlag\('\/api\/npc-ai'\)/);
  assert.match(loader, /probeFeatureFlag\('\/api\/world-quest'\)/);
  assert.match(loader, /questFlagPending = questResult === FLAG_UNAVAILABLE/);
  assert.match(loader, /retryFeatureFlag\('\/api\/world-quest'[\s\S]{0,160}runtime\.setQuestEnabled\(true\)/);

  const runtime = read('../npc-factory/dev-runtime.mjs');
  assert.match(runtime, /await loadNpcPopulation\(/);
  assert.match(runtime, /setQuestEnabled: enabled => Promise\.all\(\[quest\.setEnabled\(enabled\), main2Quest\.setEnabled\(enabled\)\]\)/);
  assert.match(runtime, /population: \{ batch_id: batch\.batch_id, expansion: populationExpansion \}/);
});
