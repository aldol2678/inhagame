// Key selection for Edge Functions: SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS (JSON
// dictionaries injected by the hosted runtime) first, legacy SUPABASE_SERVICE_ROLE_KEY /
// SUPABASE_ANON_KEY as fallback, fixed error codes when neither is present. Fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANON_KEY, PUBLISHABLE_KEY, SECRET_KEY, SERVICE_ROLE_KEY, bearer, fakeSupabase, invoke, loadEdgeFunction, resetEnv,
} from './harness.mjs';
import {
  SUPABASE_PUBLISHABLE_KEY_REQUIRED, SUPABASE_SECRET_KEY_REQUIRED, keyFromJsonEnv, supabasePublishableKey,
  supabaseSecretKey,
} from '../../functions/_shared/supabase-keys.ts';

const envOf = (values) => (name) => values[name];
const NEW_KEYS = {
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE_KEY }),
};

test('JSON key dictionary parsing picks the named entry and ignores malformed input', () => {
  assert.equal(keyFromJsonEnv('{"default":"sb_secret_a","edge-functions":"sb_secret_b"}'), 'sb_secret_a');
  assert.equal(keyFromJsonEnv('{"default":"sb_secret_a","edge-functions":"sb_secret_b"}', 'edge-functions'), 'sb_secret_b');
  assert.equal(keyFromJsonEnv('{"default":" sb_secret_a \\n"}'), 'sb_secret_a');
  for (const raw of [undefined, '', 'not json', '[]', 'null', '"sb_secret_a"', '{"default":1}', '{"other":"x"}', '{"default":"  "}'])
    assert.equal(keyFromJsonEnv(raw), '', String(raw));
});

test('secret key prefers SUPABASE_SECRET_KEYS and falls back to the legacy service_role env', () => {
  assert.equal(supabaseSecretKey('default', envOf({ ...NEW_KEYS, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })), SECRET_KEY);
  assert.equal(supabaseSecretKey('default', envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })), SERVICE_ROLE_KEY);
  assert.equal(supabaseSecretKey('default', envOf({ SUPABASE_SECRET_KEYS: '{broken', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })),
    SERVICE_ROLE_KEY, 'malformed JSON falls back instead of crashing');
  assert.equal(supabaseSecretKey('missing-name', envOf({ ...NEW_KEYS, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })), SERVICE_ROLE_KEY);
  assert.throws(() => supabaseSecretKey('default', envOf({})), new RegExp(`^Error: ${SUPABASE_SECRET_KEY_REQUIRED}$`));
  assert.throws(() => supabaseSecretKey('default', envOf({ SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: ' ' })),
    new RegExp(SUPABASE_SECRET_KEY_REQUIRED));
});

test('publishable key prefers SUPABASE_PUBLISHABLE_KEYS and falls back to the legacy anon env', () => {
  assert.equal(supabasePublishableKey('default', envOf({ ...NEW_KEYS, SUPABASE_ANON_KEY: ANON_KEY })), PUBLISHABLE_KEY);
  assert.equal(supabasePublishableKey('default', envOf({ SUPABASE_ANON_KEY: ANON_KEY })), ANON_KEY);
  assert.throws(() => supabasePublishableKey('default', envOf({})), new RegExp(SUPABASE_PUBLISHABLE_KEY_REQUIRED));
});

test('error messages never contain a key value', () => {
  try { supabaseSecretKey('default', envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: SECRET_KEY }) })); assert.fail('expected throw'); }
  catch (error) { assert.doesNotMatch(String(error), /sb_secret_|fixture/); }
});

// Every Edge Function that creates clients, run with only the new JSON env (legacy unset).
const onlyNewKeys = { ...NEW_KEYS, SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_ANON_KEY: undefined };
const neitherKey = { SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_ANON_KEY: undefined };

const USER = { id: '33333333-3333-4333-8333-333333333333', email: 'player@example.test' };

test('ranked-run-start uses the new secret/publishable keys when only they are present', async () => {
  const handler = await loadEdgeFunction('ranked-run-start');
  const backend = fakeSupabase();
  resetEnv(onlyNewKeys);
  backend.addUser('player-token', USER);
  backend.rows('profiles').push({ user_id: USER.id, is_banned: false });
  backend.onRpc('expire_ranked_sessions_v1', () => ({ data: 0 }));
  const res = await invoke(handler, { headers: bearer('player-token'), body: {} });
  assert.equal(res.status, 200);
  assert.equal(backend.writes('ranked_sessions')[0].role, 'service_role');
  assert.ok(backend.log.every((entry) => entry.role === 'service_role'), 'admin work uses the secret key');

  fakeSupabase();
  resetEnv(neitherKey);
  const missing = await invoke(handler, { headers: bearer('player-token'), body: {} });
  assert.equal(missing.status, 500);
  assert.equal(missing.json.error, 'START_FAILED');
  assert.match(missing.json.detail, /^SUPABASE_(PUBLISHABLE|SECRET)_KEY_REQUIRED$/);
});

test('world-duck-observe and verify-inha-mail use the new secret key when only it is present', async () => {
  const duck = await loadEdgeFunction('world-duck-observe');
  let backend = fakeSupabase();
  resetEnv(onlyNewKeys);
  backend.addUser('player-token', { ...USER, is_anonymous: false });
  backend.onRpc('world_inkyung_duck_observe_v1', (_args, ctx) => ({ data: { status: 'RECORDED', _role: ctx.role } }));
  const duckRes = await invoke(duck, { headers: bearer('player-token'), body: { duckId: 'inkyung_duck_white_01' } });
  assert.equal(backend.rpcCalls('world_inkyung_duck_observe_v1')[0]?.role, 'service_role', JSON.stringify(duckRes.json));

  backend = fakeSupabase();
  resetEnv(neitherKey);
  backend.addUser('player-token', { ...USER, is_anonymous: false });
  assert.equal((await invoke(duck, { headers: bearer('player-token'), body: { duckId: 'inkyung_duck_white_01' } })).status, 500);

  const mail = await loadEdgeFunction('verify-inha-mail');
  backend = fakeSupabase();
  resetEnv(onlyNewKeys);
  backend.addUser('primary-token', { id: '11111111-1111-4111-8111-111111111111', email: 'duck@gmail.com', email_confirmed_at: '2026-09-01T00:00:00Z' });
  backend.addUser('school-token', { id: '22222222-2222-4222-8222-222222222222', email: '12201234@inha.edu', email_confirmed_at: '2026-09-02T00:00:00Z' });
  backend.onRpc('claim_inha_mail_badge', () => ({ data: true }));
  const mailRes = await invoke(mail, { headers: bearer('primary-token'), body: { school_access_token: 'school-token' } });
  assert.equal(mailRes.status, 200);
  assert.equal(backend.rpcCalls('claim_inha_mail_badge')[0].role, 'service_role');
});

test('ranked-run-finish builds its clients from the new keys and fails closed without any key', async () => {
  const finish = await loadEdgeFunction('ranked-run-finish');
  fakeSupabase();
  resetEnv(onlyNewKeys);
  const unauth = await invoke(finish, { headers: bearer('unknown-token'), body: {} });
  assert.equal(unauth.status, 401, 'reaches the Auth check with publishable/secret keys only');
  fakeSupabase();
  resetEnv(neitherKey);
  await assert.rejects(invoke(finish, { headers: bearer('unknown-token'), body: {} }),
    /^Error: SUPABASE_(PUBLISHABLE|SECRET)_KEY_REQUIRED$/);
});
