// Life Skill Book P0 against the disposable local stack. The player acts only through the Data API
// (PostgREST) with a minted JWT; psql is used for fixtures. Every server response is fed through the
// browser client's own parsers, so the client/server view contract is checked end to end.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import {
  LIFE_SKILL_BOOK_RPC,
  parseLifeSkillList,
  parseLifeSkillTree
} from '../../../apps/world/src/life-skills/life-skill-book-client.js';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && JWT_SECRET, 'API_URL, ANON_KEY, DB_URL and JWT_SECRET come from the local stack');
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
function jwt(sub, { anonymous = false } = {}) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: anonymous,
    session_id: randomUUID(), iat: now, exp: now + 600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function rpc(token, fn, body = {}) {
  const response = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the raw text */ }
  return { status: response.status, body: parsed, text };
}

const users = [];
function createUser() {
  const id = randomUUID();
  sql(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`book-${id}@example.test`)}, now(), false)`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`b${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}
// Committed state: life.fishing ACTIVE, its tree COMING_SOON (20261004161000). Restore it after fixtures.
const committed = JSON.parse(sql(`select jsonb_build_object('skill',
  (select status from private.world_life_skill_catalog where skill_id='life.fishing'),
  'tree',(select jsonb_object_agg(node_id,status) from private.world_life_skill_tree_catalog where skill_id='life.fishing'))`));
function restoreFishing() {
  sql(`update private.world_life_skill_catalog set status=${lit(committed.skill)} where skill_id='life.fishing';
    ${Object.entries(committed.tree).map(([node, status]) =>
      `update private.world_life_skill_tree_catalog set status=${lit(status)} where node_id=${lit(node)};`).join('\n')}`);
}
test.after(() => {
  restoreFishing();
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});

test('the committed book lists Fishing without a tree; hidden skills stay hidden', async () => {
  assert.equal(committed.skill, 'ACTIVE');
  assert.ok(Object.values(committed.tree).every(status => status === 'COMING_SOON'));
  const live = await rpc(jwt(createUser()), LIFE_SKILL_BOOK_RPC.LIST);
  assert.deepEqual(parseLifeSkillList(live.body)?.skills.map(s => [s.skillId, s.level]), [['life.fishing', 1]]);
  const liveTree = parseLifeSkillTree((await rpc(jwt(createUser()), LIFE_SKILL_BOOK_RPC.TREE, { p_skill_id: 'life.fishing' })).body);
  assert.deepEqual(liveTree.nodes, [], 'no tree node is visible until nodes are activated');
  const hidden = await rpc(jwt(createUser()), LIFE_SKILL_BOOK_RPC.TREE, { p_skill_id: 'life.mining' });
  assert.equal(hidden.body?.message, 'LIFE_SKILL_NOT_FOUND', hidden.text);

  // Fixture: back to the pre-activation state.
  sql("update private.world_life_skill_catalog set status='COMING_SOON' where skill_id='life.fishing'");
  const token = jwt(createUser());
  const list = await rpc(token, LIFE_SKILL_BOOK_RPC.LIST);
  assert.equal(list.status, 200);
  assert.deepEqual(parseLifeSkillList(list.body)?.skills, []);
  const tree = await rpc(token, LIFE_SKILL_BOOK_RPC.TREE, { p_skill_id: 'life.fishing' });
  assert.notEqual(tree.status, 200);
  assert.equal(tree.body?.message, 'LIFE_SKILL_NOT_FOUND', tree.text);
  const anon = await rpc(ANON_KEY, LIFE_SKILL_BOOK_RPC.LIST);
  assert.notEqual(anon.status, 200, 'anon cannot read a Life Skill Book');
  const guest = await rpc(jwt(randomUUID(), { anonymous: true }), LIFE_SKILL_BOOK_RPC.LIST);
  assert.match(guest.text, /PERMANENT_ACCOUNT_REQUIRED/);
  restoreFishing();
});

test('signed-in player: list, tree, rank-up, replay and free reset through the Data API', async () => {
  const user = createUser();
  const token = jwt(user);
  sql(`update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';
    update private.world_life_skill_tree_catalog set status='ACTIVE' where skill_id='life.fishing';
    select private.world_life_skill_xp_apply_v1(${lit(user)},'life.fishing',300,'activity','activity.fishing.inkyung:book-it','book-it:${user}');`);

  const list = parseLifeSkillList((await rpc(token, LIFE_SKILL_BOOK_RPC.LIST)).body);
  assert.deepEqual(list.skills.map(s => [s.skillId, s.level, s.sp.available]), [['life.fishing', 3, 2]]);

  const tree = parseLifeSkillTree((await rpc(token, LIFE_SKILL_BOOK_RPC.TREE, { p_skill_id: 'life.fishing' })).body);
  assert.ok(tree, 'the real tree view satisfies the client parser');
  assert.equal(tree.nodes.length, 6);
  assert.deepEqual(tree.nodes.filter(n => n.canUnlock).map(n => n.nodeId), ['life.node.fishing.steady_hands']);

  const requestId = randomUUID();
  const first = await rpc(token, LIFE_SKILL_BOOK_RPC.UNLOCK, { p_node_id: 'life.node.fishing.steady_hands', p_request_id: requestId });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.status, 'SUCCESS');
  assert.ok(parseLifeSkillTree(first.body.tree));
  const replay = await rpc(token, LIFE_SKILL_BOOK_RPC.UNLOCK, { p_node_id: 'life.node.fishing.steady_hands', p_request_id: requestId });
  assert.equal(replay.body.status, 'ALREADY_PROCESSED');
  assert.equal(sql(`select count(*) from private.world_life_sp_transactions where user_id=${lit(user)}`), '1',
    'a replayed request spends once');

  const reset = await rpc(token, LIFE_SKILL_BOOK_RPC.RESET, { p_skill_id: 'life.fishing', p_request_id: randomUUID() });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(reset.body.refundedSp, 1);
  const afterReset = parseLifeSkillTree(reset.body.tree);
  assert.equal(afterReset.skill.sp.available, 2);
  assert.equal(afterReset.reset.resetBlockedBy, 'EMPTY');

  const forged = await rpc(token, LIFE_SKILL_BOOK_RPC.UNLOCK,
    { p_node_id: 'life.node.fishing.steady_hands', p_request_id: randomUUID(), p_user: randomUUID() });
  assert.notEqual(forged.status, 200, 'no Life Book RPC accepts a user id');
});
