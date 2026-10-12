// Synthetic browser fixture only. Real mount -> panels -> HTTP client -> auth handler -> mock RPC.
// Injected fetchers never use network. All actors, tokens, keys, holdings and receipts are synthetic.
import { mountIncomeCandidate } from '../../src/income/income-candidate-runtime.mjs';
import { createConfiguredIncomeCandidateHandler } from '../../server/income-candidate-http.mjs';
import { IncomeError } from '../../server/income-service.mjs';
// Minimal Node request-body adapter only for this browser fixture; all bodies are JSON strings.
// The real HTTP handler is unchanged. This shim cannot read files or make network requests.
globalThis.Buffer ??= { isBuffer: () => false, byteLength: value => new TextEncoder().encode(value).byteLength };
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QUEST = 'quest.side.convenience_help', DELIVERY = 'quest.side.taerin_carp', KEY = 'income-synthetic-fixture-v2';
const labels = [
  ['상품 표시를 확인하세요. 오늘까지인 상품과 다음 주까지인 상품 중 먼저 진열할 것은?', '오늘까지인 상품을 앞에 진열한다', '다음 주까지인 상품만 앞에 놓는다'],
  ['POS 연결이 끊겼어요. 계산·포장 전에 결제 상태를 어떻게 확인할까요?', '결제 기록을 확인해 중복 결제를 막고 주문을 포장한다', '결제 버튼을 계속 누르고 바로 포장한다'],
  ['마지막 진열 정리: 가격표와 상품 위치가 어긋났어요. 무엇부터 할까요?', '상품 표시와 가격표를 대조한 뒤 제자리에 정리한다', '가격표를 보지 않고 빈칸을 채운다']
];
let account = A, failReads = 0, loseFinish = false, hold = null, calls = [], events = [], commits = [], deliveryCommits = [], httpCalls = [];
let records;
try { records = JSON.parse(sessionStorage.getItem(KEY) ?? '{}'); } catch { records = {}; }
const fresh = () => ({ id: null, revision: 0, state: null, earned: 0, remaining: 1, receipt: null, enabled: true, settlements: 0, owned: 2 });
const record = (actor, quest = QUEST) => records[`${actor}:${quest}`] ??= fresh();
const persist = () => sessionStorage.setItem(KEY, JSON.stringify(records));
function raw(actor, quest = QUEST) {
  const r = record(actor, quest), revision = r.revision, delivery = quest === DELIVERY;
  const earned = record(actor, QUEST).earned + record(actor, DELIVERY).earned;
  return { enabled: r.enabled, questId: quest, sessionId: r.id, state: r.state, revision, coin: delivery ? 20 : 30,
    inventory: delivery ? { itemId: 'material.fish_carp', requiredQuantity: 1, ownedQuantity: r.owned } : null,
    nextChallenge: r.state === 'ACTIVE' ? { id: `${r.id}:${revision}`, action: ['stock', 'checkout', 'tidy'][revision],
      prompt: labels[revision][0], choices: [{ id: 'careful', label: labels[revision][1] }, { id: 'rushed', label: labels[revision][2] }],
      availableAt: '2026-10-11T11:00:00Z' } : null,
    receipt: r.receipt, budget: { dailyCap: 60, earnedCoin: earned, remainingCoin: 60 - earned,
      remainingShifts: record(actor, QUEST).remaining, remainingDeliveries: record(actor, DELIVERY).remaining, budgetDate: '2026-10-11' } };
}
const mockRpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) }); const actor = args.p_user;
    const quest = args.p_quest_id ?? [QUEST, DELIVERY].find(q => record(actor, q).id === args.p_session_id);
    if (!quest) throw new IncomeError('INCOME_SESSION_NOT_FOUND', 409);
    const r = record(actor, quest), delivery = quest === DELIVERY;
    if (name === 'world_income_status_v1') {
      if (failReads > 0) { failReads--; throw new IncomeError('INCOME_UNAVAILABLE', 503); }
      return raw(actor, quest);
    }
    if (hold?.name === name) { const pending = hold; pending.started = true; await pending.promise; if (hold === pending) hold = null; }
    if (!r.enabled) throw new IncomeError('INCOME_CLOSED', 409);
    if (name === 'world_income_start_v1') {
      if (r.remaining < 1) throw new IncomeError('INCOME_DAILY_LIMIT', 409);
      if (!r.id || ['EXPIRED', 'SETTLED'].includes(r.state)) Object.assign(r, { id: crypto.randomUUID(), revision: 0, state: delivery ? 'READY_TO_SETTLE' : 'ACTIVE', receipt: null });
    } else if (name === 'world_income_action_v1') {
      if (args.p_session_id !== r.id || args.p_revision !== r.revision) throw new IncomeError('INCOME_STEP_MISMATCH', 409);
      if (args.p_value !== 'careful') throw new IncomeError('INCOME_WRONG_CHOICE', 409);
      if (r.state !== 'ACTIVE') throw new IncomeError('INCOME_NOT_READY', 409);
      r.revision++; if (r.revision === 3) r.state = 'READY_TO_SETTLE';
    } else if (name === 'world_income_finish_v1') {
      if (r.state !== 'SETTLED') {
        if (r.state !== 'READY_TO_SETTLE') throw new IncomeError('INCOME_NOT_READY', 409);
        if (delivery && r.owned < 1) throw new IncomeError('INCOME_MATERIAL_REQUIRED', 409);
        r.state = 'SETTLED'; r.earned += delivery ? 20 : 30; r.remaining = 0; r.settlements++;
        if (delivery) r.owned--;
        r.receipt = { sessionId: r.id, settlementId: crypto.randomUUID(), coin: delivery ? 20 : 30, committed: true };
      }
      persist();
      if (loseFinish) { loseFinish = false; failReads = 1; throw new IncomeError('INCOME_UNAVAILABLE', 503); }
    }
    persist(); return raw(actor, quest);
};
const handler = createConfiguredIncomeCandidateHandler({ WORLD_INCOME_CANDIDATE_ENABLED: '1',
  WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://127.0.0.1:54321',
  WORLD_INCOME_CANDIDATE_ANON_KEY: 'synthetic-fixture-not-a-credential',
  WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: 'synthetic-fixture-not-a-credential'
}, async (url, init) => {
  if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({
    id: init.headers.Authorization.includes('account.a') ? A : B, is_anonymous: false }) };
  try { const value = await mockRpc(url.split('/').at(-1), JSON.parse(init.body)); return { ok: true, status: 200, json: async () => value }; }
  catch (error) {
    if (error.status >= 500) throw error;
    return { ok: false, status: error.status ?? 503, json: async () => ({ message: error.code }) };
  }
});
const fetcher = async (url, init) => {
  if (url !== '/api/world-income-candidate') throw new Error('FIXTURE_NETWORK_FORBIDDEN');
  httpCalls.push({ method: init.method, body: JSON.parse(init.body) });
  const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
  headers.host = 'localhost:8080'; headers.origin = 'http://localhost:8080';
  const res = { setHeader() {}, end(text) { this.text = text; } };
  await handler({ method: init.method, headers, body: init.body }, res);
  return { ok: res.statusCode === 200, status: res.statusCode, json: async () => JSON.parse(res.text) };
};
const root = document.getElementById('candidate-root');
const runtime = mountIncomeCandidate({ root, enabled: true, accountId: A, fetcher,
  location: { hostname: 'localhost' }, getAuthorization: async () => `Bearer synthetic.account.${account === A ? 'a' : 'b'}.fixture.only` });
const client = runtime.job, delivery = runtime.delivery;
const walk = node => [node, ...Array.from(node.children).flatMap(walk)];
const jobPanel = walk(document.body).find(n => n.className?.includes('convenience-job-panel'));
const deliveryPanel = walk(document.body).find(n => n.className?.includes('delivery-income-panel'));
const opener = Array.from(root.children).find(n => n.textContent === '편의점 후보 검토'); opener.id = 'opener';
const deliveryOpener = Array.from(root.children).find(n => n.textContent === '납품 후보 검토'); deliveryOpener.id = 'delivery-opener';
const closePanel = panel => { if (!panel.hidden) walk(panel).find(n => n.tagName === 'BUTTON' && n.textContent === '닫기')?.click(); };
const ui = { get open() { return !jobPanel.hidden; }, close: () => closePanel(jobPanel), dispose: () => runtime.dispose() };
const observeReceipt = (client, list) => client.subscribe(s => {
  const receipt = s.snapshot?.receipt;
  if (receipt && !list.some(r => r.settlementId === receipt.settlementId)) list.push(receipt);
});
observeReceipt(client, commits); observeReceipt(delivery, deliveryCommits);
for (const type of ['keydown', 'click', 'pointerdown']) document.addEventListener(type, event => {
  events.push({ type, trusted: event.isTrusted, key: event.key, pointerType: event.pointerType });
}, true);
const ready = runtime.setAccount(account);
window.__INCOME_FIXTURE__ = {
  client, delivery, runtime, ui, ready, calls, httpCalls, events, commits, deliveryCommits,
  state: () => client.state(), records: () => structuredClone(records),
  async scenario(name) {
    ui.close(); closePanel(deliveryPanel); account = A; records = {}; const r = record(A); calls.length = 0; httpCalls.length = 0; commits.length = 0; deliveryCommits.length = 0; failReads = 0; loseFinish = false;
    if (['checkout', 'expired', 'closedReceipt', 'dailyLimit'].includes(name)) r.id = crypto.randomUUID();
    if (name === 'checkout') Object.assign(r, { state: 'READY_TO_SETTLE', revision: 3 });
    if (name === 'expired') Object.assign(r, { state: 'EXPIRED', revision: 1 });
    if (name === 'closedReceipt') Object.assign(r, { state: 'SETTLED', revision: 3, enabled: false,
      earned: 30, remaining: 0, settlements: 1, receipt: { sessionId: r.id, settlementId: crypto.randomUUID(), coin: 30, committed: true } });
    if (name === 'dailyLimit') Object.assign(r, { id: null, state: null, remaining: 0, earned: 60 });
    if (name === 'deliveryInsufficient') record(A, DELIVERY).owned = 0;
    persist(); await runtime.setAccount(null); await runtime.setAccount(A);
  },
  async switchAccount() { account = account === A ? B : A; await runtime.setAccount(account); },
  loseNextFinish() { loseFinish = true; },
  holdNext(name) { let release; const promise = new Promise(resolve => { release = resolve; }); hold = { name, promise, release, started: false }; },
  held: () => hold?.started ?? false,
  release() { hold?.release(); }
};
await ready; opener.disabled = false; document.getElementById('ready').textContent = '합성 fixture 준비 완료'; opener.focus();
