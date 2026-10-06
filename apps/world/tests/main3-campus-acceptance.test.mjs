import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertMain3HostedExecution, createMain3CampusAuthority, MAIN3_CAMPUS_ACCOUNTS,
  MAIN3_CAMPUS_SHOP, MAIN3_CAMPUS_WALLET, installMain3CampusIdentity, assertMain3ServedSource
} from './browser/main3-campus-fixture.mjs';
import { MAIN3_QUEST_ID } from '../npc-factory/main3-quest-contract.mjs';
import { parseShopSnapshot } from '../src/shop/shop-client.js';
import { parseWalletSnapshot } from '../src/wallet/wallet-client.js';
import { createHash } from 'node:crypto';

test('served campus bytes must match the tracked source manifest, including index mapping', () => {
  const body = Buffer.from('exact source'), hash = createHash('sha256').update(body).digest('hex');
  const sources = new Map([['apps/world/campus/index.html', hash], ['apps/world/src/main.js', hash]]);
  assert.equal(assertMain3ServedSource('/campus/', body, sources).path, 'apps/world/campus/index.html');
  assert.equal(assertMain3ServedSource('/src/main.js', body, sources).sha256, hash);
  assert.throws(() => assertMain3ServedSource('/src/main.js', Buffer.from('rewritten runtime'), sources));
  assert.throws(() => assertMain3ServedSource('/untracked.js', body, sources));
  assert.throws(() => assertMain3ServedSource('/%2e%2e/secret', body, sources));
});

test('campus guard rejects local, self-hosted, wrong event, renderer, or unpinned head', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'pull_request',
    MAIN3_HOSTED_QA: '1', MAIN3_EXPECTED_HEAD_SHA: 'a'.repeat(40), WORLD_SMOKE_DISABLE_WEBGPU: '1', WORLD_SMOKE_BROWSER: 'chrome' };
  assert.doesNotThrow(() => assertMain3HostedExecution(env));
  for (const key of Object.keys(env)) assert.throws(() => assertMain3HostedExecution({ ...env, [key]: '' }), key);
  assert.throws(() => assertMain3HostedExecution({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }));
});

test('campus fixtures use parsed real shop/wallet contracts and no fake owned or purchased item', () => {
  const shop = parseShopSnapshot(MAIN3_CAMPUS_SHOP, 'shop.student_center');
  assert.equal(shop?.offers.length, 1);
  assert.equal(shop.offers[0].itemId, 'head.induck_cap');
  assert.equal(shop.offers[0].listingId, 'offer.student_center.induck_cap');
  assert.equal(shop.offers[0].price, 180);
  assert.equal(parseWalletSnapshot(MAIN3_CAMPUS_WALLET).balances['currency.induck_coin'], 180);
});

test('campus authority seeds only ordered prerequisites and validates actual handler events/account scope', async () => {
  const authority = await createMain3CampusAuthority();
  const account = MAIN3_CAMPUS_ACCOUNTS.desktop[0], other = MAIN3_CAMPUS_ACCOUNTS.desktop[1];
  const send = (event, target = account, extra = {}) => authority.request({ method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}` },
    body: JSON.stringify({ quest_id: MAIN3_QUEST_ID, event, ...extra }) });
  assert.equal(authority.seedReceipts.length, 4);
  for (const seed of authority.seedReceipts) {
    assert.equal(seed.main1.stage, 5); assert.equal(seed.main2.stage, 9); assert.equal(seed.main3.stage, 0);
  }
  assert.equal((await send('status')).json.stage, 0);
  assert.equal((await send('visit_student_center')).json.stage, 0);
  assert.equal((await send('start')).json.stage, 1);
  assert.equal((await send('visit_student_center')).json.stage, 2);
  assert.equal((await send('visit_student_center')).json.stage, 2);
  assert.equal((await send('status', other)).json.stage, 0);
  assert.equal((await send('purchase')).status, 400);
  assert.equal((await send('status', account, { stage: 4 })).status, 400);
  assert.equal((await send('status', { token: 'not-a-fixture-token' })).status, 401);
  assert.ok(authority.calls.every(call => call.result.reward == null));
});

test('identity fixture is serializable, switches via auth listeners, and refuses all purchase RPCs', async () => {
  const previous = globalThis.window; globalThis.window = {};
  try {
    // Match Playwright addInitScript: no closure over Node imports is available in the browser.
    const install = (0, eval)(`(${installMain3CampusIdentity.toString()})`);
    install({ accounts: MAIN3_CAMPUS_ACCOUNTS.desktop, shop: MAIN3_CAMPUS_SHOP, wallet: MAIN3_CAMPUS_WALLET });
    const client = window.supabase.createClient(); const events = [];
    client.auth.onAuthStateChange((event, session) => events.push({ event, id: session?.user.id ?? null }));
    assert.equal((await client.auth.getSession()).data.session.user.id, MAIN3_CAMPUS_ACCOUNTS.desktop[0].id);
    assert.equal((await client.from('profiles').select('nickname').eq('user_id', MAIN3_CAMPUS_ACCOUNTS.desktop[0].id).single()).data.nickname, '검증 인덕이');
    window.__MAIN3_CAMPUS_FIXTURE__.switchAccount(1);
    assert.equal(events.at(-1).id, MAIN3_CAMPUS_ACCOUNTS.desktop[1].id);
    window.__MAIN3_CAMPUS_FIXTURE__.switchAccount(null);
    assert.equal(events.at(-1).event, 'SIGNED_OUT');
    assert.equal((await client.rpc('purchase_world_shop_listing_v1')).error.message, 'FIXTURE_MUTATION_FORBIDDEN');
    assert.equal(window.__MAIN3_CAMPUS_FIXTURE__.forbiddenRpcCalls.length, 1);
  } finally { globalThis.window = previous; }
});

test('browser acceptance uses real campus, UI input, offline routes and fail-closed receipts', async () => {
  const source = await readFile(new URL('./browser/main3-campus-smoke.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertMain3HostedExecution(process.env)') < source.indexOf("await import('./harness.mjs')"));
  for (const required of ['MAIN2_GUIDE_NPC', 'STUDENT_CENTER_SHOP_ENTRY', '/campus/?lobby=1',
    '/api/world-quest', '#context-action', '#main2-guide-dialogue', '#quest-hud', '#shop-panel',
    'readPixels', 'HEAD^{tree}', 'PENDING_INDEPENDENT_PIXEL_REVIEW']) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /\.setAiSignedIn\(|\.visitStudentCenter\(|\.startFromGuide\(/,
    'acceptance must use actual auth and UI owners, never call quest action methods');
});

test('visible Main3 objective rejects overlapping world labels, secondary cards and ellipsis', async () => {
  const { assertMain3HudReadable } = await import('./browser/main3-campus-fixture.mjs');
  assert.equal(typeof assertMain3HudReadable, 'function', 'pixel-derived containment guard exists');
  const layout = { bounds: { x: 174, y: 186, right: 378, bottom: 250, width: 204, height: 64 },
    objectiveBounds: { x: 198, y: 194, right: 308, bottom: 242, width: 110, height: 48 },
    objectiveClient: { width: 110, height: 48, scrollWidth: 110, scrollHeight: 48 },
    viewport: { width: 390, height: 844 }, blockers: [] };
  assert.doesNotThrow(() => assertMain3HudReadable(layout));
  assert.throws(() => assertMain3HudReadable({ ...layout, objectiveBounds: { ...layout.objectiveBounds, y: 240, bottom: 288 } }), /within.*HUD/);
  assert.throws(() => assertMain3HudReadable({ ...layout, objectiveBounds: { ...layout.objectiveBounds, x: 170, right: 280 } }), /within.*HUD/);
  for (const id of ['shop-world-label', 'inkyung-living-moment']) {
    assert.throws(() => assertMain3HudReadable({ ...layout, blockers: [{ id, x: 114, y: 200, right: 276, bottom: 254 }] }), /overlap/);
  }
  assert.throws(() => assertMain3HudReadable({ ...layout,
    objectiveClient: { width: 110, height: 48, scrollWidth: 280, scrollHeight: 48 } }), /clipped/);
});
