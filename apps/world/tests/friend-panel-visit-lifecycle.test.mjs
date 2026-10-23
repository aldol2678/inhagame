import test from "node:test";
import assert from "node:assert/strict";
import { createFriendPanel } from "../src/social/friend-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const nodes = root => [root, ...root.children.flatMap(nodes)];

async function fixture() {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  let friend = A;
  let finish;
  const calls = [];
  const social = {
    available: true,
    async mine() {
      return { friends: [{ userId: friend, nickname: friend === A ? "A friend" : "B friend" }], incoming: [], outgoing: [], blocked: [] };
    }
  };
  const ui = createFriendPanel({
    panel, toggle: doc.createElement("button"), social, doc, timers: {},
    roomVisit: {
      canVisit: () => ({ ok: true }),
      onVisit(userId, nickname) {
        calls.push({ userId, nickname });
        return new Promise(resolve => { finish = resolve; });
      },
      reasonText: reason => `visit:${reason}`
    }
  });
  await ui.setOpen(true);
  const visit = nodes(panel).find(node => node.className === "friend-room-visit");
  // Await the actual registered handler so the test observes its entire async completion.
  const pending = visit.listeners.get("click")[0]();
  assert.deepEqual(calls, [{ userId: A, nickname: "A friend" }]);
  return { ui, panel, pending, finish: result => finish(result), setFriend: id => { friend = id; } };
}

for (const switchedAccount of [false, true]) {
  for (const result of [{ ok: true }, { ok: false, reason: "signed_out" }]) {
    test(`old room visit ${result.ok ? "success" : "denial"} cannot change a reopened ${switchedAccount ? "B" : "same-account"} panel`, async () => {
      const f = await fixture();
      // Account transitions use setAvailable(false) before opening the next account's panel.
      if (switchedAccount) { f.ui.setAvailable(false); f.setFriend(B); f.ui.setAvailable(true); }
      else await f.ui.setOpen(false);
      await f.ui.setOpen(true);
      const currentData = f.ui.data;
      f.finish(result);
      await f.pending;
      assert.equal(f.ui.open, true, "old success must not close the new panel");
      assert.equal(f.ui.data, currentData, "the current list must be retained");
      assert.deepEqual(f.ui.data.friends.map(person => person.userId), [switchedAccount ? B : A]);
      assert.equal(nodes(f.panel).some(node => node.className === "friend-hint"), false, "old denial must not appear in the new panel");
    });
  }
}

test("current room visit success still closes the panel", async () => {
  const f = await fixture();
  f.finish({ ok: true });
  await f.pending;
  assert.equal(f.ui.open, false);
  assert.equal(f.ui.data, null);
});

test("current room visit denial still displays feedback and allows retry", async () => {
  const f = await fixture();
  f.finish({ ok: false, reason: "ROOM_PRIVATE" });
  await f.pending;
  assert.equal(f.ui.open, true);
  assert.equal(nodes(f.panel).find(node => node.className === "friend-hint")?.textContent, "visit:ROOM_PRIVATE");
  assert.notEqual(nodes(f.panel).find(node => node.className === "friend-room-visit")?.disabled, true);
});
