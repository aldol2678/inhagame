// Disposable local stack only. GoTrue creates the fixture user; the browser performs the real login.
// SQL prepares only launch gates and pre-existing BACK_GATE progression, never a position, work
// result, wallet balance, challenge answer, session timestamp or settlement.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
export function assertConvenienceCampusLocalEnvironment(env) {
  assert.equal(env.CONVENIENCE_CAMPUS_LOCAL_QA, '1', 'Explicit disposable campus QA marker required');
  assert.match(env.API_URL ?? '', /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  let db; try { db = new URL(env.DB_URL); } catch { throw Error('DISPOSABLE_DATABASE_URL_INVALID'); }
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname));
  assert.match(db.port, /^\d+$/); assert.equal(db.search, ''); assert.equal(db.hash, '');
  for (const name of ['ANON_KEY', 'SERVICE_ROLE_KEY']) assert.ok(env[name], `Missing disposable ${name}`);
  assert.notEqual(env.NODE_ENV, 'production'); assert.notEqual(env.VERCEL_ENV, 'production');
}
export async function createConvenienceCampusBrowserDatabase({ env = process.env } = {}) {
  assertConvenienceCampusLocalEnvironment(env);
  const sql = statement => {
    try { return execFileSync('psql', [env.DB_URL, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c',
      `set statement_timeout='15s';set lock_timeout='10s';${statement}`], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { throw Error('DISPOSABLE_CAMPUS_SQL_FAILED'); } // Do not log connection, SQL, user UUID or credentials.
  };
  const json = statement => JSON.parse(sql(statement).split('\n').at(-1));
  const gates = () => json(`select jsonb_build_object(
    'income',(select to_jsonb(r) from private.world_income_runtime r),
    'authority',(select to_jsonb(r) from private.world_convenience_runtime r),
    'definition',(select to_jsonb(d) from private.world_income_definitions d where quest_id='quest.side.convenience_help'),
    'reward',(select to_jsonb(r) from private.world_reward_definitions r where reward_id='reward.income.convenience_help'));`);
  const original = gates();
  assert.equal(original.income.enabled, false); assert.equal(original.authority.enabled, false);
  assert.equal(original.definition.status, 'CLOSED'); assert.equal(original.reward.status, 'DISABLED');
  let active = false;
  async function close() {
    if (!active) return;
    sql(`update private.world_income_runtime set enabled=${original.income.enabled};
      update private.world_convenience_runtime set enabled=${original.authority.enabled};
      update private.world_income_definitions set status=${lit(original.definition.status)} where quest_id='quest.side.convenience_help';
      update private.world_reward_definitions set status=${lit(original.reward.status)} where reward_id='reward.income.convenience_help';`);
    assert.deepEqual(gates(), original, 'Restore all exact candidate launch rows after browser success or failure'); active = false;
    // Do not rewrite/delete append-only receipt ledgers. Fixture account and rows are destroyed by
    // the existing workflow's unconditional `supabase stop --no-backup` disposable-stack cleanup.
  }
  try {
    active = true;
    sql(`update private.world_income_runtime set enabled=true;update private.world_convenience_runtime set enabled=true;
      update private.world_income_definitions set status='ACTIVE' where quest_id='quest.side.convenience_help';
      update private.world_reward_definitions set status='ACTIVE' where reward_id='reward.income.convenience_help';`);
    const email = `campus-convenience-${randomUUID()}@example.test`, password = `Disposable-campus-${randomUUID()}!`;
    const response = await fetch(`${env.API_URL}/auth/v1/admin/users`, { method: 'POST', redirect: 'error',
      headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }) });
    assert.ok(response.ok, `Real disposable GoTrue fixture account creation: HTTP ${response.status}`);
    const created = await response.json(), userId = created.id; assert.ok(/^[0-9a-f-]{36}$/i.test(userId), 'Fixture user identity invalid');
    sql(`insert into public.profiles(user_id,nickname,is_banned) values(${lit(userId)},'편의점검증',false)
      on conflict(user_id) do update set is_banned=false;
      insert into private.world_quest_progress_v1(user_id,quest_id,stage) values(${lit(userId)},'campus_navigation_intro_v1',9);`);
    const readback = () => json(`select jsonb_build_object(
      'balance',coalesce((select balance from private.world_wallets where user_id=${lit(userId)} and currency_id='currency.induck_coin'),0),
      'settled',(select count(*) from private.world_income_sessions where user_id=${lit(userId)} and state='SETTLED'),
      'rewards',(select count(*) from private.world_reward_transactions where user_id=${lit(userId)} and reward_id='reward.income.convenience_help'),
      'linkedCredits',(select count(*) from private.world_income_sessions s
        join private.world_reward_transactions r on r.user_id=s.user_id and r.source_id=s.session_id::text and r.reward_id=s.reward_id and r.status='SUCCESS'
        join private.world_reward_transaction_entries e on e.reward_transaction_id=r.reward_transaction_id and e.grant_type='CURRENCY'
        join private.world_currency_transactions c on c.transaction_id::text=e.child_transaction_id and c.user_id=s.user_id
        where s.user_id=${lit(userId)} and s.state='SETTLED' and s.receipt->>'committed'='true' and (s.receipt->>'coin')::integer=30
          and e.granted=30 and c.amount=30 and c.balance_after=c.balance_before+30),
      'authorityRows',(select count(*) from private.world_convenience_authority where user_id=${lit(userId)}),
      'authorityActive',(select coalesce(bool_or(active),false) from private.world_convenience_authority where user_id=${lit(userId)}));`);
    return { userId, credentials: { email, password }, readback, close };
  } catch (error) { await close(); throw error; }
}
