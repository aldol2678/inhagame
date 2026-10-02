// Offline server contract for the hub telemetry APIs (apps/world/api/hub-entry.js and
// hub-event.js) and the payloads the browser scripts send them. The Supabase RPC is replaced by
// a fetch stub; the database side of the same contract is tested against a disposable database
// in supabase/tests (the `database` CI job).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const hubEntry = require('../api/hub-entry.js');
const hubEvent = require('../api/hub-event.js');

const RPC_BASE = '' + (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1/rpc/';
const ID = {
  event: '0b1c2d3e-4f50-4a61-8b72-938495a6b7c8',
  entry: '1a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d',
  session: '2b3c4d5e-6f70-4b8c-ad9e-1f2a3b4c5d6e',
  visitor: '3c4d5e6f-7081-4c9d-be0f-2a3b4c5d6e7f',
};
const ORIGINS = {
  'https://inhagame.example': 'campus',
  'https://duck.inhagame.example': 'classic',
  'https://induckup.inhagame.example': 'induckup',
  'https://survival.inhagame.example': 'survival',
  'https://grow.inhagame.example': 'induck-grow',
};

// ---- harness ----
let upstream;
let calls;
function stubUpstream(result = () => new Response('true', { status: 200 })) {
  calls = [];
  upstream = result;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return upstream();
  };
}
function response() {
  return {
    statusCode: 0, headers: {}, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    end() { this.ended = true; return this; },
  };
}
async function call(handler, { method = 'POST', headers = {}, body }) {
  const res = response();
  await handler({ method, headers, body }, res);
  assert.ok(res.ended, 'response ended');
  assert.equal(res.headers['cache-control'], 'no-store');
  return res;
}
const entryBody = (overrides = {}) => ({
  event_id: ID.event, entry_id: ID.entry, event_type: 'game_landing', target: 'classic', ...overrides,
});
const entry = (body = entryBody(), origin = 'https://duck.inhagame.example', extra = {}) =>
  call(hubEntry, { headers: { origin, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const eventBody = (overrides = {}) => ({
  event_id: ID.event, session_id: ID.session, visitor_id: ID.visitor,
  event_type: 'hub_game_click', surface: 'home', target: 'classic',
  acquisition_source: 'direct', campaign: null, ...overrides,
});
const hubHeaders = { origin: 'https://inhagame.example', host: 'inhagame.example' };
const event = (body = eventBody(), headers = hubHeaders) =>
  call(hubEvent, { headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

// ---- hub-entry: valid cases ----
test('hub-entry: a valid stage is forwarded with the target taken from the Origin', async () => {
  stubUpstream();
  const res = await entry();
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://duck.inhagame.example');
  assert.equal(res.headers.vary, 'Origin');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${RPC_BASE}log_inhagame_game_entry_v1`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].body, {
    p_event_id: ID.event, p_entry_id: ID.entry, p_event_type: 'game_landing', p_target: 'classic',
  });
});

test('hub-entry: every game origin attributes to its own target', async () => {
  for (const [origin, target] of Object.entries(ORIGINS)) {
    stubUpstream();
    const res = await entry(entryBody({ target }), origin);
    assert.equal(res.statusCode, 204, origin);
    assert.equal(calls[0].body.p_target, target, origin);
  }
});

test('hub-entry: every supported stage is accepted', async () => {
  for (const eventType of ['game_landing', 'game_play_start', 'game_load_error',
    'game_first_result', 'game_first_clear', 'game_retry', 'classic_ranked_start']) {
    stubUpstream();
    assert.equal((await entry(entryBody({ event_type: eventType }))).statusCode, 204, eventType);
    assert.equal(calls[0].body.p_event_type, eventType);
  }
});

test('hub-entry: CORS preflight from a game origin', async () => {
  stubUpstream();
  const res = await call(hubEntry, { method: 'OPTIONS', headers: { origin: 'https://survival.inhagame.example' } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://survival.inhagame.example');
  assert.equal(res.headers['access-control-allow-methods'], 'POST, OPTIONS');
  assert.equal(res.headers['access-control-allow-headers'], 'Content-Type');
  assert.equal(calls.length, 0);
});

test('hub-entry: object and Buffer bodies are accepted like JSON text', async () => {
  stubUpstream();
  assert.equal((await call(hubEntry, { headers: { origin: 'https://duck.inhagame.example' }, body: entryBody() })).statusCode, 204);
  const buffer = Buffer.from(JSON.stringify(entryBody()));
  assert.equal((await call(hubEntry, { headers: { origin: 'https://duck.inhagame.example' }, body: buffer })).statusCode, 204);
});

// ---- hub-entry: invalid cases ----
test('hub-entry: unknown or spoofed origins are refused before anything else', async () => {
  for (const origin of [undefined, 'https://evil.example', 'http://duck.inhagame.example',
    'https://duck.inhagame.example.evil.example', 'https://duck.inhagame.example:8443', 'null']) {
    stubUpstream();
    const headers = origin === undefined ? {} : { origin };
    const res = await call(hubEntry, { headers, body: JSON.stringify(entryBody()) });
    assert.equal(res.statusCode, 403, String(origin));
    assert.equal(res.headers['access-control-allow-origin'], undefined, String(origin));
    assert.equal(calls.length, 0, String(origin));
  }
});

test('hub-entry: only POST is served', async () => {
  stubUpstream();
  assert.equal((await call(hubEntry, { method: 'GET', headers: { origin: 'https://duck.inhagame.example' } })).statusCode, 405);
});

test('hub-entry: malformed requests are 400/413 and never reach Supabase', async () => {
  const cases = [
    ['malformed event_id', entryBody({ event_id: 'not-a-uuid' }), 400],
    ['nil uuid', entryBody({ event_id: '00000000-0000-0000-0000-000000000000' }), 400],
    ['malformed entry_id', entryBody({ entry_id: `${ID.entry}0` }), 400],
    ['missing entry_id', entryBody({ entry_id: undefined }), 400],
    ['hub event type', entryBody({ event_type: 'hub_visit' }), 400],
    ['unsupported event type', entryBody({ event_type: 'game_purchase' }), 400],
    ['unknown target', entryBody({ target: 'tetris' }), 400],
    ['cross-game target', entryBody({ target: 'induckup' }), 400],
    ['missing target', entryBody({ target: undefined }), 400],
    ['non-JSON body', '{"event_id":', 400],
    ['JSON array', '[]', 400],
    ['JSON null', 'null', 400],
    ['oversized body', JSON.stringify({ ...entryBody(), pad: 'x'.repeat(512) }), 413],
  ];
  for (const [name, body, status] of cases) {
    stubUpstream();
    const res = await entry(body);
    assert.equal(res.statusCode, status, name);
    assert.equal(calls.length, 0, name);
  }
});

test('hub-entry: the RPC verdict maps to 204 / 409 and failures to 502 / 503', async () => {
  // false covers every server-side refusal: missing or expired click, play before landing,
  // cross-game reuse (see supabase/tests/database/10_hub_telemetry.test.sql).
  for (const [name, reply, status] of [
    ['accepted', () => new Response('true', { status: 200 }), 204],
    ['refused', () => new Response('false', { status: 200 }), 409],
    ['non-boolean', () => new Response('"true"', { status: 200 }), 409],
    ['upstream error', () => new Response('{}', { status: 500 }), 502],
    ['upstream unreachable', () => { throw new TypeError('fetch failed'); }, 503],
    ['upstream timeout', () => { throw new DOMException('timed out', 'TimeoutError'); }, 503],
  ]) {
    stubUpstream(reply);
    assert.equal((await entry()).statusCode, status, name);
  }
});

// ---- hub-entry: privacy ----
test('hub-entry: only the four entry fields are needed and forwarded', async () => {
  stubUpstream();
  const res = await entry({
    ...entryBody(), email: 'duck@inha.edu', nickname: 'duck', access_token: 'jwt', user_id: ID.visitor,
    visitor_id: ID.visitor, session_id: ID.session, user_agent: 'x',
  }, 'https://duck.inhagame.example', { authorization: 'Bearer user-jwt', cookie: 'sb-access-token=secret' });
  assert.equal(res.statusCode, 204);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['p_entry_id', 'p_event_id', 'p_event_type', 'p_target']);
  const sentHeaders = Object.keys(calls[0].init.headers).map((h) => h.toLowerCase()).sort();
  assert.deepEqual(sentHeaders, ['apikey', 'content-type'], 'no client Authorization or Cookie is forwarded');
  assert.match(calls[0].init.headers.apikey, /^sb_publishable_/, 'only the public publishable key is used');
});

// ---- hub-event ----
test('hub-event: a valid hub event is forwarded with acquisition fields', async () => {
  stubUpstream();
  const res = await event();
  assert.equal(res.statusCode, 204);
  assert.equal(calls[0].url, `${RPC_BASE}log_inhagame_hub_event_v2`);
  assert.deepEqual(calls[0].body, {
    p_event_id: ID.event, p_session_id: ID.session, p_visitor_id: ID.visitor,
    p_event_type: 'hub_game_click', p_surface: 'home', p_target: 'classic',
    p_acquisition_source: 'direct', p_campaign: null,
  });
});

test('hub-event: every hub, profile and CORE-15 event type is accepted', async () => {
  for (const eventType of ['hub_visit', 'hub_panel_view', 'hub_game_click', 'campus_entry_click',
    'campus_boot_ready', 'campus_boot_error', 'campus_zone_enter', 'hub_card_impression',
    'profile_view', 'profile_edit_open', 'profile_edit_save', 'profile_game_click',
    'first_session_start', 'first_goal_seen', 'first_move', 'first_zone_arrival', 'first_npc_interaction',
    'quest_started', 'first_player_encounter', 'first_activity_start', 'first_activity_complete',
    'first_reward', 'reward_seen', 'growth_seen', 'core_loop_complete', 'next_goal_seen',
    'core15_complete', 'world_return', 'next_discovery_click']) {
    stubUpstream();
    assert.equal((await event(eventBody({ event_type: eventType }))).statusCode, 204, eventType);
    assert.equal(calls[0].body.p_event_type, eventType);
  }
});

test('hub-event: target is optional and forwarded as null', async () => {
  stubUpstream();
  assert.equal((await event(eventBody({ event_type: 'hub_visit', target: undefined }))).statusCode, 204);
  assert.equal(calls[0].body.p_target, null);
});

test('hub-event: CORE-15 canonical targets are forwarded without account context', async () => {
  for (const [eventType, target] of [
    ['first_activity_start', 'inkyung_living'],
    ['first_activity_complete', 'inkyung_living'],
    ['first_goal_seen', 'first_campus'],
    ['quest_started', 'first_campus'],
    ['first_reward', 'first_campus'],
    ['reward_seen', 'first_campus'],
    ['growth_seen', 'first_campus'],
    ['core_loop_complete', 'first_campus'],
    ['next_goal_seen', 'main2_back_gate_guide'],
    ['core15_complete', 'first_campus'],
    ['next_discovery_click', 'main2_back_gate_guide']
  ]) {
    stubUpstream();
    const res = await event(eventBody({ event_type: eventType, surface: 'campus', target }));
    assert.equal(res.statusCode, 204, eventType);
    assert.equal(calls[0].body.p_target, target);
    assert.equal(calls[0].body.p_surface, 'campus');
  }
});

test('hub-event: same-origin requests pass, cross-site origins are refused', async () => {
  stubUpstream();
  assert.equal((await event(eventBody(), { host: 'inhagame.example' })).statusCode, 204, 'no Origin (beacon)');
  for (const headers of [
    { origin: 'https://evil.example', host: 'inhagame.example' },
    { origin: 'https://duck.inhagame.example', host: 'inhagame.example' },
    { origin: 'not a url', host: 'inhagame.example' },
    { origin: 'https://inhagame.example' },
  ]) {
    stubUpstream();
    const res = await event(eventBody(), headers);
    assert.equal(res.statusCode, 403, JSON.stringify(headers));
    assert.equal(calls.length, 0);
  }
});

test('hub-event: malformed requests never reach Supabase', async () => {
  stubUpstream();
  assert.equal((await call(hubEvent, { method: 'GET', headers: hubHeaders })).statusCode, 405);
  for (const [name, body, status] of [
    ['malformed event_id', eventBody({ event_id: 'x' }), 400],
    ['malformed session_id', eventBody({ session_id: 'x' }), 400],
    ['malformed visitor_id', eventBody({ visitor_id: 'x' }), 400],
    ['game stage on hub endpoint', eventBody({ event_type: 'game_landing' }), 400],
    ['unsupported event type', eventBody({ event_type: 'purchase' }), 400],
    ['surface missing', eventBody({ surface: undefined }), 400],
    ['target not a string', eventBody({ target: 7 }), 400],
    ['invalid acquisition source', eventBody({ acquisition_source: 'javascript:bad' }), 400],
    ['invalid campaign', eventBody({ campaign: 'Bad Campaign!' }), 400],
    ['non-JSON body', 'hub_visit', 400],
    ['oversized body', JSON.stringify({ ...eventBody(), pad: 'x'.repeat(1024) }), 413],
  ]) {
    stubUpstream();
    assert.equal((await event(body)).statusCode, status, name);
    assert.equal(calls.length, 0, name);
  }
});

test('hub-event: the RPC verdict maps to 204 / 400 and failures to 502 / 503', async () => {
  for (const [reply, status] of [
    [() => new Response('true'), 204],
    [() => new Response('false'), 400],
    [() => new Response('{}', { status: 503 }), 502],
    [() => { throw new TypeError('fetch failed'); }, 503],
  ]) {
    stubUpstream(reply);
    assert.equal((await event()).statusCode, status);
  }
});

test('hub-event: account fields are neither needed nor forwarded', async () => {
  stubUpstream();
  await event({ ...eventBody(), email: 'duck@inha.edu', nickname: 'duck', user_id: ID.entry, access_token: 'jwt' });
  assert.deepEqual(Object.keys(calls[0].body).sort(),
    ['p_acquisition_source', 'p_campaign', 'p_event_id', 'p_event_type', 'p_session_id', 'p_surface', 'p_target', 'p_visitor_id']);
});

// ---- browser payloads ----
function runBrowserScript(file, { hostname, search = '', game, storage = {}, fetcher = null }) {
  const sent = [];
  const store = () => {
    const data = new Map(Object.entries(storage));
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  };
  const window = { addEventListener() {} };
  const context = {
    window, console, URL, JSON, Date, Set, Array, Blob, setTimeout,
    crypto: { randomUUID: () => ID.event, getRandomValues: (a) => a },
    location: { href: `https://${hostname}/${search}`, hostname },
    history: { state: null, replaceState() {} },
    document: { currentScript: { dataset: { game } }, getElementById: () => null, readyState: 'complete', addEventListener() {} },
    sessionStorage: store(), localStorage: store(),
    navigator: {},
    fetch: (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return fetcher ? fetcher(url, init, sent) : new Promise(() => {});
    },
  };
  context.window = Object.assign(window, context);
  vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  return { window: context.window, sent };
}

test('browser: game-entry.js sends only event_id, entry_id, event_type and target', () => {
  const { window, sent } = runBrowserScript('game-entry.js', {
    hostname: 'survival.inhagame.example', search: `?ih_entry=${ID.entry}`, game: 'survival',
  });
  window.InhaGameEntry.landing();
  const landing = sent.find((s) => s.body.event_type === 'game_landing');
  assert.ok(landing, 'landing sent');
  assert.equal(landing.url, 'https://inhagame.example/api/hub-entry');
  assert.deepEqual(Object.keys(landing.body).sort(), ['entry_id', 'event_id', 'event_type', 'target']);
  assert.deepEqual(landing.body, { event_id: ID.event, entry_id: ID.entry, event_type: 'game_landing', target: 'survival' });
});

test('browser: game-entry.js reports nothing without a hub entry', () => {
  const { window, sent } = runBrowserScript('game-entry.js', { hostname: 'duck.inhagame.example', game: 'classic' });
  window.InhaGameEntry.landing();
  window.InhaGameEntry.play();
  assert.equal(sent.length, 0);
});

test('browser: hub-telemetry.js sends pseudonymous browser ids and no account fields', () => {
  const { window, sent } = runBrowserScript('hub-telemetry.js', {
    hostname: 'inhagame.example', game: undefined,
    storage: { 'inhagame-hub-visitor-v1': ID.visitor, 'inhagame-hub-session-v1': ID.session },
  });
  window.InhaHubTelemetry.track('hub_game_click', 'home', 'classic');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/hub-event');
  assert.deepEqual(Object.keys(sent[0].body).sort(),
    ['acquisition_source', 'campaign', 'event_id', 'event_type', 'session_id', 'surface', 'target', 'visitor_id']);
});

test('browser: confirmed telemetry waits for a 204 and retries the same event_id on transient failure', async () => {
  let attempt = 0;
  const { window, sent } = runBrowserScript('hub-telemetry.js', {
    hostname: 'inhagame.example', game: undefined,
    storage: { 'inhagame-hub-visitor-v1': ID.visitor, 'inhagame-hub-session-v1': ID.session },
    fetcher: async () => new Response(null, { status: ++attempt === 1 ? 503 : 204 })
  });
  const confirmed = await window.InhaHubTelemetry.trackConfirmed(
    'first_reward', 'campus', 'first_campus', { eventId: ID.event, retryDelays: [0] }
  );
  assert.equal(confirmed, ID.event);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(item => item.body.event_id), [ID.event, ID.event], 'retry reuses the idempotent event id');
  assert.deepEqual(sent.map(item => item.body.event_type), ['first_reward', 'first_reward']);
});

test('browser: confirmed telemetry does not retry a permanent 4xx contract refusal', async () => {
  const { window, sent } = runBrowserScript('hub-telemetry.js', {
    hostname: 'inhagame.example', game: undefined,
    storage: { 'inhagame-hub-visitor-v1': ID.visitor, 'inhagame-hub-session-v1': ID.session },
    fetcher: async () => new Response(null, { status: 400 })
  });
  const confirmed = await window.InhaHubTelemetry.trackConfirmed(
    'first_reward', 'campus', 'first_campus', { eventId: ID.event, retryDelays: [0, 0] }
  );
  assert.equal(confirmed, null);
  assert.equal(sent.length, 1);
});
