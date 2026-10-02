// The hub APIs end to end against the disposable local Supabase stack: the unmodified handlers
// in apps/world/api run, and their calls to the production REST URL are redirected to the local
// API. Anything else (any other host or path) fails the test, so production is unreachable.
//
// Needs API_URL, ANON_KEY and DB_URL from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const { API_URL, ANON_KEY, DB_URL, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL, 'API_URL, ANON_KEY and DB_URL come from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

const PRODUCTION = ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url);
const realFetch = globalThis.fetch;
const forwarded = [];
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  const rpc = /^\/rest\/v1\/rpc\/(log_inhagame_game_entry_v1|log_inhagame_hub_event_v2)$/;
  if (!target.startsWith(`${PRODUCTION}/`) || !rpc.test(target.slice(PRODUCTION.length))) {
    throw new Error(`integration: blocked request to ${target}`);
  }
  // The production publishable key is swapped for the local one; nothing else changes.
  const headers = { ...init.headers, apikey: ANON_KEY };
  forwarded.push({ path: target.slice(PRODUCTION.length), body: JSON.parse(init.body) });
  return realFetch(API_URL + target.slice(PRODUCTION.length), { ...init, headers });
};

const require = createRequire(import.meta.url);
const hubEntry = require('../../../apps/world/api/hub-entry.js');
const hubEvent = require('../../../apps/world/api/hub-event.js');

function sql(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try {
    return execFileSync('psql', [DB_URL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return execFileSync('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8' }).trim();
  }
}
const rows = (where) => sql(`select coalesce(json_agg(e order by e.created_at, e.event_type), '[]') from public.inhagame_hub_events e where ${where}`);
const parsedRows = (where) => JSON.parse(rows(where));

async function send(handler, headers, body) {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers, body: JSON.stringify(body) }, res);
  return res.statusCode;
}
const GAME_ORIGIN = { classic: 'https://duck.inhagame.example', induckup: 'https://induckup.inhagame.example',
  survival: 'https://survival.inhagame.example', 'induck-grow': 'https://grow.inhagame.example', campus: 'https://inhagame.example' };

/** A hub card click through /api/hub-event; returns its event id (the entry id games carry). */
async function click(target, ids = { session: randomUUID(), visitor: randomUUID() }) {
  const eventId = randomUUID();
  const status = await send(hubEvent, { origin: 'https://inhagame.example', host: 'inhagame.example' }, {
    event_id: eventId, session_id: ids.session, visitor_id: ids.visitor,
    event_type: target === 'campus' ? 'campus_entry_click' : 'hub_game_click', surface: 'home', target,
    acquisition_source: 'direct', campaign: null,
  });
  assert.equal(status, 204, `hub click for ${target}`);
  return { entryId: eventId, ...ids };
}
/** A game stage through /api/hub-entry from the game's own origin. */
const stage = (game, entryId, eventType, eventId = randomUUID(), bodyTarget = game) =>
  send(hubEntry, { origin: GAME_ORIGIN[game] }, { event_id: eventId, entry_id: entryId, event_type: eventType, target: bodyTarget });

test('click -> landing -> play is stored once per stage and attributed to the click', async () => {
  const { entryId, session, visitor } = await click('classic');
  const landingId = randomUUID();
  assert.equal(await stage('classic', entryId, 'game_landing', landingId), 204);
  assert.equal(await stage('classic', entryId, 'game_play_start'), 204);
  assert.equal(await stage('classic', entryId, 'game_first_result'), 204);
  assert.equal(await stage('classic', entryId, 'game_first_clear'), 204);

  const stored = parsedRows(`entry_id = '${entryId}'`);
  assert.deepEqual(stored.map((r) => r.event_type).sort(),
    ['game_first_clear', 'game_first_result', 'game_landing', 'game_play_start']);
  for (const row of stored) {
    assert.equal(row.target, 'classic');
    assert.equal(row.surface, 'game');
    assert.equal(row.session_id, session, 'session comes from the click, not the game');
    assert.equal(row.visitor_id, visitor, 'visitor comes from the click, not the game');
  }
  assert.equal(stored.find((r) => r.event_type === 'game_landing').event_id, landingId);
});

test('duplicate stages and duplicate event ids are idempotent', async () => {
  const { entryId } = await click('survival');
  const landingId = randomUUID();
  assert.equal(await stage('survival', entryId, 'game_landing', landingId), 204);
  assert.equal(await stage('survival', entryId, 'game_landing'), 204, 'second landing, new event id');
  assert.equal(await stage('survival', entryId, 'game_landing', landingId), 204, 'same event id resent');
  assert.equal(parsedRows(`entry_id = '${entryId}' and event_type = 'game_landing'`).length, 1);

  const other = await click('survival');
  assert.equal(await stage('survival', other.entryId, 'game_landing', landingId), 204, 'event id reused for another entry');
  assert.equal(parsedRows(`event_id = '${landingId}'`)[0].entry_id, entryId, 'the first row is never overwritten');
  assert.equal(parsedRows(`entry_id = '${other.entryId}'`).length, 0);
});

test('a stage without a stored click is refused (409)', async () => {
  const missing = randomUUID();
  assert.equal(await stage('classic', missing, 'game_landing'), 409);
  assert.equal(parsedRows(`entry_id = '${missing}'`).length, 0);
});

test('play before landing is refused until the landing exists', async () => {
  const { entryId } = await click('induckup');
  assert.equal(await stage('induckup', entryId, 'game_play_start'), 409);
  assert.equal(await stage('induckup', entryId, 'game_first_result'), 409);
  assert.equal(await stage('induckup', entryId, 'game_landing'), 204);
  assert.equal(await stage('induckup', entryId, 'game_play_start'), 204);
});

test('an entry cannot be reused by another game', async () => {
  const { entryId } = await click('classic');
  assert.equal(await stage('survival', entryId, 'game_landing'), 409, 'database refuses the other game');
  assert.equal(await stage('classic', entryId, 'game_landing', randomUUID(), 'survival'), 400,
    'API refuses a body target that differs from the origin');
  assert.equal(parsedRows(`entry_id = '${entryId}'`).length, 0);
});

test('an entry older than 30 minutes has expired', async () => {
  const { entryId } = await click('classic');
  sql(`update public.inhagame_hub_events set created_at = now() - interval '31 minutes' where event_id = '${entryId}'`);
  assert.equal(await stage('classic', entryId, 'game_landing'), 409);
  const fresh = await click('classic');
  sql(`update public.inhagame_hub_events set created_at = now() - interval '29 minutes' where event_id = '${fresh.entryId}'`);
  assert.equal(await stage('classic', fresh.entryId, 'game_landing'), 204);
});

test('campus entries use the campus_entry_click from the hub', async () => {
  const { entryId } = await click('campus');
  assert.equal(await stage('campus', entryId, 'game_landing'), 204);
  assert.equal(parsedRows(`entry_id = '${entryId}'`)[0].target, 'campus');
});

test('Grow click -> landing -> play is supported', async () => {
  const { entryId } = await click('induck-grow');
  assert.equal(await stage('induck-grow', entryId, 'game_landing'), 204);
  assert.equal(await stage('induck-grow', entryId, 'game_play_start'), 204);
  assert.deepEqual(parsedRows(`entry_id = '${entryId}'`).map((r) => r.event_type),
    ['game_landing', 'game_play_start']);
});

test('hub events outside the stored context are refused by the database (400)', async () => {
  const eventId = randomUUID();
  const status = await send(hubEvent, { origin: 'https://inhagame.example', host: 'inhagame.example' }, {
    event_id: eventId, session_id: randomUUID(), visitor_id: randomUUID(),
    event_type: 'hub_game_click', surface: 'home', target: 'campus',
  });
  assert.equal(status, 400);
  assert.equal(parsedRows(`event_id = '${eventId}'`).length, 0);
});

test('the anon key can log events but cannot read them or the ops summary', async () => {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  const table = await realFetch(`${API_URL}/rest/v1/inhagame_hub_events?select=event_id&limit=1`, { headers });
  assert.ok([401, 403].includes(table.status), `table read refused (got ${table.status})`);
  const ops = await realFetch(`${API_URL}/rest/v1/rpc/get_inhagame_hub_ops_v1`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok([401, 403, 404].includes(ops.status), `ops summary refused (got ${ops.status})`);
});

test('the ops summary counts the funnel written through the APIs', async () => {
  const { entryId } = await click('survival');
  await stage('survival', entryId, 'game_landing');
  await stage('survival', entryId, 'game_play_start');
  const funnel = JSON.parse(sql(`select public.get_inhagame_hub_ops_v1()->'entry_funnel'`));
  const survival = funnel.find((f) => f.target === 'survival');
  const expect = (type) => Number(sql(`select count(*) from public.inhagame_hub_events c
    where c.target = 'survival' and c.event_type = 'hub_game_click'
      and (c.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
      and exists (select 1 from public.inhagame_hub_events a where a.entry_id = c.event_id and a.event_type = '${type}')`));
  assert.ok(survival.clicks >= 1);
  assert.equal(survival.landings, expect('game_landing'));
  assert.equal(survival.plays, expect('game_play_start'));
});

test('only the two hub RPCs were called, with only the intended fields', () => {
  assert.ok(forwarded.length > 0);
  for (const { path, body } of forwarded) {
    const keys = Object.keys(body).sort();
    if (path.endsWith('log_inhagame_game_entry_v1')) {
      assert.deepEqual(keys, ['p_entry_id', 'p_event_id', 'p_event_type', 'p_target']);
    } else {
      assert.deepEqual(keys, ['p_acquisition_source', 'p_campaign', 'p_event_id', 'p_event_type', 'p_session_id', 'p_surface', 'p_target', 'p_visitor_id']);
    }
  }
});
