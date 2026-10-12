// Exact migration replay against the disposable LOCAL stack only. Every fixture, schema
// reconstruction and migration is inside one transaction, rolled back even on a psql error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const { DB_URL, PSQL_FALLBACK_CONTAINER } = process.env;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//,
  'migration preservation test requires a disposable local DB_URL');
const migration = (name) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const moveFurniture = migration('20261011023000_world_shop_scoped_purchase_v2.sql');
const splitFashion = migration('20261011023100_world_student_center_shop_split.sql');

function sql(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try {
    return execFileSync('psql', [DB_URL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return execFileSync('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
}

// Keep every column, including receipt identity, provenance, timestamps, ledger references,
// balances, ownership quantities and metadata. Ordering makes JSON snapshots deterministic.
const economySnapshot = (user) => `jsonb_build_object(
  'purchases', (select coalesce(jsonb_agg(to_jsonb(r) order by r.purchase_id), '[]'::jsonb) from private.world_purchase_transactions r where r.user_id = '${user}'),
  'wallet', (select coalesce(jsonb_agg(to_jsonb(r) order by r.currency_id), '[]'::jsonb) from private.world_wallets r where r.user_id = '${user}'),
  'walletLedger', (select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), '[]'::jsonb) from private.world_currency_transactions r where r.user_id = '${user}'),
  'inventory', (select coalesce(jsonb_agg(to_jsonb(r) order by r.item_id), '[]'::jsonb) from private.world_player_items r where r.user_id = '${user}'),
  'grants', (select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), '[]'::jsonb) from private.world_item_grants r where r.user_id = '${user}')
)`;
const businessSnapshot = `(select jsonb_agg(to_jsonb(l) - 'shop_id' - 'position' order by l.listing_id) from private.world_shop_listings l)`;

test('exact shop migrations preserve business fields and historical economy while relocating existing listings', () => {
  const user = randomUUID();
  const out = sql(`
    begin;
    set local lock_timeout = '10s';
    set local statement_timeout = '60s';
    -- Reconstruct only the pre-candidate routing state. No production data or credentials.
    drop function public.purchase_world_shop_listing_v2(text,text,text);
    update private.world_shop_listings set shop_id = 'shop.student_center'
      where shop_id = 'shop.student_center_fashion';
    update private.world_shop_listings set shop_id = 'shop.student_center', position = 3
      where listing_id = 'offer.student_center.campus_map_poster';
    delete from private.world_shops where shop_id = 'shop.student_center_fashion';
    update private.world_shops set display_name = '학생회관 굿즈샵', status = 'ACTIVE', vendor_id = null
      where shop_id = 'shop.student_center';
    insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
      values ('${user}', 'authenticated', 'authenticated', 'migration-${user}@example.test', now(), false);
    insert into public.profiles(user_id, nickname, is_banned) values ('${user}', '이전검증', false);
    set local role service_role;
    set local request.jwt.claims = '{"role":"service_role"}';
    select public.world_wallet_credit_v1('${user}', 'currency.induck_coin', 1000, 'REWARD', 'test', 'migration', 'migration:${user}:seed');
    select public.world_exp_grant_v1('${user}', 100, 'test', 'migration', 'migration:${user}:exp');
    reset role;
    set local role authenticated;
    set local request.jwt.claims = '{"role":"authenticated","sub":"${user}","is_anonymous":false}';
    select public.purchase_world_shop_listing_v1('offer.student_center.induck_cap', 'migration:${user}:cap');
    select public.purchase_world_shop_listing_v1('offer.student_center.campus_map_poster', 'migration:${user}:poster');
    reset role;
    -- Non-default values ensure the migrations preserve gates, limits, windows and status.
    update private.world_shop_listings set purchase_limit = 2, start_at = now() - interval '1 day',
      end_at = now() + interval '7 days', status = 'HIDDEN'
      where listing_id = 'offer.student_center.induck_hoodie';
    update private.world_shops set status = 'DISABLED' where shop_id = 'shop.student_center';
    create temp table before_move on commit drop as
      select ${economySnapshot(user)} as economy, ${businessSnapshot} as business,
        (select jsonb_object_agg(listing_id, position) from private.world_shop_listings
          where listing_id <> 'offer.student_center.campus_map_poster') as positions,
        (select to_jsonb(s) from private.world_shops s where shop_id = 'shop.dorm_furniture') as dorm;

    -- Execute the actual checked-in migration SQL verbatim, not a reimplementation.
    ${moveFurniture}
    ${splitFashion}

    set local role authenticated;
    select public.purchase_world_shop_listing_v2('shop.student_center', 'offer.student_center.induck_cap', 'migration:${user}:cap');
    select public.purchase_world_shop_listing_v2('shop.student_center', 'offer.student_center.campus_map_poster', 'migration:${user}:poster');
    reset role;
    select jsonb_build_object(
      'economyUnchanged', b.economy = ${economySnapshot(user)},
      'businessUnchanged', b.business = ${businessSnapshot},
      'otherPositionsUnchanged', b.positions = (select jsonb_object_agg(listing_id, position) from private.world_shop_listings
        where listing_id <> 'offer.student_center.campus_map_poster'),
      'dormUnchanged', b.dorm = (select to_jsonb(s) from private.world_shops s where shop_id = 'shop.dorm_furniture'),
      'fashionStatus', (select status from private.world_shops where shop_id = 'shop.student_center_fashion'),
      'fashionCount', (select count(*) from private.world_shop_listings where shop_id = 'shop.student_center_fashion'),
      'posterShop', (select shop_id from private.world_shop_listings where listing_id = 'offer.student_center.campus_map_poster'),
      'posterPosition', (select position from private.world_shop_listings where listing_id = 'offer.student_center.campus_map_poster'),
      'remainingSouvenirs', (select jsonb_agg(listing_id order by listing_id) from private.world_shop_listings where shop_id = 'shop.student_center'),
      'receiptCount', (select count(*) from private.world_purchase_transactions where user_id = '${user}'),
      'originalReceiptShops', (select jsonb_agg(shop_id order by listing_id) from private.world_purchase_transactions where user_id = '${user}'),
      'balance', (select balance from private.world_wallets where user_id = '${user}' and currency_id = 'currency.induck_coin')
    ) from before_move b;
    rollback;
  `);
  const lines = out.split('\n').filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  assert.deepEqual(result, {
    economyUnchanged: true, businessUnchanged: true, otherPositionsUnchanged: true, dormUnchanged: true,
    fashionStatus: 'DISABLED', fashionCount: 4, posterShop: 'shop.dorm_furniture', posterPosition: 8, // after unchanged starter candidate positions 6 and 7
    remainingSouvenirs: ['offer.student_center.campus_mug'], receiptCount: 2,
    originalReceiptShops: ['shop.student_center', 'shop.student_center'], balance: 570,
  });
  // Check real result payloads too: both old-shop retries succeeded and replayed, despite
  // the new binding and disabled old/fashion shops. They are the two lines before summary.
  for (const line of lines.slice(-3, -1)) {
    const replay = JSON.parse(line);
    assert.equal(replay.status, 'SUCCESS');
    assert.equal(replay.replayed, true);
  }
  assert.equal(sql(`select count(*) from auth.users where id = '${user}'`), '0', 'fixture transaction rolled back');
});
