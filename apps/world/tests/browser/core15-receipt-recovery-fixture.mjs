// Isolated component integration. This is deliberately not a 3D boot or live-auth test.
// Actual handler/store execute against this process's synthetic, in-memory RPC ledger.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { createSupabaseQuestStore } from '../../npc-factory/quest-store.mjs';
import { createQuestCloudHandler } from '../../npc-factory/quest-cloud-handler.mjs';
import { QUEST_ID, nextQuestStage } from '../../npc-factory/quest-contract.mjs';
import { MAIN2_QUEST_ID } from '../../npc-factory/main2-quest-contract.mjs';

export const worldRoot = fileURLToPath(new URL('../../', import.meta.url));
const SYNTHETIC_RPC_ORIGIN = 'https://core15-synthetic.invalid';
const copy = value => structuredClone(value);
const json = value => ({ ok: true, json: async () => copy(value) });
const freshReward = account => ({
  rewardId: 'reward.quest.first_campus', rewardVersion: 2,
  rewardTransactionId: `synthetic-first-campus-${account}`, status: 'SUCCESS', replayed: false,
  completedAt: '2026-10-04T00:00:00Z',
  entries: [
    { grantType: 'ITEM', targetId: 'badge.main_gate', requested: 1, granted: 1, status: 'GRANTED', reason: null },
    { grantType: 'EXP', targetId: 'exp.campus', requested: 100, granted: 100, status: 'GRANTED', reason: null }
  ]
});
const progressionSnapshot = complete => complete ? {
  totalExp: 100, level: 2, currentLevelStartExp: 100, nextLevelExp: 300,
  progressExp: 0, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false
} : {
  totalExp: 0, level: 1, currentLevelStartExp: 0, nextLevelExp: 100,
  progressExp: 0, progressRequired: 100, maxDefinedLevel: 10, isMaxLevel: false
};

// Fail closed when a source seam changes: execute current committed source, not a policy copy.
function between(source, start, end) {
  assert.equal(source.split(start).length, 2, `unique seam start: ${start}`);
  const from = source.indexOf(start) + start.length;
  const to = source.indexOf(end, from);
  assert.ok(to > from, `seam end: ${end}`);
  return source.slice(from, to);
}
function element(html, id) {
  const opening = new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
  assert.ok(opening, `committed element ${id}`);
  const tags = new RegExp(`<(/?)${opening[1]}\\b[^>]*>`, 'gi');
  tags.lastIndex = opening.index;
  let depth = 0, token;
  while ((token = tags.exec(html))) {
    depth += token[1] ? -1 : 1;
    if (depth === 0) return html.slice(opening.index, tags.lastIndex);
  }
  assert.fail(`unclosed committed element ${id}`);
}

export async function createReceiptFixture() {
  const html = await readFile(resolve(worldRoot, 'campus/index.html'), 'utf8');
  const main = await readFile(resolve(worldRoot, 'src/main.js'), 'utf8');
  const npc = await readFile(resolve(worldRoot, 'npc-factory/dev-runtime.mjs'), 'utf8');
  const styles = await readFile(resolve(worldRoot, 'styles.css'), 'utf8');
  const reward = between(main, '      onQuestReward: ', ',\n      getAiSession:');
  const observe = '  if (!lobbyWorld.active && !lobbyTransition.active) firstCampusCompletion.observe({' +
    between(main, '  if (!lobbyWorld.active && !lobbyTransition.active) firstCampusCompletion.observe({', '\n  resumeStore.maybeSave');
  const discoveryBlock = between(main, 'nextDiscovery = createNextDiscovery({', '\n\nbackGateArrival =');
  const primary = between(discoveryBlock, '  onPrimary: ', '\n});');
  const navigationTarget = between(main, 'const main2GuideNavigationTarget = ', '\nnextDiscovery =');
  const panel = 'function addPanel(' + between(npc, 'function addPanel(', '\nexport async function createNpcDevRuntime');
  const scope = 'firstCampusCompletion, core15Funnel, mcmEventUi, progression, wallet, inventory, FIRST_CAMPUS_REWARD_ID, lobbyWorld, lobbyTransition, inputFocus, isElementVisible, document, navigation, main2GuideNavigationTarget, nextDiscovery, setNavigationTarget, showWorldStatus';
  const seams = `export function reward(reward, scope) { const {${scope}} = scope; return (${reward})(reward); }\n` +
    `export function observe(scope) { const {${scope}} = scope; ${observe} }\n` +
    `export function primary(discovery, scope) { const {${scope}} = scope; return (${primary})(discovery); }\n` +
    `export function target(campusNavigation, MAIN2_GUIDE_NPC, CAMPUS_NAV_SPACE) { return (${navigationTarget.replace(/;\s*$/, '')})(); }\n` +
    `export ${panel}\n`;
  // Source-generated module must parse even in environments where Chromium cannot launch.
  new Function(seams.replaceAll('export ', ''));
  const topbar = html.match(/<header class="campus-topbar"[\s\S]*?<\/header>/)?.[0];
  assert.ok(topbar);
  const documentHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CORE-15 synthetic component integration</title><link rel="stylesheet" href="/styles.css"></head><body data-space="campus">${topbar}${['progression-hud', 'quest-hud', 'minimap', 'nav-guidance', 'hud-menu', 'follow-status'].map(id => element(html, id)).join('\n')}<script type="module" src="/tests/browser/core15-receipt-recovery-page.mjs"></script></body></html>`;
  const accounts = new Map(), rpcCalls = [], requests = [], telemetry = [], failures = [];
  const holds = new Map();
  function seed(account, options = {}) {
    assert.match(account, /^[a-zA-Z0-9-]+$/);
    const row = { stage: 4, grants: 0, receipt: null, statusFailures: 0, holdCompletion: false, holdProgression: false, ...options };
    if (row.stage === 5) row.receipt = freshReward(account);
    accounts.set(account, row);
    return row;
  }
  const get = account => { assert.ok(accounts.has(account), `synthetic account ${account}`); return accounts.get(account); };
  async function hold(key) { await new Promise(resolve => { const list = holds.get(key) ?? []; list.push(resolve); holds.set(key, list); }); }
  function release(key) { const list = holds.get(key) ?? []; holds.delete(key); for (const resolve of list) resolve(); return list.length; }
  const store = createSupabaseQuestStore({ serviceRoleKey: 'synthetic-test-value-not-a-credential', supabaseUrl: SYNTHETIC_RPC_ORIGIN,
    fetcher: async (url, options) => {
      // This adapter never invokes fetch. Unexpected destinations fail before any network I/O.
      assert.equal(new URL(url).origin, SYNTHETIC_RPC_ORIGIN);
      const rpc = new URL(url).pathname.split('/').at(-1), body = JSON.parse(options.body);
      rpcCalls.push({ rpc, body });
      if (rpc === 'world_reward_get_result_v1') {
        const account = body.p_idempotency_key.replace(/^grant:quest.first_campus:/, '');
        assert.equal(body.p_idempotency_key, `grant:quest.first_campus:${account}`);
        const receipt = get(account).receipt;
        return json(receipt && { ...receipt, replayed: true, userId: account, idempotencyKey: body.p_idempotency_key,
          sourceType: 'QUEST', sourceId: 'quest.first_campus', attempts: 1 });
      }
      const row = get(body.p_user);
      if (rpc === 'advance_world_navigation_quest_v1') {
        assert.equal(body.p_event, 'status', 'this fixture does not advance Main 2');
        return json({ quest_id: MAIN2_QUEST_ID, stage: 0, available: row.stage === 5 });
      }
      assert.equal(rpc, 'advance_world_quest_v1');
      if (body.p_event === 'status' && row.statusFailures > 0) {
        row.statusFailures--; return { ok: false };
      }
      const previous = row.stage;
      row.stage = nextQuestStage(row.stage, body.p_event);
      const result = { quest_id: QUEST_ID, stage: row.stage };
      if (previous === 4 && row.stage === 5) {
        assert.equal(row.grants, 0, 'no duplicate synthetic grant');
        row.grants++; row.receipt = freshReward(body.p_user); result.reward = row.receipt;
      }
      return json(result);
    }
  });
  const handler = createQuestCloudHandler({
    verifyUser: async authorization => {
      const account = authorization?.replace(/^Bearer synthetic:/, '');
      return accounts.has(account) && authorization === `Bearer synthetic:${account}` ? account : null;
    },
    store: async (account, event, questId) => {
      requests.push({ account, event, questId });
      const result = await store(account, event, questId);
      if (get(account).holdCompletion && event === 'talk_001') await hold(`completion:${account}`);
      return result;
    }
  });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/__fixture/quest') { await handler(req, res); return; }
      if (url.pathname === '/__fixture/progression') {
        const account = req.headers.authorization?.replace(/^Bearer synthetic:/, '');
        const row = get(account);
        const snapshot = progressionSnapshot(Boolean(row.receipt));
        if (row.receipt && row.holdProgression) await hold(`progression:${account}`);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: snapshot, error: null })); return;
      }
      if (url.pathname === '/__fixture/telemetry') {
        let body = ''; for await (const part of req) body += part;
        const entry = JSON.parse(body);
        get(entry.account);
        if (!telemetry.some(item => item.eventId === entry.eventId)) telemetry.push(entry);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ eventId: entry.eventId })); return;
      }
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(documentHtml); return; }
      if (url.pathname === '/__fixture/main-seams.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(seams); return; }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const path = resolve(worldRoot, `.${decodeURIComponent(url.pathname)}`);
      assert.ok(path.startsWith(worldRoot.endsWith(sep) ? worldRoot : worldRoot + sep));
      assert.ok(['.js', '.mjs', '.css', '.json'].includes(extname(path)), `static fixture path ${path}`);
      res.setHeader('Content-Type', ({ '.css': 'text/css', '.json': 'application/json' })[extname(path)] ?? 'text/javascript');
      res.end(await readFile(path));
    } catch (error) { failures.push(String(error.stack ?? error)); res.writeHead(500); res.end('Fixture error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`, seed, get, release, holds, requests, rpcCalls, telemetry, failures, seams,
    ledgerSummary: () => Object.fromEntries([...accounts].map(([account, row]) => [account, { stage: row.stage, syntheticGrants: row.grants, receiptId: row.receipt?.rewardTransactionId ?? null }])),
    sourceHashes: Object.fromEntries([['main.js', main], ['campus/index.html', html], ['styles.css', styles], ['npc-factory/dev-runtime.mjs', npc]].map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])),
    async close() { for (const key of holds.keys()) release(key); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}
