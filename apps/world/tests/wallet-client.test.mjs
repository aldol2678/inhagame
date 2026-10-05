import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INDUCK_COIN, WALLET_RPC, WALLET_STATE, createWalletClient, parseWalletSnapshot, walletBalance
} from "../src/wallet/wallet-client.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const wallet = (...currencies) => ({ currencies });
const coin = (balance) => ({ id: INDUCK_COIN, balance });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeClient() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      return next instanceof Promise ? next : Promise.resolve(next);
    }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("parse: the documented read → server balances as served", () => {
  assert.deepEqual(parseWalletSnapshot(wallet(coin(120))), { balances: { [INDUCK_COIN]: 120 } });
  assert.equal(walletBalance(parseWalletSnapshot(wallet(coin(0)))), 0, "fresh wallet: 0 is a real balance");
  assert.equal(walletBalance(parseWalletSnapshot(wallet(coin(1234)))), 1234);
  assert.deepEqual(parseWalletSnapshot(wallet()), { balances: {} });
  assert.ok(Object.isFrozen(parseWalletSnapshot(wallet(coin(1))).balances));
});

test("parse: malformed reads are rejected, never repaired", () => {
  for (const raw of [null, "120", 120, {}, { currencies: {} }, wallet(coin(-1)), wallet(coin(1.5)), wallet(coin("120")),
    wallet(coin(null)), wallet({ id: "", balance: 1 }), wallet({ balance: 1 }), wallet(null), wallet(coin(2 ** 53)),
    wallet(coin(1), coin(2))]) {
    assert.equal(parseWalletSnapshot(raw), null, JSON.stringify(raw));
  }
});

test("parse: unknown currencies are kept apart; only the asked currency is read", () => {
  const snapshot = parseWalletSnapshot(wallet({ id: "currency.future_token", balance: 9 }, coin(40)));
  assert.equal(walletBalance(snapshot, INDUCK_COIN), 40);
  assert.equal(walletBalance(snapshot), 40, "defaults to 인덕코인");
  assert.equal(walletBalance(parseWalletSnapshot(wallet({ id: "currency.future_token", balance: 9 }))), null,
    "no 인덕코인 entry → no balance, never a guessed 0");
  assert.equal(walletBalance(null), null);
});

test("fresh permanent account → READY with 0", async () => {
  const client = fakeClient();
  const w = createWalletClient({ getClient: () => client });
  client.respond({ data: wallet(coin(0)), error: null });
  assert.equal(await w.setAccount(A), true);
  assert.equal(w.state, WALLET_STATE.READY);
  assert.equal(w.balance(), 0);
  assert.deepEqual(client.calls, [{ fn: WALLET_RPC, args: undefined }], "one no-argument read");
});

test("signed-out and guest: no wallet RPC at all", async () => {
  const client = fakeClient();
  const signedOut = createWalletClient({ getClient: () => client });
  assert.equal(signedOut.state, WALLET_STATE.SIGNED_OUT);
  assert.equal(await signedOut.refresh("open"), false);
  assert.equal(await signedOut.setAccount(null), false);
  // Guest: an identity may exist, but online.supabase is null for guests.
  const guest = createWalletClient({ getClient: () => null });
  await guest.setAccount(A);
  await guest.refresh("reward");
  assert.equal(guest.state, WALLET_STATE.SIGNED_OUT);
  assert.equal(guest.balance(), null);
  assert.equal(client.calls.length, 0);
});

test("RPC error, throw or malformed data → UNAVAILABLE, no balance", async () => {
  for (const response of [{ data: null, error: { message: "ACCOUNT_UNAVAILABLE" } }, { data: { currencies: "x" }, error: null },
    Promise.reject(new Error("network"))]) {
    const client = fakeClient();
    const w = createWalletClient({ getClient: () => client });
    client.respond(response);
    assert.equal(await w.setAccount(A), false);
    assert.equal(w.state, WALLET_STATE.UNAVAILABLE);
    assert.equal(w.snapshot, null);
    assert.equal(w.balance(), null);
  }
});

test("account switch drops the previous snapshot immediately", async () => {
  const client = fakeClient();
  const w = createWalletClient({ getClient: () => client });
  const changes = [];
  w.onChange((change) => changes.push(change));
  client.respond({ data: wallet(coin(500)), error: null });
  await w.setAccount(A);
  const pending = deferred();
  client.respond(pending.promise);
  const switching = w.setAccount(B);
  assert.equal(w.state, WALLET_STATE.LOADING);
  assert.equal(w.snapshot, null, "A's 500 is gone before B's read returns");
  assert.equal(w.balance(), null);
  pending.resolve({ data: wallet(coin(7)), error: null });
  await switching;
  assert.equal(w.balance(), 7);
  assert.deepEqual(changes.map((c) => [c.state, c.accountId]),
    [[WALLET_STATE.LOADING, A], [WALLET_STATE.READY, A], [WALLET_STATE.LOADING, B], [WALLET_STATE.READY, B]]);
  assert.equal(await w.setAccount(B), true, "same account is a no-op");
  assert.equal(client.calls.length, 2);
});

test("stale response: A's read that lands after switching to B (or signing out) is discarded", async () => {
  const client = fakeClient();
  const w = createWalletClient({ getClient: () => client });
  const lateA = deferred();
  client.respond(lateA.promise);
  void w.setAccount(A);
  const bRead = deferred();
  client.respond(bRead.promise);
  const b = w.setAccount(B);
  bRead.resolve({ data: wallet(coin(3)), error: null });
  await b;
  lateA.resolve({ data: wallet(coin(99999)), error: null });
  await flush(); await flush();
  assert.equal(w.accountId, B);
  assert.equal(w.balance(), 3, "A's late balance never shows under B");

  const lateB = deferred();
  client.respond(lateB.promise);
  void w.refresh("purchase");
  await w.setAccount(null);
  lateB.resolve({ data: wallet(coin(50)), error: null });
  await flush(); await flush();
  assert.equal(w.state, WALLET_STATE.SIGNED_OUT);
  assert.equal(w.snapshot, null);
});

test("refreshes coalesce: one in flight plus one follow-up, and the follow-up wins", async () => {
  const client = fakeClient();
  const w = createWalletClient({ getClient: () => client });
  client.respond({ data: wallet(coin(100)), error: null });
  await w.setAccount(A);
  const first = deferred();
  client.respond(first.promise);
  client.respond({ data: wallet(coin(40)), error: null });
  const runs = [w.refresh("purchase"), w.refresh("reward"), w.refresh("open")];
  first.resolve({ data: wallet(coin(100)), error: null });
  await Promise.all(runs);
  assert.equal(client.calls.length, 3, "account read + 1 in flight + 1 follow-up");
  assert.equal(w.balance(), 40, "the newest server answer is shown");
});

test("a refresh keeps the last server balance until the new server answer (no computed value)", async () => {
  const client = fakeClient();
  const w = createWalletClient({ getClient: () => client });
  client.respond({ data: wallet(coin(300)), error: null });
  await w.setAccount(A);
  const next = deferred();
  client.respond(next.promise);
  const run = w.refresh("purchase");
  assert.equal(w.balance(), 300, "still the served value, never 300 - price");
  next.resolve({ data: wallet(coin(180)), error: null });
  await run;
  assert.equal(w.balance(), 180);
});

test("wallet code: read-only single RPC, no client creation, no storage, no arithmetic on balances", () => {
  const source = readFileSync(new URL("../src/wallet/wallet-client.js", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]), ["get_my_world_wallet_v1"]);
  assert.doesNotMatch(source, /createClient\(|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /balance\s*[-+]=|[-+]\s*price|price\s*[-+]/, "no local balance math");
});

test("main.js wiring: member client, identity, reward, resume; Reward and Shop authority untouched", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /createWalletClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/);
  assert.match(main, /void wallet\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  assert.match(main, /onReward: result => \{[\s\S]*?void progression\.refresh\("reward"\);\s*void wallet\.refresh\("reward"\);/,
    "a finished reward claim re-reads progression (unchanged) and the wallet");
  assert.match(main, /addEventListener\("pageshow"[\s\S]*?void wallet\.refresh\("resume"\)/);
  assert.match(main, /createShopPanel\(\{[\s\S]*?shop,\s*wallet,/);
  assert.doesNotMatch(main, /setInterval\([^)]*wallet/, "no polling");
  const shop = readFileSync(new URL("../src/shop/shop-client.js", import.meta.url), "utf8");
  assert.doesNotMatch(shop, /wallet/i, "the shop client does not carry wallet logic");
});
