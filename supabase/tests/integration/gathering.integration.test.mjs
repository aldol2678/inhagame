// Gathering P0 against the disposable loopback DB.
// No player HTTP path exists in P0; service-role calls model the future trusted world adapter.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  GATHERING_SOURCE_REGISTRY,
  gatheringSourceAuthorityRow
} from '../../../apps/world/src/activity/gathering-source-registry.js';

const run = promisify(execFile), DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;

async function query(sql) {
  const args = ['-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  let result;
  try { result = await run('psql', [DB_URL, ...args]); }
  catch (error) {
    if (error.code !== 'ENOENT' || !process.env.PSQL_FALLBACK_CONTAINER) throw error;
    result = await run('docker', ['exec', process.env.PSQL_FALLBACK_CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres', ...args]);
  }
  return result.stdout.trim();
}
const json = async sql => JSON.parse((await query(sql)).split('\n').at(-1));
const serverSql = expression => json(
  `set role service_role; set request.jwt.claims='{"role":"service_role"}'; select ${expression};`);
const harvest = (user, sourceRef = 'gathering.campus.leaf_pile_01', key = randomUUID()) =>
  serverSql(`public.world_gathering_harvest_v1(${[user,sourceRef,key].map(lit).join(',')})`);

const users = [];
const policy = { policyVersion: 'gathering.fixture.v1', lifeXp: 10 };
let previous;

async function user({ anonymous = false, banned = false } = {}) {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},now(),${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(id)},'채집P0',${banned});`);
  return id;
}
async function configure({ enabled = true, source = 'ACTIVE', skill = 'ACTIVE', collection = 'ACTIVE',
  interval = 1, policyValue = policy } = {}) {
  await query(`update private.world_gathering_runtime
      set enabled=${enabled},policy=${policyValue === null ? 'null' : lit(JSON.stringify(policyValue)) + '::jsonb'},
          minimum_harvest_interval_ms=${interval ?? 'null'};
    update private.world_gathering_source_catalog set status=${lit(source)}
      where source_ref='gathering.campus.leaf_pile_01';
    update private.world_life_skill_catalog set status=${lit(skill)} where skill_id='life.gathering';
    update private.world_collection_entry_catalog set status=${lit(collection)}
      where entry_id='collection.plant.campus_leaf';`);
}

before(async () => {
  previous = await json(`select jsonb_build_object(
    'runtime',to_jsonb(r),
    'source',(select status from private.world_gathering_source_catalog
      where source_ref='gathering.campus.leaf_pile_01'),
    'skill',(select status from private.world_life_skill_catalog where skill_id='life.gathering'),
    'collection',(select status from private.world_collection_entry_catalog
      where entry_id='collection.plant.campus_leaf'))
    from private.world_gathering_runtime r where singleton`);
  assert.equal(previous.runtime.enabled, false);
  assert.equal(previous.source, 'COMING_SOON');
  assert.equal(previous.skill, 'COMING_SOON');
  assert.equal(previous.collection, 'COMING_SOON');
  await configure();
});

after(async () => {
  if (previous) {
    await query(`update private.world_gathering_runtime set
      enabled=${previous.runtime.enabled},
      policy=${previous.runtime.policy === null ? 'null' : lit(JSON.stringify(previous.runtime.policy)) + '::jsonb'},
      minimum_harvest_interval_ms=${previous.runtime.minimum_harvest_interval_ms ?? 'null'};
      update private.world_gathering_source_catalog set status=${lit(previous.source)}
        where source_ref='gathering.campus.leaf_pile_01';
      update private.world_life_skill_catalog set status=${lit(previous.skill)} where skill_id='life.gathering';
      update private.world_collection_entry_catalog set status=${lit(previous.collection)}
        where entry_id='collection.plant.campus_leaf';`);
  }
  if (users.length) await query(`delete from auth.users where id in (${users.map(lit).join(',')})`);
});

test('Gathering source DB mirror equals the code Registry authority subset', async () => {
  const db = await json(`select coalesce(json_agg(json_build_object(
    'source_ref',source_ref,'activity_id',activity_id,'item_id',item_id,
    'collection_entry_id',collection_entry_id,'skill_id',skill_id,'quantity',quantity,
    'status',status,'definition_version',definition_version) order by source_ref),'[]')
    from private.world_gathering_source_catalog`);
  const code = GATHERING_SOURCE_REGISTRY.list().map(gatheringSourceAuthorityRow);
  assert.deepEqual(db, code);
});

test('concurrent exact retries settle one leaf, one discovery and one Gathering XP entry', async () => {
  const actor = await user(), key = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => harvest(actor, undefined, key)));
  assert.equal(results.filter(result => result.status === 'HARVESTED').length, 1);
  assert.equal(results.filter(result => result.status === 'ALREADY_PROCESSED').length, 7);
  const first = results[0];
  for (const result of results) {
    assert.equal(result.attemptId, first.attemptId);
    assert.deepEqual(result.output, first.output);
    assert.deepEqual(result.receipt, first.receipt);
  }
  assert.deepEqual(first.output, {
    itemId: 'material.campus_leaf',
    quantity: 1,
    collectionEntryId: 'collection.plant.campus_leaf',
    skillId: 'life.gathering',
    lifeXp: 10
  });

  assert.deepEqual(await json(`select jsonb_build_object(
    'item',(select quantity from private.world_player_items where user_id=${lit(actor)} and item_id='material.campus_leaf'),
    'discoveries',(select count(*) from private.world_player_collection_discoveries where user_id=${lit(actor)}
      and entry_id='collection.plant.campus_leaf'),
    'events',(select count(*) from private.world_collection_discovery_events where user_id=${lit(actor)}
      and entry_id='collection.plant.campus_leaf'),
    'xp',(select total_xp from private.world_player_life_skills where user_id=${lit(actor)} and skill_id='life.gathering'),
    'xpTx',(select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(actor)}
      and skill_id='life.gathering'),
    'settlements',(select count(*) from private.world_activity_settlements where user_id=${lit(actor)}
      and activity_id='activity.gathering.campus'),
    'snapshots',(select count(*) from private.world_gathering_attempt_snapshots where user_id=${lit(actor)}),
    'contexts',(select count(*) from private.world_life_creature_activity_contexts where user_id=${lit(actor)}
      and activity_id='activity.gathering.campus'),
    'decision',(select decision from private.world_life_creature_bridge_decisions where user_id=${lit(actor)} limit 1)
  )`), {
    item: 1, discoveries: 1, events: 1, xp: 10, xpTx: 1,
    settlements: 1, snapshots: 1, contexts: 1, decision: 'NOOP_INACTIVE'
  });

  const snapshot = await json(`select snapshot from private.world_gathering_attempt_snapshots
    where attempt_id=${lit(first.attemptId)}`);
  assert.deepEqual(snapshot.policy, policy);
  assert.deepEqual(snapshot.output, first.output);
  await assert.rejects(query(`update private.world_gathering_attempt_snapshots set snapshot=snapshot
    where attempt_id=${lit(first.attemptId)}`), /GATHERING_SNAPSHOT_IMMUTABLE/);
});

test('runtime/source/Life/Collection gates fail closed and leave no partial attempt', async () => {
  const cases = [
    [{ enabled: false }, /GATHERING_UNAVAILABLE/],
    [{ source: 'COMING_SOON' }, /GATHERING_SOURCE_UNAVAILABLE/],
    [{ skill: 'COMING_SOON' }, /LIFE_SKILL_INACTIVE/],
    [{ collection: 'COMING_SOON' }, /COLLECTION_ENTRY_INACTIVE/]
  ];
  for (const [overrides, expected] of cases) {
    const actor = await user();
    await configure(overrides);
    await assert.rejects(harvest(actor), expected);
    assert.equal(await query(`select count(*) from private.world_activity_attempts where user_id=${lit(actor)}`), '0');
    assert.equal(await query(`select count(*) from private.world_gathering_attempt_snapshots where user_id=${lit(actor)}`), '0');
    assert.equal(await query(`select count(*) from private.world_activity_settlements where user_id=${lit(actor)}`), '0');
    await configure();
  }
});

test('identity, account and server-side cooldown gates are enforced before value moves', async () => {
  const actor = await user();
  await assert.rejects(harvest(actor, 'gathering.remote'), /INVALID_GATHERING_IDENTITY/);
  await assert.rejects(harvest(await user({ banned: true })), /ACCOUNT_UNAVAILABLE/);
  await assert.rejects(harvest(await user({ anonymous: true })), /ACCOUNT_UNAVAILABLE/);

  await configure({ interval: 60000 });
  await harvest(actor);
  await assert.rejects(harvest(actor), /GATHERING_RATE_LIMITED/);
  assert.equal(await query(`select quantity from private.world_player_items
    where user_id=${lit(actor)} and item_id='material.campus_leaf'`), '1');
  await configure();
});

test('account deletion cascades Gathering snapshots with the owned outcome state', async () => {
  const actor = await user();
  await harvest(actor);
  await query(`delete from auth.users where id=${lit(actor)}`);
  assert.equal(await query(`select count(*) from private.world_gathering_attempt_snapshots where user_id=${lit(actor)}`), '0');
  assert.equal(await query(`select count(*) from private.world_activity_settlements where user_id=${lit(actor)}`), '0');
});
