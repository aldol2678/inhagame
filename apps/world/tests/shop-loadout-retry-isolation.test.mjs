import test from "node:test";
import assert from "node:assert/strict";
import { createShopClient, SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_STUDENT_CENTER } from "../src/shop/shop-client.js";
import {
  APPEARANCE_SLOTS, createLoadoutClient, LOADOUT_READ_RPC, LOADOUT_EQUIP_RPC, LOADOUT_UNEQUIP_RPC
} from "../src/appearance/loadout-client.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ok = (data) => ({ data, error: null });
const success = () => ok({ status: "SUCCESS" });
const timeout = () => new DOMException("Request timed out", "TimeoutError");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Only the transport is controlled. All generation, busy, outcome and key decisions use the real clients.
const operations = [
  {
    name: "shop purchase", create: createShopClient, readRpc: SHOP_READ_RPC, writeRpc: SHOP_PURCHASE_RPC,
    primary: "offer.student_center.campus_mug", other: "offer.student_center.induck_cap",
    read: () => ({ shopId: SHOP_STUDENT_CENTER, status: "ACTIVE", playerLevel: 1, offers: [] }),
    write: (client, listing) => client.purchase(listing), refusal: "LEVEL_REQUIRED"
  },
  {
    name: "loadout equip", create: createLoadoutClient, readRpc: LOADOUT_READ_RPC, writeRpc: LOADOUT_EQUIP_RPC,
    primary: "HEAD", other: "TOP",
    read: () => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map((slot) => [slot, null])) }),
    write: (client, slot) => client.equip(slot, slot === "HEAD" ? "head.inha_cap" : "top.inha_basic"),
    refusal: "ITEM_NOT_OWNED"
  },
  {
    name: "loadout unequip", create: createLoadoutClient, readRpc: LOADOUT_READ_RPC, writeRpc: LOADOUT_UNEQUIP_RPC,
    primary: "HEAD", other: "TOP",
    read: () => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map((slot) => [slot, null])) }),
    write: (client, slot) => client.unequip(slot), refusal: "ITEM_UNAVAILABLE"
  }
];

async function harness(operation) {
  const calls = [];
  const changes = [];
  const writes = [];
  let account = null;
  let sequence = 0;
  const transport = {
    rpc(fn, args) {
      calls.push({ fn, args, account });
      if (fn === operation.readRpc) return Promise.resolve(ok(operation.read()));
      assert.equal(fn, operation.writeRpc, "only the explicitly requested mutation is dispatched");
      const request = deferred();
      writes.push(request);
      return request.promise;
    }
  };
  const client = operation.create({ getClient: () => transport, createKey: () => `test:key-${++sequence}` });
  client.onChange((change) => changes.push(change));
  const setAccount = async (next) => {
    account = next;
    await client.setAccount(next);
    if (next && operation.readRpc === SHOP_READ_RPC) await client.refresh("account");
  };
  await setAccount(A);
  return {
    client, calls, changes, writes, setAccount,
    write: (target = operation.primary) => operation.write(client, target),
    keys: () => calls.filter(({ fn }) => fn === operation.writeRpc).map(({ args }) => args.p_idempotency_key),
    readCount: () => calls.filter(({ fn }) => fn === operation.readRpc).length
  };
}

const oldOutcomes = [
  { name: "success", settle: (request) => request.resolve(success()) },
  { name: "explicit refusal", settle: (request, operation) => request.resolve({ data: null, error: { message: operation.refusal } }) },
  { name: "transport timeout", settle: (request) => request.reject(timeout()) }
];
const transitions = [
  { name: "A → B", accounts: [B] },
  { name: "A → B → A", accounts: [B, A] },
  { name: "A → logout → A", accounts: [null, A] }
];

for (const operation of operations) {
  for (const transition of transitions) {
    for (const oldOutcome of oldOutcomes) {
      for (const failureFirst of [false, true]) {
        const order = failureFirst ? "after the current timeout" : "while the current request is pending";
        test(`${operation.name}: stale ${oldOutcome.name} ${order} preserves the exact retry key (${transition.name})`, async () => {
          const h = await harness(operation);
          const oldWrite = h.write();
          for (const next of transition.accounts) await h.setAccount(next);
          const currentWrite = h.write();
          assert.deepEqual(h.keys(), ["test:key-1", "test:key-2"], "the new account generation starts a fresh intent");

          if (failureFirst) {
            h.writes[1].reject(timeout());
            assert.equal((await currentWrite).outcome, "FAILED");
          }
          const snapshot = h.client.snapshot;
          const changeCount = h.changes.length;
          const readCount = h.readCount();
          oldOutcome.settle(h.writes[0], operation);
          assert.equal((await oldWrite).outcome, "STALE");
          assert.equal(h.client.snapshot, snapshot, "the stale result never updates the new snapshot");
          assert.equal(h.changes.length, changeCount, "the stale result never publishes into the current generation");
          assert.equal(h.readCount(), readCount, "the stale result never schedules a read");
          assert.equal(h.client.isPending(operation.primary), !failureFirst, "pending belongs to the current request");
          assert.deepEqual(h.keys(), ["test:key-1", "test:key-2"], "there is no automatic mutation retry");

          if (!failureFirst) {
            assert.equal((await h.write()).code, "BUSY", "the old completion cannot release the current busy guard");
            h.writes[1].reject(timeout());
            assert.equal((await currentWrite).outcome, "FAILED");
          }
          assert.equal(h.client.isPending(operation.primary), false);
          const retry = h.write();
          assert.deepEqual(h.keys(), ["test:key-1", "test:key-2", "test:key-2"], "manual retry retains the exact unresolved key");
          h.writes[2].resolve(success());
          assert.equal((await retry).outcome, "SUCCESS");
          assert.equal(h.client.isPending(operation.primary), false);
        });
      }
    }
  }

  for (const oldOutcome of oldOutcomes) {
    test(`${operation.name}: late ${oldOutcome.name} after logout leaves no pending state or request`, async () => {
      const h = await harness(operation);
      const oldWrite = h.write();
      await h.setAccount(null);
      const changeCount = h.changes.length;
      const readCount = h.readCount();
      oldOutcome.settle(h.writes[0], operation);
      assert.equal((await oldWrite).outcome, "STALE");
      assert.equal(h.client.accountId, null);
      assert.equal(h.client.snapshot, null);
      assert.equal(h.client.status().pending, 0);
      assert.equal(h.changes.length, changeCount);
      assert.equal(h.readCount(), readCount);
      assert.equal((await h.write()).outcome, "SIGNED_OUT");
      assert.deepEqual(h.keys(), ["test:key-1"], "logout cannot trigger a retry");
    });
  }

  test(`${operation.name}: one target's completion leaves another target pending and independently retryable`, async () => {
    const h = await harness(operation);
    const primary = h.write();
    const other = h.write(operation.other);
    h.writes[0].reject(timeout());
    assert.equal((await primary).outcome, "FAILED");
    assert.equal(h.client.isPending(operation.primary), false);
    assert.equal(h.client.isPending(operation.other), true);
    assert.equal((await h.write(operation.other)).code, "BUSY");
    const retry = h.write();
    assert.deepEqual(h.keys(), ["test:key-1", "test:key-2", "test:key-1"]);
    h.writes[2].resolve(success());
    await retry;
    assert.equal(h.client.isPending(operation.other), true);
    h.writes[1].resolve(success());
    await other;
    assert.equal(h.client.status().pending, 0);
  });

  for (const final of ["success", "refusal"]) {
    test(`${operation.name}: same-account retry retains an unknown key, then current ${final} retires only that key`, async () => {
      const h = await harness(operation);
      const lost = h.write();
      h.writes[0].resolve({ data: null, error: { message: "unrecognized transport failure" } });
      assert.deepEqual([(await lost).outcome, h.client.status().pending], ["FAILED", 0]);
      await h.setAccount(A);
      const retry = h.write();
      assert.deepEqual(h.keys(), ["test:key-1", "test:key-1"]);
      const readsBefore = h.readCount();
      h.writes[1].resolve(final === "success" ? success() : { data: null, error: { message: operation.refusal } });
      const result = await retry;
      assert.equal(result.outcome, final === "success" ? "SUCCESS" : "REFUSED");
      assert.equal(result.code, final === "success" ? null : operation.refusal);
      assert.equal(h.readCount(), readsBefore + 1, "current success or stale-snapshot refusal keeps its refresh");
      const fresh = h.write();
      assert.deepEqual(h.keys(), ["test:key-1", "test:key-1", "test:key-2"]);
      h.writes[2].resolve(success());
      await fresh;
    });
  }
}
