// Test-only inputs. No production module is rewritten and no real account/token is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalQuestStore } from '../../npc-factory/quest-store.mjs';
import { createQuestCloudHandler } from '../../npc-factory/quest-cloud-handler.mjs';
import { QUEST_ID } from '../../npc-factory/quest-contract.mjs';
import { MAIN2_QUEST_ID, MAIN2_QUEST_EVENTS } from '../../npc-factory/main2-quest-contract.mjs';
import { MAIN3_QUEST_ID } from '../../npc-factory/main3-quest-contract.mjs';

export function assertMain3HostedExecution(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Main3 campus QA requires GitHub Actions');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Main3 campus QA is hosted-only; local browser execution is not authorized');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request', 'Main3 campus QA requires a pull_request event');
  assert.equal(env.MAIN3_HOSTED_QA, '1', 'Main3 campus QA requires explicit hosted opt-in');
  assert.match(env.MAIN3_EXPECTED_HEAD_SHA ?? '', /^[a-f0-9]{40}$/, 'Exact PR head SHA is required');
  assert.equal(env.WORLD_SMOKE_DISABLE_WEBGPU, '1', 'Offline WebGL2 path is required');
  assert.equal(env.WORLD_SMOKE_BROWSER, 'chrome', 'Installed hosted Chrome is required');
}

export function assertMain3ServedSource(pathname, bytes, sources) {
  let file = decodeURIComponent(pathname);
  assert.ok(file.startsWith('/') && !file.split('/').includes('..') && !file.includes('\\'), 'Static source path must stay within apps/world');
  if (file === '/campus' || file === '/campus/') file = '/campus/index.html';
  else if (file === '/') file = '/index.html';
  const sourcePath = 'apps/world' + file;
  assert.ok(sources.has(sourcePath), `Served response must be tracked exact-head source: ${sourcePath}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, sources.get(sourcePath), `Served bytes changed: ${sourcePath}`);
  return { path: sourcePath, sha256: hash };
}

export function assertMain3HudReadable(layout) {
  const { bounds, objectiveBounds, objectiveClient, viewport, blockers = [] } = layout;
  for (const box of [bounds, objectiveBounds]) {
    assert.ok(box && ['x','y','right','bottom','width','height'].every(key => Number.isFinite(box[key])) &&
      box.width > 0 && box.height > 0, 'Main3 objective has measurable bounds');
    assert.ok(box.x >= -1 && box.y >= -1 && box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1,
      'Main3 objective fits viewport');
  }
  assert.ok(objectiveBounds.x >= bounds.x - 1 && objectiveBounds.y >= bounds.y - 1 &&
    objectiveBounds.right <= bounds.right + 1 && objectiveBounds.bottom <= bounds.bottom + 1,
    'Main3 objective must remain within its HUD clipping boundary');
  assert.ok(objectiveClient.width > 0 && objectiveClient.height > 0 &&
    objectiveClient.scrollWidth <= objectiveClient.width + 1 && objectiveClient.scrollHeight <= objectiveClient.height + 1,
    'Main3 objective text must not be clipped or ellipsized');
  for (const other of blockers) {
    const overlap = bounds.x < other.right - 1 && bounds.right > other.x + 1 &&
      bounds.y < other.bottom - 1 && bounds.bottom > other.y + 1;
    assert.ok(!overlap, `Main3 HUD overlap: ${other.id}`);
  }
  return true;
}

export const MAIN3_CAMPUS_ACCOUNTS = Object.freeze(Object.fromEntries(['desktop', 'mobile'].map((mode, index) =>
  [mode, Object.freeze([0, 1].map(n => Object.freeze({
    id: `00000000-0000-4000-8000-000000000${index + 1}0${n + 1}`,
    token: `main3-offline-${mode}-${n + 1}`
  })))])));

export const MAIN3_CAMPUS_SHOP = Object.freeze({ shopId: 'shop.student_center', displayName: '학생회관 상점',
  status: 'ACTIVE', playerLevel: 2, offers: [{ listingId: 'offer.student_center.induck_cap', itemId: 'head.induck_cap',
    currencyId: 'currency.induck_coin', price: 180, quantity: 1, requiredLevel: 1, purchaseLimit: 1,
    startAt: null, endAt: null, status: 'ACTIVE', purchasable: true, unavailableReason: null }] });
export const MAIN3_CAMPUS_WALLET = Object.freeze({ currencies: [{ id: 'currency.induck_coin', balance: 180 }] });

export async function createMain3CampusAuthority() {
  const store = createLocalQuestStore(), calls = [], seedReceipts = [];
  const accounts = Object.values(MAIN3_CAMPUS_ACCOUNTS).flat();
  const tokens = new Map(accounts.map(account => [`Bearer ${account.token}`, account.id]));
  // These are legal ordered events through the real local store, never a direct stage assignment.
  for (const account of accounts) {
    for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) await store(account.id, event, QUEST_ID);
    for (const event of MAIN2_QUEST_EVENTS.filter(event => event !== 'status')) await store(account.id, event, MAIN2_QUEST_ID);
    seedReceipts.push({ accountId: account.id, main1: await store(account.id, 'status', QUEST_ID),
      main2: await store(account.id, 'status', MAIN2_QUEST_ID), main3: await store(account.id, 'status', MAIN3_QUEST_ID) });
  }
  const handler = createQuestCloudHandler({ verifyUser: async authorization => tokens.get(authorization) ?? null,
    store: async (accountId, event, questId) => {
      const result = await store(accountId, event, questId);
      calls.push({ accountId, event, questId, result: structuredClone(result) });
      return result;
    } });
  return {
    calls, seedReceipts,
    async request({ method, headers = {}, body = '' }) {
      let status = 200, result = ''; const responseHeaders = {};
      const req = { method, headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
        async *[Symbol.asyncIterator]() { yield body; } };
      const res = { setHeader: (key, value) => { responseHeaders[key] = value; },
        writeHead: code => { status = code; }, end: value => { result = value ?? ''; } };
      await handler(req, res);
      return { status, headers: responseHeaders, body: result, json: result ? JSON.parse(result) : null };
    }
  };
}

// Serialized by Playwright before boot. All clients share only this tab's synthetic identity.
// No fetch, SDK, credentials, persisted auth, socket, real RPC, or browser auth action is used.
export function installMain3CampusIdentity({ accounts, shop, wallet }) {
  let index = 0;
  const listeners = new Set(), rpcCalls = [], forbiddenRpcCalls = [], unavailableRpcCalls = [], queries = [];
  const user = () => index == null ? null : { id: accounts[index].id, is_anonymous: false,
    email: `fixture-${index + 1}@example.invalid`, user_metadata: {} };
  const session = () => index == null ? null : { access_token: accounts[index].token, token_type: 'bearer', user: user() };
  const result = data => ({ data, error: null });
  const rpc = (name, args) => {
    const call = { name, args: args ?? null, accountId: user()?.id ?? null }; rpcCalls.push(call);
    let response;
    if (/^(purchase|grant|claim|equip|unequip|advance|set_|save_|update_|delete_)/.test(name)) {
      forbiddenRpcCalls.push(call); response = { data: null, error: { message: 'FIXTURE_MUTATION_FORBIDDEN' } };
    } else if (name === 'get_world_shop_v1') response = result(structuredClone(shop));
    else if (name === 'get_my_world_wallet_v1') response = result(structuredClone(wallet));
    else if (name === 'get_my_profile') response = result({ profile: { userId: user()?.id ?? null,
      nickname: '검증 인덕이', title: null, avatar: 'classic', departmentId: null, inhaVerified: false }, games: [] });
    else if (name === 'get_my_world_progression_v1') response = result({ totalExp: 200, level: 2,
      currentLevelStartExp: 100, nextLevelExp: 300, progressExp: 100, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false });
    else if (name === 'get_world_staff_badges_v1') response = result([]);
    else if (name === 'touch_inhagame_member_activity_v1' || name === 'touch_world_online_session_v2') response = result(null);
    else {
      unavailableRpcCalls.push(call);
      response = { data: null, error: { message: 'MAIN3_OFFLINE_FIXTURE_UNAVAILABLE' } };
    }
    const promise = Promise.resolve(response); promise.abortSignal = () => promise; return promise;
  };
  const client = {
    auth: {
      getSession: async () => result({ session: session() }), getUser: async () => result({ user: user() }),
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
      signInAnonymously: async () => ({ data: { user: null, session: null }, error: { message: 'MAIN3_OFFLINE_GUEST_DISABLED' } })
    },
    rpc,
    from(table) {
      queries.push({ table });
      const row = table === 'profiles' ? { nickname: '검증 인덕이', user_id: user()?.id ?? null } : null;
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        single: async () => result(row), maybeSingle: async () => result(row),
        then: (resolve, reject) => Promise.resolve(result(row ? [row] : [])).then(resolve, reject) };
      return query;
    },
    realtime: { setAuth: async () => {} },
    channel() {
      // Empty local channels preserve the real transport API without pretending remote peers exist.
      const channel = { on: () => channel, subscribe: () => channel, presenceState: () => ({}),
        track: async () => 'ok', untrack: async () => 'ok', send: async () => 'ok', unsubscribe: async () => 'ok' };
      return channel;
    },
    removeChannel: async () => 'ok', removeAllChannels: async () => []
  };
  window.supabase = { createClient: () => client };
  window.__MAIN3_CAMPUS_FIXTURE__ = {
    rpcCalls, forbiddenRpcCalls, unavailableRpcCalls, queries,
    switchAccount(nextIndex) {
      if (nextIndex !== null && !accounts[nextIndex]) throw Error('Unknown fixture account');
      index = nextIndex;
      for (const callback of listeners) callback(index == null ? 'SIGNED_OUT' : 'SIGNED_IN', session());
    }
  };
}
