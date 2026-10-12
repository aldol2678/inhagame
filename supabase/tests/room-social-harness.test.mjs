import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalDbUrl, sanitizedPgEnvironment, userTransaction, assertContendedBackends, parsePgJson } from '../../scripts/room-social-pg-harness.mjs';

test('psql scalar booleans and JSON results are decoded without changing SQL meaning', () => {
  assert.equal(parsePgJson('f\n'), false); assert.equal(parsePgJson('t'), true);
  assert.deepEqual(parsePgJson('notice\n{"allowed":false}\n'), { allowed: false });
  assert.equal(parsePgJson('0'), 0); assert.throws(() => parsePgJson('not-json'));
});

test('DB harness refuses remote endpoints and libpq connection overrides', () => {
  assert.equal(assertLocalDbUrl('postgresql://postgres:fixture@127.0.0.1:54322/postgres'), 'postgresql://postgres:fixture@127.0.0.1:54322/postgres');
  for (const bad of [undefined, 'https://localhost:54322/postgres', 'postgres://postgres:x@db.example.com:54322/postgres',
    'postgres://postgres:x@localhost:5432/postgres', 'postgres://service_role:x@localhost:54322/postgres',
    'postgres://postgres:x@localhost:54322/production', 'postgres://postgres:x@localhost:54322/postgres?host=example.com',
    'postgres://postgres:x@localhost:54322/postgres#override']) assert.throws(() => assertLocalDbUrl(bad));
});

test('ambient credentials and libpq configuration cannot redirect the local child process', () => {
  assert.deepEqual(sanitizedPgEnvironment({ PATH: '/bin', HOME: '/tmp', PGHOST: 'remote', PGHOSTADDR: '1.2.3.4',
    PGSERVICE: 'production', PGOPTIONS: 'unsafe', PSQLRC: '/tmp/override', DATABASE_URL: 'remote', DB_URL: 'remote',
    SUPABASE_ACCESS_TOKEN: 'not-a-real-secret', SUPABASE_DB_PASSWORD: 'not-a-real-secret' }), { PATH: '/bin', HOME: '/tmp' });
});

test('race evidence requires every transaction, different backend PIDs and an actual lock wait', () => {
  const names = ['a', 'b'], rows = [{ pid: 1, applicationName: 'a', waiting: true }, { pid: 2, applicationName: 'b', waiting: true }];
  assert.deepEqual(assertContendedBackends(rows, names), rows);
  assert.throws(() => assertContendedBackends(rows.slice(0, 1), names));
  assert.throws(() => assertContendedBackends([rows[0], { ...rows[1], pid: 1 }], names));
  assert.throws(() => assertContendedBackends([rows[0], { ...rows[1], waiting: false }], names));
});

test('synthetic user RPCs run in separate bounded authenticated transactions', () => {
  const statement = userTransaction('00000000-0000-4000-8000-000000000001', 'select 1', 'room-social-fixture');
  assert.match(statement, /^begin;/); assert.match(statement, /set local role authenticated/);
  assert.match(statement, /"is_anonymous":false/); assert.match(statement, /commit;$/);
  assert.throws(() => userTransaction("bad';commit;", 'select 1'));
});

import { assertLocalApi } from '../../scripts/room-social-realtime-harness.mjs';
test('raw Realtime harness cannot connect to hosted URLs or override checked-in local port', () => {
  assert.equal(assertLocalApi('http://127.0.0.1:54321').origin,'http://127.0.0.1:54321');
  for(const value of ['https://example.supabase.co','http://localhost:54322','http://user:secret@localhost:54321','http://localhost:54321/realtime','http://localhost:54321?redirect=remote'])
    assert.throws(()=>assertLocalApi(value));
});
