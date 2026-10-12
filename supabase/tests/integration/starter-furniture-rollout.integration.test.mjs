// Execute the exact narrow stock-open SQL inside a rolled-back disposable local transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const {DB_URL}=process.env;
assert.match(DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
const operation=readFileSync(new URL('../../../docs/ops/sql/20261012_starter_furniture_open.sql',import.meta.url),'utf8');
const sql=query=>execFileSync('psql',[DB_URL,'-v','ON_ERROR_STOP=1','-Atq','-c',query],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const ids="'offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa'";
test('exact Production stock-open operation adds only two ACTIVE offers and leaves all player value unchanged',()=>{
 const result=sql(`begin;
  delete from private.world_shop_listings where listing_id in (${ids});
  create temp table before_starter_open as select
    (select count(*) from private.world_player_items) as items,
    (select count(*) from private.world_item_grants) as grants,
    (select count(*) from private.world_currency_transactions) as debits,
    (select count(*) from private.world_purchase_transactions) as purchases,
    (select coalesce(sum(balance),0) from private.world_wallets) as balance;
  ${operation}
  select jsonb_build_object('listings',(select jsonb_agg(jsonb_build_array(item_id,price,required_level,status) order by item_id)
    from private.world_shop_listings where listing_id in (${ids})),
    'playerValueUnchanged',b.items=(select count(*) from private.world_player_items)
      and b.grants=(select count(*) from private.world_item_grants)
      and b.debits=(select count(*) from private.world_currency_transactions)
      and b.purchases=(select count(*) from private.world_purchase_transactions)
      and b.balance=(select coalesce(sum(balance),0) from private.world_wallets)) from before_starter_open b;
  rollback;`);
 assert.deepEqual(JSON.parse(result.split('\n').at(-1)),{listings:[['furniture.dorm_single_sofa',480,1,'ACTIVE'],['furniture.study_books_set',120,1,'ACTIVE']],playerValueUnchanged:true});
 assert.equal(sql(`select count(*) from private.world_shop_listings where listing_id in (${ids}) and status='LOCKED'`),'2');
 assert.throws(()=>sql(`begin;${operation}rollback;`),/STARTER_LISTING_ALREADY_EXISTS_INSPECT_FIRST/);
});
