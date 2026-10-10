// Browser fishing client -> /api/world-fishing handler -> local Data API -> DB, end to end.
// The handler and service are the production modules; only the verified user and the service
// credential are local (a JWT minted with the local JWT_SECRET). psql is used for fixtures.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createFishingApiHandler, createFishingRpc, createFishingService } from '../../../apps/world/server/fishing-service.mjs';
import { FISHING_CLIENT_STATE, createFishingClient } from '../../../apps/world/src/activity/fishing-client.js';
import { FISHING_SPOTS } from '../../../apps/world/src/activity/fishing-spots.js';

const { API_URL, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && DB_URL && JWT_SECRET, 'API_URL, DB_URL and JWT_SECRET come from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

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
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
function serviceKey() {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'service_role', iss: 'supabase-demo', iat: now, exp: now + 600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}

const users = [];
function createUser() {
  const id = randomUUID();
  sql(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`fish-${id}@example.test`)}, now(), false)`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`f${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}

// An in-process "fetch" to the production handler: the token names the verified user.
function endpoint({ enabled = true } = {}) {
  const handler = createFishingApiHandler({
    enabled,
    service: createFishingService({
      verifyUser: async (authorization) => authorization?.replace(/^Bearer /, '') ?? null,
      rpc: createFishingRpc({ url: API_URL, serviceKey: serviceKey() })
    })
  });
  return async (url, init) => {
    assert.equal(url, '/api/world-fishing');
    let status = 200, payload = null;
    const res = {
      setHeader() {},
      status(code) { status = code; return this; },
      json(body) { payload = body; return this; },
      end() { return this; }
    };
    await handler({ method: init.method, headers: { 'content-type': init.headers['Content-Type'],
      authorization: init.headers.Authorization, host: 'world.test' }, body: init.body }, res);
    return { status, ok: status < 400, json: async () => payload };
  };
}

const committed = sql(`select row_to_json(r)::text from private.world_fishing_runtime r`);
test.after(() => {
  const r = JSON.parse(committed);
  sql(`update private.world_fishing_runtime set enabled=${r.enabled},
    policy=${r.policy === null ? 'null' : `${lit(JSON.stringify(r.policy))}::jsonb`},
    minimum_start_interval_ms=${r.minimum_start_interval_ms ?? 'null'},presence_required=${r.presence_required}`);
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});

test('a switched-off endpoint keeps fishing unavailable', async () => {
  const fishing = createFishingClient({ getToken: async () => createUser(), fetcher: endpoint({ enabled: false }) });
  assert.equal(await fishing.setAccount('a'), false);
  assert.equal(fishing.state, FISHING_CLIENT_STATE.UNAVAILABLE);
});

test('cast, bite, hook: the server result settles one carp, one discovery and Fishing XP', async () => {
  // Committed activation is the candidate policy; a short fixture wait keeps the test fast.
  assert.equal(JSON.parse(committed).policy.policyVersion, 'fishing.candidate.v1');
  sql(`update private.world_fishing_runtime set policy='{"policyVersion":"fishing.fixture.client","minWaitMs":300,
    "maxWaitMs":300,"responseWindowMs":8000,"attemptTtlMs":20000,"lifeXp":20}'::jsonb, minimum_start_interval_ms=1,presence_required=false`);
  const user = createUser();
  const fishing = createFishingClient({ getToken: async () => user, fetcher: endpoint() });
  assert.equal(await fishing.setAccount(user), true);
  assert.deepEqual(fishing.read.skill, { level: 1, totalXp: 0, nextLevelXp: 100 });

  const started = await fishing.start(FISHING_SPOTS[1].sourceRef);
  assert.equal(started.outcome, 'STARTED');
  assert.equal(fishing.attempt.sourceRef, 'fishing.inkyung.south_01');
  while (fishing.serverNow() < fishing.attempt.biteAtMs + 100) await delay(50);
  const hooked = await fishing.hook();
  assert.equal(hooked.outcome, 'SETTLED', JSON.stringify(hooked));
  assert.equal(fishing.attempt.result.reason, 'CAUGHT');
  assert.equal(fishing.read.settlement, 'SETTLED');
  assert.equal(fishing.read.carpQuantity, 1);
  assert.equal(fishing.read.discovered, true);
  assert.deepEqual(fishing.read.skill, { level: 1, totalXp: 20, nextLevelXp: 100 });
  assert.equal(sql(`select count(*) from private.world_activity_settlements where user_id=${lit(user)}`), '1');

  // A second HOOK / settle replays; nothing is granted twice.
  assert.equal((await fishing.refresh()).outcome, 'DONE');
  assert.equal(sql(`select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(user)}`), '1');

  // Early hook: the server decides, the client only renders it.
  fishing.dismiss();
  await delay(5);
  assert.equal((await fishing.start(FISHING_SPOTS[0].sourceRef)).outcome, 'STARTED');
  const early = await fishing.hook();
  assert.equal(early.outcome, 'DONE');
  assert.equal(fishing.attempt.result.reason, 'PREMATURE_HOOK');
  assert.equal(fishing.read?.carpQuantity, 1);
});

test('F3 client -> handler -> DB refuses a cast until trusted server evidence arrives', async () => {
  sql(`update private.world_fishing_runtime set presence_required=true,policy='{"policyVersion":"fishing.fixture.client.f3",
    "minWaitMs":300,"maxWaitMs":300,"responseWindowMs":8000,"attemptTtlMs":20000,"lifeXp":20}'::jsonb,minimum_start_interval_ms=1`);
  const user=createUser(), session=randomUUID(), spot=FISHING_SPOTS[0];
  const fishing=createFishingClient({ getToken: async () => user, fetcher: endpoint() });
  assert.equal(await fishing.setAccount(user),true);
  await fishing.start(spot.sourceRef);
  assert.equal(fishing.lastError,'FISHING_POSITION_UNAVAILABLE');
  assert.equal(sql(`select count(*) from private.world_activity_attempts where user_id=${lit(user)}`),'0');
  // Only this server fixture can issue evidence. The browser sends the existing ID-only start.
  sql(`set role service_role; set request.jwt.claims='{"role":"service_role"}';
    select public.world_fishing_observe_position_v1(${lit(user)},${lit(session)},1,
      ${spot.position.x},0,${spot.position.z},'CAMPUS','ON_FOOT',clock_timestamp())`);
  assert.equal((await fishing.start(spot.sourceRef)).outcome,'STARTED');
  while (fishing.serverNow()<fishing.attempt.biteAtMs+100) await delay(50);
  assert.equal((await fishing.hook()).outcome,'SETTLED');
  assert.equal(fishing.read.carpQuantity,1); assert.equal(fishing.read.skill.totalXp,20);
  assert.equal(sql(`select count(*) from private.world_fishing_spot_leases where user_id=${lit(user)}`),'0');
  sql(`delete from private.world_fishing_positions where user_id=${lit(user)}`);
  await fishing.refresh();
  assert.equal(sql(`select count(*) from private.world_activity_settlements where user_id=${lit(user)}`),'1');
});
