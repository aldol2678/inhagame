import test from "node:test";
import assert from "node:assert/strict";
import { GuestbookClient, GuestbookError } from "../src/guestbook/guestbook-client.js";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const ID = "c0000000-0000-4000-8000-000000000003";
const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = (userId = A) => ({ id: ID, userId, content: "synthetic post", mine: true });
const board = (userId = A) => ({ locationKey: "main_gate", entries: [entry(userId)] });
const stale = error => error instanceof GuestbookError && error.code === "STALE";

function fixture() {
  let account = A;
  const calls = [];
  const client = { rpc(name, args) {
    return new Promise((resolve, reject) => calls.push({ name, args, resolve: data => resolve({ data, error: null }), reject }));
  } };
  const api = new GuestbookClient({ getClient: () => client, getSelfUserId: () => account });
  return { api, calls, client, switch(next, { getter = true } = {}) {
    if (getter) account = next;
    api.setAccount?.(next);
  } };
}
const operations = {
  create: api => api.create("synthetic post"),
  update: api => api.update(ID, "synthetic edit"),
  remove: api => api.remove(ID)
};

for (const [name, run] of Object.entries(operations)) {
  for (const late of ["success", "failure"]) test(`${name}: old ${late} neither joins nor releases the new account request`, async () => {
    const f = fixture();
    const old = run(f.api);
    const rejected = assert.rejects(old, stale);
    await tick();
    f.switch(B);
    const current = run(f.api);
    await tick();
    assert.equal(f.calls.length, 2, "B sends its own authorized request");
    assert.notEqual(old, current);
    if (late === "success") f.calls[0].resolve(name === "remove" ? true : entry(A));
    else f.calls[0].reject(new Error("synthetic transport failure"));
    await rejected;
    assert.equal(run(f.api), current, "old finally must not release B's single flight");
    f.calls[1].resolve(name === "remove" ? true : entry(B));
    const result = await current;
    assert.equal(name === "remove" ? result : result.userId, name === "remove" ? true : B);
    assert.equal(f.calls.length, 2, "no automatic write retry");
  });
}

for (const late of ["success", "failure"]) test(`A→B→A fences a pending read ${late} by generation`, async () => {
  const f = fixture();
  f.switch(A);
  const old = f.api.load();
  const rejected = assert.rejects(old, stale);
  await tick();
  f.switch(B); f.switch(A);
  const current = f.api.load();
  await tick();
  f.calls[1].resolve(board(A));
  assert.equal((await current).entries[0].userId, A);
  if (late === "success") f.calls[0].resolve(board(A));
  else f.calls[0].reject(new Error("synthetic failure"));
  await rejected;
});

test("explicit logout wins over the old online getter and does not send any RPC", async () => {
  const f = fixture();
  f.switch(A);
  const old = f.api.create("old");
  const rejected = assert.rejects(old, stale);
  await tick();
  f.switch(null, { getter: false });
  assert.equal(f.api.available, false);
  for (const run of [api => api.load(), ...Object.values(operations)]) {
    await assert.rejects(run(f.api), error => error.code === "SIGNED_OUT");
  }
  f.calls[0].resolve(entry(A)); await rejected;
  assert.equal(f.calls.length, 1);
});

test("same-account identity refresh preserves the current single flight", async () => {
  const f = fixture(); f.switch(A);
  const first = f.api.create("first");
  await tick(); f.switch(A);
  assert.equal(f.api.create("second click"), first);
  f.calls[0].resolve(entry()); await first;
  assert.equal(f.calls.length, 1);
});

for (const name of ["create", "update"]) test(`${name} rejects a server entry belonging to another account`, async () => {
  const f = fixture();
  const result = operations[name](f.api);
  const rejected = assert.rejects(result, error => error.code === "FAILED");
  await tick(); f.calls[0].resolve(entry(B)); await rejected;
  assert.equal(f.calls.length, 1);
});

test("list rejects a mismatched mine marker rather than displaying another account's controls", async () => {
  const f = fixture();
  const result = f.api.load();
  const rejected = assert.rejects(result, error => error.code === "FAILED");
  await tick(); f.calls[0].resolve(board(B)); await rejected;
});

test("reentrant account reset inside RPC cannot overwrite the new request owner", async () => {
  const f = fixture();
  const original = f.client.rpc;
  let current;
  f.client.rpc = (name, args) => {
    const result = original(name, args);
    if (f.calls.length === 1) {
      f.switch(null, { getter: false }); f.switch(B);
      current = f.api.create("B post");
    }
    return result;
  };
  const old = f.api.create("A post");
  const rejected = assert.rejects(old, stale);
  await tick();
  assert.equal(f.calls.length, 2);
  f.calls[0].resolve(entry(A)); await rejected;
  assert.equal(f.api.create("B double click"), current);
  f.calls[1].resolve(entry(B)); await current;
  assert.equal(f.calls.length, 2);
});

test("read becoming stale between RPC completion and parsing reports STALE even for malformed data", async () => {
  const f = fixture();
  const result = f.api.load(); const rejected = assert.rejects(result, stale);
  await tick(); f.calls[0].resolve({ locationKey: "invalid" });
  queueMicrotask(() => f.switch(B));
  await rejected;
});
