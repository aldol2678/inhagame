import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Test-only rollout dependency injection, following the existing campus smoke fixtures.
// This code is never shipped/imported by the app. It does not replace access policies, RPCs,
// collision, positions or expiry; only a loopback-served main constructor argument is enabled.
export async function installJeongseokServerMode(context) {
  const source = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const needle = 'const jeongseokEntryMode = resolveJeongseokEntryMode({ previewHost, params: startupParams });';
  assert.equal(source.split(needle).length, 2, 'shipped main retains one CLOSED-by-default rollout constructor');
  const candidate = source.replace(needle,
    'const jeongseokEntryMode = resolveJeongseokEntryMode({ previewHost, params: startupParams, serverAccessAvailable: true });');
  await context.route('**/src/main.js', route => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname), 'rollout fixture is loopback-only');
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: candidate });
  });
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  return { mode: 'TEST_ONLY_ROLLOUT_CONSTRUCTOR', shippedMainSha256: sha256(source), servedMainSha256: sha256(candidate) };
}

// Browser-only dependency fixture: synthetic Auth identity and Supabase RPC replies.
// Apart from the explicitly injected rollout constructor argument below, online identity,
// access parser, guide/reader, policy, Room Transition, collision and renderer are unchanged. No credentials, network calls or real economy.
// The shared harness still blocks every off-origin request. This is NOT server-authority QA.
export async function installSyntheticJeongseokAccess(context) {
  await context.addInitScript(() => {
    const first = '11111111-1111-4111-8111-111111111111';
    let userId = first, verified = false, balance = 250, expiresAt = null, gateStatus = 'ACTIVE';
    const listeners = new Set(), receipts = new Map(), calls = [];
    const user = () => userId ? { id: userId, is_anonymous: false, email: 'synthetic@example.test' } : null;
    // Deliberately no access_token: the real online identity path runs, Realtime stays offline.
    const session = () => userId ? { user: user() } : null;
    const offer = () => ({ status: 'ACTIVE', passType: 'jeongseok.visitor.day', price: 100,
      currencyId: 'currency.induck_coin', durationSeconds: 86400, balance,
      canPurchase: balance >= 100, shortfall: Math.max(100 - balance, 0) });
    function snapshot() {
      const now = Date.now(), active = expiresAt !== null && expiresAt > now;
      const decision = gateStatus !== 'ACTIVE' ? gateStatus : !userId ? 'AUTH_REQUIRED' : verified || active ? 'GRANTED' : expiresAt ? 'EXPIRED' : 'NEEDS_PASS';
      const identified = ['GRANTED', 'NEEDS_PASS', 'EXPIRED'].includes(decision);
      return { version: 1, decision, granted: decision === 'GRANTED',
        via: decision === 'GRANTED' ? verified ? 'INHA_MAIL' : 'VISITOR_PASS' : null,
        gateStatus, serverNow: new Date(now).toISOString(), userId: identified ? userId : null,
        inhaMailVerified: identified ? verified : null,
        pass: identified && expiresAt ? { passType: 'jeongseok.visitor.day', issuedAt: new Date(expiresAt - 86400000).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(), active } : null,
        offer: ['NEEDS_PASS', 'EXPIRED'].includes(decision) ? offer() : null };
    }
    const query = table => {
      let singular = false;
      const value = () => ({ data: table === 'profiles' && singular ? { user_id: userId, nickname: '합성검증', is_banned: false } : singular ? null : [], error: null });
      let chain;
      chain = new Proxy({}, { get: (_target, property) => property === 'then'
        ? (resolve, reject) => Promise.resolve(value()).then(resolve, reject)
        : (..._args) => { if (property === 'single' || property === 'maybeSingle') singular = true; return chain; } });
      return chain;
    };
    const client = {
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        getUser: async () => ({ data: { user: user() }, error: null }),
        onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
        signInAnonymously: async () => ({ data: { user: null, session: null }, error: null })
      },
      from: query,
      channel() { const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => 'ok',
        track: async () => 'ok', untrack: async () => 'ok', send: async () => 'ok', presenceState: () => ({}) }; return channel; },
      removeChannel: async () => 'ok',
      async rpc(name, args = {}) {
        calls.push({ name, accountId: userId });
        if (name === 'get_jeongseok_access_v1') return { data: snapshot(), error: null };
        if (name === 'purchase_jeongseok_pass_v1') {
          const key = args.p_idempotency_key;
          if (receipts.has(key)) return { data: { ...receipts.get(key), status: 'ALREADY_PROCESSED', access: snapshot() }, error: null };
          if (!userId || verified || balance < 100 || gateStatus !== 'ACTIVE') return { data: null, error: { message: 'PASS_UNAVAILABLE' } };
          const before = balance; balance -= 100; expiresAt = Date.now() + 86400000;
          const data = { status: 'SUCCESS', userId, idempotencyKey: key, passType: 'jeongseok.visitor.day',
            purchaseId: '22222222-2222-4222-8222-222222222222', walletTransactionId: '33333333-3333-4333-8333-333333333333',
            price: 100, balanceBefore: before, balanceAfter: balance,
            issuedAt: new Date(expiresAt - 86400000).toISOString(), expiresAt: new Date(expiresAt).toISOString(), access: snapshot() };
          receipts.set(key, data); return { data, error: null };
        }
        // Unrelated account features remain unavailable rather than inventing valid data.
        return { data: null, error: { message: 'OFFLINE_SYNTHETIC_UNSUPPORTED_RPC' } };
      }
    };
    globalThis.supabase = { createClient: () => client };
    globalThis.__JSL_SYNTHETIC__ = {
      first,
      status: () => ({ userId, verified, balance, expiresAt, gateStatus, purchases: receipts.size, calls: [...calls] }),
      setAccess(value) {
        if ('verified' in value) verified = value.verified;
        if ('expiresAt' in value) expiresAt = value.expiresAt;
        if ('gateStatus' in value) gateStatus = value.gateStatus;
      },
      switchAccount(id) { userId = id; verified = false; expiresAt = null; balance = 99;
        for (const fn of listeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', session()); }
    };
  });
}
