// Offline contract for supabase/functions/verify-inha-mail: tokens are checked with Supabase
// Auth, the badge is granted only through claim_inha_mail_badge with the service role, and
// no mail provider is involved (Supabase Auth already confirmed both mailboxes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, fakeSupabase, invoke, loadEdgeFunction } from './harness.mjs';

const handler = await loadEdgeFunction('verify-inha-mail');
const PRIMARY = { id: '11111111-1111-4111-8111-111111111111', email: 'duck@gmail.com', email_confirmed_at: '2026-09-01T00:00:00Z' };
const SCHOOL = { id: '22222222-2222-4222-8222-222222222222', email: '12201234@inha.edu', email_confirmed_at: '2026-09-02T00:00:00Z' };

function setup({ primary = PRIMARY, school = SCHOOL, claim = () => ({ data: true }) } = {}) {
  const backend = fakeSupabase();
  if (primary) backend.addUser('primary-token', primary);
  if (school) backend.addUser('school-token', school);
  backend.onRpc('claim_inha_mail_badge', claim);
  return backend;
}
const verify = (body = { school_access_token: 'school-token' }, headers = bearer('primary-token')) =>
  invoke(handler, { headers, body });

test('valid primary and confirmed school mailbox grants the badge through the service role', async () => {
  const backend = setup();
  const res = await verify();
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { verified: true });
  const [call] = backend.rpcCalls('claim_inha_mail_badge');
  assert.equal(call.role, 'service_role');
  assert.deepEqual(call.args, { p_primary_id: PRIMARY.id, p_school_id: SCHOOL.id }, 'only ids reach the RPC');
});

test('inha.ac.kr mailboxes are accepted too, case-insensitively', async () => {
  setup({ school: { ...SCHOOL, email: 'Duck@INHA.AC.KR' } });
  assert.equal((await verify()).status, 200);
});

test('CORS preflight and wrong methods', async () => {
  setup();
  const preflight = await invoke(handler, { method: 'OPTIONS' });
  assert.equal(preflight.status, 200);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
});

test('malformed and missing input is rejected before any Auth or RPC call', async () => {
  const cases = [
    ['non-JSON body', { body: '{not json' }, 400, 'BAD_REQUEST'],
    ['no Authorization header', { headers: {} }, 400, 'MISSING_TOKENS'],
    ['school token missing', { body: {} }, 400, 'MISSING_TOKENS'],
    ['school token not a string', { body: { school_access_token: 42 } }, 400, 'MISSING_TOKENS'],
    ['school token too long', { body: { school_access_token: 'x'.repeat(8193) } }, 400, 'MISSING_TOKENS'],
  ];
  for (const [name, input, status, error] of cases) {
    const backend = setup();
    const res = await invoke(handler, { headers: input.headers ?? bearer('primary-token'), body: input.body ?? {} });
    assert.equal(res.status, status, name);
    assert.equal(res.json?.error, error, name);
    assert.equal(backend.rpcCalls('claim_inha_mail_badge').length, 0, `${name}: no claim`);
  }
});

test('unknown or expired sessions are unauthorized', async () => {
  for (const [name, headers, body] of [
    ['bad primary token', bearer('nope'), { school_access_token: 'school-token' }],
    ['bad school token', bearer('primary-token'), { school_access_token: 'nope' }],
  ]) {
    const backend = setup();
    const res = await verify(body, headers);
    assert.equal(res.status, 401, name);
    assert.equal(res.json.error, 'INVALID_SESSION');
    assert.equal(backend.rpcCalls('claim_inha_mail_badge').length, 0);
  }
});

test('the primary account must be permanent, confirmed and different from the school mailbox', async () => {
  for (const [name, primary] of [
    ['anonymous primary', { ...PRIMARY, is_anonymous: true }],
    ['unconfirmed primary', { ...PRIMARY, email_confirmed_at: null }],
    ['same account twice', SCHOOL],
  ]) {
    const backend = setup({ primary });
    const res = await verify();
    assert.equal(res.status, 403, name);
    assert.equal(res.json.error, 'PRIMARY_ACCOUNT_REQUIRED', name);
    assert.equal(backend.rpcCalls('claim_inha_mail_badge').length, 0, name);
  }
});

test('the school mailbox must be a confirmed, non-anonymous Inha address', async () => {
  for (const [name, school] of [
    ['gmail', { ...SCHOOL, email: 'duck@gmail.com' }],
    ['lookalike suffix', { ...SCHOOL, email: 'duck@inha.edu.evil.example' }],
    ['lookalike subdomain', { ...SCHOOL, email: 'duck@mail.inha.edu' }],
    ['unconfirmed', { ...SCHOOL, email_confirmed_at: null }],
    ['anonymous', { ...SCHOOL, is_anonymous: true }],
    ['no email', { ...SCHOOL, email: undefined }],
  ]) {
    const backend = setup({ school });
    const res = await verify();
    assert.equal(res.status, 403, name);
    assert.equal(res.json.error, 'SCHOOL_EMAIL_REQUIRED', name);
    assert.equal(backend.rpcCalls('claim_inha_mail_badge').length, 0, name);
  }
});

test('RPC failures map to stable errors without leaking details', async () => {
  setup({ claim: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) });
  const taken = await verify();
  assert.equal(taken.status, 409);
  assert.deepEqual(taken.json, { error: 'EMAIL_ALREADY_LINKED' });

  setup({ claim: () => ({ error: { code: 'P0001', message: 'School mailbox is not confirmed' } }) });
  const failed = await verify();
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.json, { error: 'CLAIM_FAILED' });
});
