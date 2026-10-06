import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createInventoryClient } from '../src/inventory/inventory-client.js';
import { createInventoryPanel } from '../src/inventory/inventory-panel.js';
const projection = await import('../server/collection-book-service.mjs').catch(() => ({}));
const browser = await import('../src/collection/collection-book-client.js').catch(() => ({}));
const view = await import('../src/collection/collection-book-view.js').catch(() => ({}));
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const date = '2026-09-28T01:00:00+00:00';
const row = (extra = {}) => ({ entryId: 'collection.fish.carp', category: 'FISH', persistenceMode: 'SERVER_PERSISTED',
  ownerDomain: null, ownerRef: null, catalogStatus: 'ACTIVE', definitionVersion: 1, discoveryState: 'UNKNOWN',
  discovered: false, firstDiscoveredAt: null, lastDiscoveredAt: null, discoveryCount: 0, version: 0, ...extra });
const discovered = () => row({ discovered: true, discoveryState: 'DISCOVERED', firstDiscoveredAt: date, lastDiscoveredAt: date, discoveryCount: 1, version: 1 });
const raw = (...entries) => ({ userId: A, entries });
const project = (input = raw(row())) => { assert.equal(typeof projection.projectCollectionBook, 'function'); return projection.projectCollectionBook(input, A); };
const empty = () => ({ version: 1, entries: [], discoveredCount: 0, trackableCount: 0 });
const response = payload => ({ ok: true, status: 200, json: async () => payload });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const text = node => walk(node).map(n => n.textContent).join(' ');
const button = (root, label) => walk(root).find(n => n.tagName === 'BUTTON' && n.textContent === label);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('server projection redacts an undiscovered silhouette before crossing the wire', () => {
  const book = project(raw(row({ sourceRef: 'secret-ref', metadata: { private: true } })));
  assert.equal(book.entries.length, 1); assert.equal(book.entries[0].state, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(book), /carp|붕어|sourceRef|secret-ref|metadata|userId|discoveryRuleRef/);
  assert.equal(book.discoveredCount, 0); assert.equal(book.trackableCount, 1);
});
test('only validated server discovery supplies date and progress, source remains unavailable', () => {
  const book = project(raw(discovered()));
  assert.equal(book.entries[0].title, '붕어'); assert.equal(book.entries[0].firstDiscoveredAt, date);
  assert.equal(book.entries[0].sourceLabel, null); assert.equal(book.discoveredCount, 1); assert.equal(book.entries[0].discoveryCount, 1);
});
test('projection rejects foreign account and malformed/duplicate authority rows', () => {
  assert.throws(() => project({ ...raw(row()), userId: B }));
  for (const entries of [[row(), row()], [discovered(), discovered()], [row({ discovered: true })],
    [row({ discoveryState: 'DISCOVERED', discovered: true, firstDiscoveredAt: 'bad', discoveryCount: 1 })]]) assert.throws(() => project(raw(...entries)));
});
test('future, hidden, disabled, unknown and mismatching definitions fail closed', () => {
  for (const extra of [{ entryId: 'collection.artifact.campus_fragment_01' }, { entryId: 'collection.plant.campus_leaf' },
    { entryId: 'collection.secret.future' }, { catalogStatus: 'HIDDEN' }, { catalogStatus: 'COMING_SOON' },
    { catalogStatus: 'DISABLED' }, { definitionVersion: 2 }, { category: 'ARTIFACT' }, { persistenceMode: 'SESSION_ONLY' }]) assert.equal(project(raw(row(extra))).entries.length, 0);
});
test('OWNER_DERIVED has no discovered boolean/date and cannot inflate discovery count', () => {
  const book = project(raw(row({ entryId: 'collection.place.biryong_tower', category: 'PLACE', persistenceMode: 'DERIVED_FROM_OWNER',
    ownerDomain: 'BIRYONG', ownerRef: 'BR01', discoveryState: 'OWNER_DERIVED', discovered: null, discoveryCount: null, version: null })));
  assert.equal(book.entries[0].state, 'OWNER_DERIVED'); assert.equal(book.entries[0].firstDiscoveredAt, null);
  assert.equal(book.trackableCount, 0); assert.equal(book.discoveredCount, 0); assert.doesNotMatch(JSON.stringify(book), /BR01|ownerRef|ownerDomain/);
});
test('service has fixed read RPC and verified actor', async () => {
  assert.equal(typeof projection.createCollectionBookService, 'function'); const calls = [];
  const service = projection.createCollectionBookService({ verifyUser: async auth => { assert.equal(auth, 'Bearer owner'); return A; },
    rpc: async (name, args) => { calls.push({ name, args }); return raw(discovered()); } });
  assert.equal((await service('Bearer owner')).discoveredCount, 1); assert.deepEqual(calls, [{ name: 'world_collection_list_v1', args: { p_user: A } }]);
});
test('service rejects missing/invalid users and conceals raw upstream errors', async () => {
  assert.equal(typeof projection.createCollectionBookService,'function');
  for (const actor of [null, 'forged', {}]) {
    const service = projection.createCollectionBookService({ verifyUser: () => actor, rpc: () => assert.fail() }); await assert.rejects(service(''), e => e.status === 401);
  }
  const service = projection.createCollectionBookService({ verifyUser: () => A, rpc: () => { throw Error('private-secret'); } });
  await assert.rejects(service(''), e => e.message === 'COLLECTION_BOOK_UNAVAILABLE');
});
test('HTTP is same-origin GET only, has no identity query/body, private no-store', async () => {
  assert.equal(typeof projection.createCollectionBookApiHandler,'function');
  const res = () => ({ headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n; return this; }, end() { return this; }, json(data) { this.data=data; return this; } });
  for (const [overrides, expected] of [[{ method: 'POST' },405], [{ url: '/api/world-collection-book?userId=x' },400], [{ body: { userId: B } },400], [{ headers: { host:'world.test', origin:'https://other.test' } },403]]) {
    const r = res(); await projection.createCollectionBookApiHandler({ service: () => assert.fail() })({ method:'GET', url:'/api/world-collection-book', headers:{host:'world.test'}, ...overrides },r);
    assert.equal(r.code, expected); assert.match(r.headers['Cache-Control'], /no-store/);
  }
  const r = res(); await projection.createCollectionBookApiHandler({service: async () => empty()})({method:'GET',url:'/api/world-collection-book',headers:{host:'world.test',origin:'https://world.test'}}, r);
  assert.equal(r.code,200); assert.deepEqual(r.data, empty());
});
test('RPC transport allowlists only read and strips sensitive errors', async () => {
  assert.equal(typeof projection.createCollectionBookRpc,'function');let calls=0;
  const rpc=projection.createCollectionBookRpc({url:'https://db.example',serviceKey:'fixture-secret',fetcher:async(url,opts)=>{
    calls++;assert.equal(url,'https://db.example/rest/v1/rpc/world_collection_list_v1');assert.equal(opts.headers.Authorization,'Bearer fixture-secret');assert.deepEqual(JSON.parse(opts.body),{p_user:A});
    return {ok:false,json:async()=>({message:'private-secret'})};
  }});
  await assert.rejects(rpc('world_collection_discover_v1',{p_user:A}),e=>e.message==='COLLECTION_BOOK_UNAVAILABLE');assert.equal(calls,0);
  await assert.rejects(rpc('world_collection_list_v1',{p_user:A}),e=>e.message==='COLLECTION_BOOK_UNAVAILABLE');assert.equal(calls,1);
});
test('browser accepts only projected shape and rejects inconsistent totals', () => {
  assert.equal(typeof browser.parseCollectionBook,'function'); assert.deepEqual(browser.parseCollectionBook(empty()),empty());
  assert.equal(browser.parseCollectionBook(raw(row())),null); assert.equal(browser.parseCollectionBook({...empty(),discoveredCount:1}),null);
  assert.equal(browser.parseCollectionBook({...empty(),entries:[{state:'DISCOVERED'}]}),null); assert.ok(browser.parseCollectionBook(project(raw(discovered()))));
});
test('client account binding is lazy; read sends GET without actor data', async () => {
  assert.equal(typeof browser.createCollectionBookClient,'function');let calls=0;
  const book=browser.createCollectionBookClient({getToken:async account=>{assert.equal(account,A);return 'token';},fetcher:async(url,opts)=>{
    calls++;assert.equal(url,'/api/world-collection-book');assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);assert.equal(opts.headers.Authorization,'Bearer token');return response(empty());
  }});
  book.setAccount(A);assert.equal(calls,0);assert.equal(book.state,'IDLE'); assert.equal(await book.refresh(),true);assert.equal(book.state,'READY');assert.equal(calls,1);
});
test('pending token from old account is never sent after switch', async () => {
  assert.equal(typeof browser.createCollectionBookClient,'function');const token=deferred();let calls=0;
  const book=browser.createCollectionBookClient({getToken:()=>token.promise,fetcher:()=>{calls++;return response(empty());}});
  book.setAccount(A);const pending=book.refresh();book.setAccount(B);token.resolve('old-token');await pending;assert.equal(calls,0);assert.equal(book.state,'IDLE');assert.equal(book.snapshot,null);
});
test('client drops old-account responses and does not disturb new request', async () => {
  assert.equal(typeof browser.createCollectionBookClient,'function');const reads=[deferred(),deferred()];let calls=0;
  const book=browser.createCollectionBookClient({getToken:async()=> 'token',fetcher:()=>reads[calls++].promise});
  book.setAccount(A);const old=book.refresh();await flush();book.setAccount(B);const next=book.refresh();await flush();
  reads[0].resolve(response(project(raw(discovered()))));await old;assert.equal(book.state,'LOADING');assert.equal(book.snapshot,null);
  reads[1].resolve(response(empty()));await next;assert.equal(book.state,'READY');assert.equal(book.snapshot.entries.length,0);
});
test('retry coalesces, shows loading, and failure clears old snapshot', async () => {
  assert.equal(typeof browser.createCollectionBookClient,'function');const gate=deferred();let calls=0;
  const book=browser.createCollectionBookClient({getToken:async()=> 'token',fetcher:()=>{calls++;return calls===1?response(empty()):gate.promise;}});
  book.setAccount(A);await book.refresh();const retry=book.refresh();assert.equal(book.state,'LOADING');assert.equal(book.snapshot,null);assert.equal(book.refresh(),retry);await flush();assert.equal(calls,2);
  gate.resolve({ok:false});assert.equal(await retry,false);assert.equal(book.state,'UNAVAILABLE');book.setAccount(null);assert.equal(book.state,'SIGNED_OUT');assert.equal(book.snapshot,null);
});
test('owned mementos are current holdings with real metadata, not discoveries', () => {
  assert.equal(typeof view.currentMementoViews,'function');
  const items=[{itemId:'badge.main_gate',quantity:1,acquiredAt:date,sourceType:'QUEST',sourceRef:'private',catalogStatus:'ACTIVE'},
    {itemId:'memorabilia.mcm_2026_wristband',quantity:1,acquiredAt:date,sourceType:'EVENT',catalogStatus:'ACTIVE'},
    {itemId:'badge.unknown',quantity:1,acquiredAt:date,sourceType:'ADMIN',catalogStatus:'ACTIVE'},
    {itemId:'badge.mcm_2026_landlord',quantity:1,acquiredAt:date,sourceType:'EVENT',catalogStatus:'HIDDEN'}];
  const views=view.currentMementoViews({items});assert.equal(views.length,2);assert.equal(views[0].acquiredAt,date);assert.equal(views[0].sourceLabel,'퀘스트');assert.equal(views[0].state,'OWNED_NOW');
  assert.doesNotMatch(JSON.stringify(views),/private|discovered|firstDiscoveredAt|sourceRef/);
});
test('inventory opens Book, recovers retry focus, resets account view and closes normally', async () => {
  assert.equal(typeof browser.createCollectionBookClient,'function');const doc=createFakeDocument(),panel=doc.createElement('section');let failing=true;
  const inventory=createInventoryClient({getClient:()=>({rpc:async()=>({data:{items:[]}})})});await inventory.setAccount(A);
  const book=browser.createCollectionBookClient({getToken:async()=> 'token',fetcher:async()=>failing?{ok:false}:response(project(raw(discovered())))});book.setAccount(A);
  const ui=createInventoryPanel({panel,inventory,collectionBook:book,doc});ui.setOpen(true);assert.ok(button(panel,'수집도감'));button(panel,'수집도감').click();await flush();
  assert.match(text(panel),/수집 기록을 불러오지 못했어요/);const retry=button(panel,'기록 다시 불러오기');retry.focus();failing=false;retry.click();await flush();
  assert.match(text(panel),/붕어/);assert.match(text(panel),/발견 기록 1 \/ 1/);assert.match(text(panel),/출처 기록 미제공/);assert.ok(panel.contains(doc.activeElement));
  book.setAccount(B);await inventory.setAccount(B);assert.doesNotMatch(text(panel),/붕어/);assert.equal(ui.status().activeView,'inventory');ui.setOpen(false);assert.equal(panel.hidden,true);
});
test('main wires Collection Book to the same account and existing inventory modal', async () => {
  const {readFile}=await import('node:fs/promises');const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/collectionBook\.setAccount\(identity\?\.userId \?\? null\)/);
  assert.match(main,/createInventoryPanel\(\{[\s\S]*?collectionBook,/);
  assert.match(main,/getToken: async \(accountId\)/);
  assert.match(main,/session\?\.user\?\.id === accountId/);
});
test('deployment entry verifies permanent account and never returns raw service-role rows', async () => {
  const {createRequire}=await import('node:module');
  const oldFetch=globalThis.fetch, keys=['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let permanent=false, reads=0;
  const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},end(){return this;},json(data){this.data=data;return this;}});
  try{
    process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-secret';process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_PUBLISHABLE_KEY='fixture-public';
    globalThis.fetch=async(url,options)=>{
      if(url.endsWith('/auth/v1/user'))return response({id:A,is_anonymous:!permanent});
      reads++;assert.ok(url.endsWith('/rest/v1/rpc/world_collection_list_v1'));assert.deepEqual(JSON.parse(options.body),{p_user:A});
      return response(raw(row({metadata:'private',sourceRef:'sensitive'})));
    };
    const handler=createRequire(import.meta.url)('../api/world-collection-book.js');
    const req={method:'GET',url:'/api/world-collection-book',headers:{host:'world.test',authorization:'Bearer '+'v'.repeat(30)}};
    const guest=res();await handler(req,guest);assert.equal(guest.code,401);assert.equal(reads,0);
    permanent=true;const owner=res();await handler(req,owner);assert.equal(owner.code,200);assert.equal(reads,1);
    assert.doesNotMatch(JSON.stringify(owner.data),/carp|붕어|userId|private|sensitive|fixture-secret/);
  }finally{globalThis.fetch=oldFetch;for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
test('close before read completion keeps modal closed and focus with opener', async () => {
  const doc=createFakeDocument(),panel=doc.createElement('section'),opener=doc.createElement('button');opener.focus();
  const gate=deferred();const book=browser.createCollectionBookClient({getToken:async()=> 'token',fetcher:()=>gate.promise});book.setAccount(A);
  const inventory=createInventoryClient({getClient:()=>({rpc:async()=>({data:{items:[]}})})});await inventory.setAccount(A);
  const ui=createInventoryPanel({panel,inventory,collectionBook:book,doc});ui.setOpen(true);button(panel,'수집도감').click();await flush();
  doc.dispatch('keydown',{code:'Escape'});assert.equal(ui.open,false);assert.equal(doc.activeElement,opener);
  gate.resolve(response(project(raw(discovered()))));await flush();assert.equal(ui.open,false);assert.equal(panel.children.length,0);assert.equal(doc.activeElement,opener);
});
test('memento rows never linger under a different book account', async()=>{
  const doc=createFakeDocument();const rendered=view.renderCollectionBook({doc,book:{state:'IDLE',accountId:B},
    inventory:{state:'READY',accountId:A,snapshot:{items:[{itemId:'badge.main_gate',quantity:1,acquiredAt:date,sourceType:'QUEST',catalogStatus:'ACTIVE'}]}},retry:()=>{}});
  assert.doesNotMatch(text(rendered.element),/정문 첫걸음 배지/);
});
test('signed-out Book never pretends a holdings request is loading',()=>{
  const doc=createFakeDocument();const rendered=view.renderCollectionBook({doc,book:{state:'SIGNED_OUT',accountId:null},inventory:{state:'SIGNED_OUT',accountId:null,snapshot:null},retry:()=>{}});
  assert.doesNotMatch(text(rendered.element),/보유 정보를 확인하는 중/);assert.match(text(rendered.element),/로그인/);
});
test('current memento projection withholds unknown ownership catalog statuses',()=>{
  assert.deepEqual(view.currentMementoViews({items:[{itemId:'badge.main_gate',quantity:1,acquiredAt:date,sourceType:'QUEST',catalogStatus:'UNRECOGNIZED'}]}),[]);
});
