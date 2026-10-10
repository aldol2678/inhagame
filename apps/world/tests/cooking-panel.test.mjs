import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument, FakeElement } from "./support/fake-dom.mjs";
import { createCookingPanel } from "../src/rooms/cooking-panel.js";
import { createCookingFeature } from "../src/rooms/cooking-feature.js";
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
FakeElement.prototype.querySelectorAll = function(selector) { return walk(this).slice(1).filter(n => n.tagName === selector.toUpperCase()); };
function rig() {
  const doc = createFakeDocument(); doc.body = doc.createElement("body");
  const h = { doc, available: true, calls: [], reads: 0, state: { pending: false, retryId: null, error: null, receipt: null }, opens: [] };
  h.ui = createCookingPanel({ doc, client: { state: () => h.state, available: () => h.available, sync() {}, cook: id => h.calls.push(id), retryInventory: () => h.reads++ }, onOpenChange: open => h.opens.push(open) });
  h.panel = doc.body.children[0]; h.find = text => walk(h.panel).find(n => n.textContent === text); return h;
}
test("panel presents exact cost and no food-use action; close restores focus", () => {
  const h = rig(), previous = h.doc.createElement("button"); previous.focus();
  assert.equal(h.ui.openPanel(), true); assert.ok(h.find("붕어 1개 → 인경호 붕어구이 1개"));
  h.find("붕어구이 만들기").click(); assert.deepEqual(h.calls, ["recipe.carp_grill"]);
  assert.equal(walk(h.panel).some(n => n.tagName === "BUTTON" && /먹기|사용/.test(n.textContent)), false);
  h.find("닫기").click(); assert.equal(h.ui.open, false); assert.equal(h.doc.activeElement, previous);
  assert.deepEqual(h.opens, [true, false]);
});
test("pending can close/reopen without discarding request; errors explain safe same-id retry", () => {
  const h = rig(); h.ui.openPanel(); h.state = { pending: true, retryId: "request" }; h.ui.update();
  assert.equal(h.find("같은 요청 다시 확인").disabled, true);
  h.ui.close(); h.ui.openPanel(); assert.equal(h.state.retryId, "request");
  h.state.pending = false; h.state.error = "UNAVAILABLE"; h.ui.update();
  assert.equal(h.find("같은 요청 다시 확인").disabled, false);
  assert.ok(walk(h.panel).some(n => n.textContent.includes("같은 요청으로 안전하게")));
});
test("live access loss closes and releases modal input; unavailable cannot open", () => {
  const h = rig(); h.ui.openPanel(); h.available = false; h.ui.update();
  assert.equal(h.ui.open, false); assert.equal(h.ui.openPanel(), false); assert.deepEqual(h.opens, [true, false]);
});
test("Escape closes and Tab traps focus without reaching world shortcuts", () => {
  const h = rig(); h.ui.openPanel(); const close = h.find("닫기"), cook = h.find("붕어구이 만들기");
  cook.focus(); h.panel.dispatch("keydown", { key: "Tab" }); assert.equal(h.doc.activeElement, close);
  h.panel.dispatch("keydown", { key: "Tab", shiftKey: true }); assert.equal(h.doc.activeElement, cook);
  const event = h.panel.dispatch("keydown", { key: "Escape" }); assert.equal(h.ui.open, false); assert.equal(event.stopped, true);
});
test("assembled feature defaults closed and account sync does not recurse", () => {
  const doc = createFakeDocument(); doc.body = doc.createElement("body");
  const feature = createCookingFeature({ doc, getClient: () => null, getUserId: () => "a", getRoomState: () => ({ roomId: "b" }), inventory: { refresh() {} } });
  feature.update(); assert.equal(feature.handler(), false); assert.equal(feature.isAvailable({ kind: "cook" }), false);
  feature.reset(); assert.equal(feature.panel.open, false);
});
test("new owner room scope closes instead of silently reusing an open panel", () => {
  const h = rig(); h.state.accountId = "account-a"; h.state.roomId = "room-a"; h.ui.openPanel();
  h.state.accountId = "account-b"; h.state.roomId = "room-b"; h.ui.update();
  assert.equal(h.ui.open, false); assert.deepEqual(h.opens, [true, false]);
});
test("unchanged frame updates preserve DOM and focus", () => {
  const h = rig(); h.ui.openPanel(); const cook = h.find("붕어구이 만들기"); cook.focus();
  h.ui.update(); h.ui.update(); assert.equal(h.find("붕어구이 만들기"), cook); assert.equal(h.doc.activeElement, cook);
});
test('confirmed success with unconfirmed inventory keeps cooking locked and offers read-only retry', () => {
  const h = rig(); h.state = { pending: false, receipt: { status: 'SUCCESS' }, retryId: null, error: null,
    inventoryStatus: 'UNAVAILABLE', inventoryReading: false }; h.ui.openPanel();
  assert.ok(walk(h.panel).some(n => n.textContent.startsWith('붕어구이 1개를 만들었어요.') && n.textContent.includes('확인하지 못했어요')));
  assert.equal(h.find('붕어구이 만들기').disabled, true);
  h.find('보유 수량만 다시 확인').click(); assert.equal(h.reads, 1); assert.deepEqual(h.calls, []);
  h.ui.close(); h.ui.openPanel(); assert.equal(h.find('붕어구이 만들기').disabled, true);
  h.state.inventoryStatus = 'CHECKING'; h.state.inventoryReading = true; h.ui.update();
  assert.equal(h.find('보유 수량만 다시 확인').disabled, true); assert.equal(h.find('붕어구이 만들기').disabled, true);
  h.state.inventoryStatus = 'READY'; h.state.inventoryReading = false; h.ui.update();
  assert.equal(h.find('보유 수량만 다시 확인'), undefined); assert.equal(h.find('붕어구이 만들기').disabled, false);
  assert.deepEqual(h.calls, [], 'readback never automatically cooks');
});
