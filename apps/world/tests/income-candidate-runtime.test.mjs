import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';
import { mountIncomeCandidate } from '../src/income/income-candidate-runtime.mjs';
import { createConfiguredIncomeCandidateHandler } from '../server/income-candidate-http.mjs';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deliveryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
test('actual candidate mount → HTTP transport → auth handler → mock RPC supports delivery receipt', async () => {
  const records = new Map(); let calls = 0;
  const handler = createConfiguredIncomeCandidateHandler({ WORLD_INCOME_CANDIDATE_ENABLED: '1',
    WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://127.0.0.1:54321', WORLD_INCOME_CANDIDATE_ANON_KEY: 'fake', WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: 'fake' }, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: user, is_anonymous: false }) };
    calls++;
    const args = JSON.parse(init.body); assert.equal(args.p_user, user);
    const name = url.split('/').at(-1); const quest = args.p_quest_id ?? 'quest.side.taerin_carp';
    const delivery = quest === 'quest.side.taerin_carp';
    let raw = records.get(quest) ?? { enabled: true, questId: quest, coin: delivery ? 20 : 30, sessionId: null, state: null, receipt: null,
      budget: { remainingCoin: 60, remainingDeliveries: 1, remainingShifts: 1, budgetDate: '2026-10-11' },
      inventory: delivery ? { itemId: 'material.fish_carp', requiredQuantity: 1, ownedQuantity: 2 } : null };
    if (name === 'world_income_start_v1') raw = { ...raw, sessionId: deliveryId, state: 'READY_TO_SETTLE' };
    if (name === 'world_income_finish_v1') raw = { ...raw, state: 'SETTLED', inventory: { ...raw.inventory, ownedQuantity: 1 },
      receipt: { sessionId: deliveryId, settlementId: deliveryId, coin: 20, committed: true } };
    records.set(quest, raw); return { ok: true, json: async () => raw };
  });
  const fetcher = async (url, init) => {
    assert.equal(url, '/api/world-income-candidate');
    const headers = Object.fromEntries(Object.entries(init.headers).map(([key, value]) => [key.toLowerCase(), value]));
    headers.host = 'localhost:8080'; headers.origin = 'http://localhost:8080';
    const res = { setHeader() {}, end(text) { this.text = text; } };
    await handler({ method: init.method, headers, body: init.body }, res);
    return { ok: res.statusCode === 200, status: res.statusCode, json: async () => JSON.parse(res.text) };
  };
  const doc = createFakeDocument(); doc.body = doc.createElement('body'); const root = doc.createElement('div'); doc.body.append(root);
  const runtime = mountIncomeCandidate({ enabled: true, root, doc, location: { hostname: 'localhost' }, navigation: {}, accountId: user,
    getAuthorization: async () => 'Bearer local.synthetic.token.for.test.only', fetcher });
  await runtime.delivery.refresh(); await runtime.job.refresh();
  const jobButton = root.children.find(el => el.textContent === '편의점 후보 검토');
  jobButton.click();
  assert.ok(doc.body.children.some(el => el.className?.includes('convenience-job-panel') && !el.hidden));
  const deliveryButton = root.children.find(el => el.textContent === '납품 후보 검토');
  deliveryButton.click();
  await runtime.delivery.refresh();
  assert.ok(doc.body.children.some(el => el.className?.includes('delivery-income-panel') && !el.hidden));
  await runtime.delivery.accept(); assert.equal(runtime.delivery.state().snapshot.ownedQuantity, 2);
  await runtime.delivery.submit(); assert.equal(runtime.delivery.state().snapshot.receipt.coin, 20);
  assert.equal(runtime.delivery.state().snapshot.ownedQuantity, 1); assert.ok(calls >= 6);
  runtime.dispose(); assert.equal(runtime.delivery.state().accountId, null);
});
test('candidate mount is never present in main/NPC and explicitly denies hosted mounts', () => {
  assert.throws(() => mountIncomeCandidate({ enabled: true, root: {}, location: { hostname: 'inhagame.example' } }), /LOCAL_ONLY/);
  for (const file of ['../src/main.js', '../npc-factory/dev-runtime.mjs']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /mountIncomeCandidate|delivery-income|convenience-job/);
  }
  assert.match(fs.readFileSync(new URL('../dev-server.mjs', import.meta.url), 'utf8'), /\/api\/world-income-candidate/);
});
