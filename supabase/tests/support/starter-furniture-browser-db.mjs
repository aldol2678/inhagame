// Disposable local Supabase only. Real PostgREST RPCs and real SQL readback; no production URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const ITEMS = ['furniture.study_books_set','furniture.dorm_single_sofa'];
const LISTINGS = ITEMS.map(id => `offer.dorm_furniture.${id.split('.')[1]}`);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const quotedListings = LISTINGS.map(literal).join(',');
export function assertStarterLocalEnvironment(env) {
  assert.equal(env.STARTER_FURNITURE_LOCAL_QA, '1', 'explicit disposable QA marker required');
  assert.match(env.API_URL ?? '', /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  assert.match(env.DB_URL ?? '', /^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
  for (const key of ['ANON_KEY','JWT_SECRET']) assert.ok(env[key], `local Supabase ${key} required`);
}
export async function createStarterFurnitureBrowserDatabase({ env = process.env } = {}) {
  assertStarterLocalEnvironment(env);
  const sql = query => execFileSync('psql', [env.DB_URL,'-v','ON_ERROR_STOP=1','-Atq','-c',query],
    {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const json = query => JSON.parse(sql(query).split('\n').at(-1));
  const rows = () => json(`select jsonb_agg(to_jsonb(l) order by listing_id) from private.world_shop_listings l where listing_id in (${quotedListings})`);
  const original = rows();
  assert.equal(original.length,2);
  for (const row of original) {
    assert.equal(row.shop_id,'shop.dorm_furniture'); assert.equal(row.status,'LOCKED');
    assert.equal(row.currency_id,'currency.induck_coin'); assert.equal(row.quantity,1); assert.equal(row.required_level,1);
    assert.equal(row.price,row.item_id===ITEMS[0]?120:480);
  }
  const allowed = new Set(['get_world_shop_capabilities_v1','get_world_shop_v1','purchase_world_shop_listing_v1','purchase_world_shop_listing_v2',
    'get_my_world_inventory_v1','get_my_world_wallet_v1','get_or_create_my_personal_room_v1','check_world_room_access_v1',
    'get_world_room_furniture_v1','save_my_room_furniture_v1']);
  function makeRpc(token, calls) {
    return async (name,args={}) => {
      assert.ok(allowed.has(name), `QA RPC allowlist: ${name}`);
      const response = await fetch(`${env.API_URL}/rest/v1/rpc/${name}`, {method:'POST',headers:{apikey:env.ANON_KEY,
        ...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:JSON.stringify(args)});
      const data = await response.json();
      calls.push({name,args:structuredClone(args),status:response.status,result:response.ok?data:{message:data.message,code:data.code}});
      return response.ok ? {data,error:null} : {data:null,error:data};
    };
  }
  async function createAccount({balance=0,anonymous=false}={}) {
    assert.ok([0,600].includes(balance),'only bounded disposable test balances are allowed');
    const userId = randomUUID(), calls=[];
    sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
      values(${literal(userId)},'authenticated','authenticated',${anonymous?'null':literal(`starter-${userId}@example.test`)},${anonymous?'null':'now()'},${anonymous});
      insert into public.profiles(user_id,nickname,is_banned) values(${literal(userId)},'가구체험',false);`);
    if(balance) sql(`set role service_role; set request.jwt.claims='{"role":"service_role"}';
      select public.world_wallet_credit_v1(${literal(userId)},'currency.induck_coin',${balance},'REWARD','test','starter-browser',${literal(`starter-browser:${userId}:seed`)});`);
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now()/1000), header=b64({alg:'HS256',typ:'JWT'}),
      payload=b64({sub:userId,aud:'authenticated',role:'authenticated',is_anonymous:anonymous,session_id:randomUUID(),iat:now,exp:now+3600});
    const token = `${header}.${payload}.${createHmac('sha256',env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
    const rpc=makeRpc(token,calls);
    let roomId=null;
    if(!anonymous){
      const room=await rpc('get_or_create_my_personal_room_v1'); assert.equal(room.error,null); roomId=room.data.roomId;
      assert.match(roomId,/^[0-9a-f-]{36}$/);
    }
    async function readback() {
      return json(`select jsonb_build_object(
        'balance',coalesce((select balance from private.world_wallets where user_id=${literal(userId)} and currency_id='currency.induck_coin'),0),
        'items',(select coalesce(jsonb_agg(jsonb_build_object('itemId',item_id,'quantity',quantity) order by item_id),'[]'::jsonb) from private.world_player_items where user_id=${literal(userId)}),
        'purchases',(select coalesce(jsonb_agg(to_jsonb(p) order by created_at),'[]'::jsonb) from private.world_purchase_transactions p where user_id=${literal(userId)}),
        'debits',(select coalesce(jsonb_agg(to_jsonb(d) order by created_at),'[]'::jsonb) from private.world_currency_transactions d where user_id=${literal(userId)} and type='PURCHASE'),
        'grants',(select count(*) from private.world_item_grants where user_id=${literal(userId)}),
        'layout',(select to_jsonb(l) from private.world_room_layouts l where room_id=${roomId?literal(roomId):'null'}),
        'listings',(select jsonb_agg(jsonb_build_object('listingId',listing_id,'status',status,'price',price,'requiredLevel',required_level) order by listing_id) from private.world_shop_listings where listing_id in (${quotedListings}))
      )`);
    }
    return {userId,roomId,rpc,readback,calls};
  }
  const primary=await createAccount({balance:600});
  const guestCalls=[], guestRpc=makeRpc(null,guestCalls);
  return {...primary,createAccount,guestRpc,guestCalls,
    activate() {
      assert.deepEqual(rows(),original,'stock must remain exactly the locked migrated candidate before test activation');
      sql(`update private.world_shop_listings set status='ACTIVE' where listing_id in (${quotedListings}) and status='LOCKED'`);
      assert.ok(rows().every(r=>r.status==='ACTIVE'));
    },
    async close() {
      sql(`update private.world_shop_listings set status='LOCKED' where listing_id in (${quotedListings})`);
      assert.deepEqual(rows(),original,'test restores exact original locked stock');
      // User/receipt fixtures stay in the disposable stack until the workflow destroys it.
      // No append-only ledger is deleted or rewritten, even in acceptance.
    }
  };
}
