import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STUDENT_CENTER_SHOP_CONTEXT_PRIORITY, STUDENT_CENTER_SHOP_ENTRY, STUDENT_CENTER_SHOP_PLACE_ZONE_ID,
  createShopWorldInteraction, distance2D
} from "../src/shop/shop-world-interaction.js";
import { createShopWorldLabel, shopMarkerCopy } from "../src/shop/shop-world-label.js";
import { STUDENT_CENTER_FRONT_TERRACE_ID, studentCenterFrontPoint } from "../src/student-center-front.js";
import { STUDENT_TERRACES } from "../src/roadview-layout.js";
import { getPlaceZoneAt } from "../src/place-zone-registry.js";
import { campusStudentDestinations } from "../npc-factory/purposeful-student-destinations.mjs";
import { metersToWorld } from "../src/world-scale.js";
import { createContextActionController, selectContextAction } from "../src/context-action.js";
import { FOLLOW_CONTEXT_PRIORITY } from "../src/social/follow-controller.js";
import { ROOM_CONTEXT_PRIORITY } from "../src/rooms/room-transition.js";
import { PERSONAL_ROOM_CONTEXT_PRIORITY } from "../src/rooms/personal-room-interaction.js";
import { MECHANICAL_DUCK_CONTEXT_PRIORITY } from "../src/ambient-ducks-state.js";
import { SEAT_INTERACT_RANGE, findSeat } from "../src/seat-anchors.js";
import { createShopClient } from "../src/shop/shop-client.js";
import { createWalletClient } from "../src/wallet/wallet-client.js";

const A = STUDENT_CENTER_SHOP_ENTRY;
const ZONE = STUDENT_CENTER_SHOP_PLACE_ZONE_ID;
const at = (dx, dz = 0) => ({ x: A.x + dx, z: A.z + dz });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// biryong-system.js imports the renderer; read its priority constant from source instead.
const BIRYONG_CONTEXT_PRIORITY = (() => {
  const m = source("../src/biryong/biryong-system.js").match(/BIRYONG_CONTEXT_PRIORITY = Object\.freeze\(\{ shout: (\d+), npc: (\d+) \}\)/);
  return { shout: Number(m[1]), npc: Number(m[2]) };
})();

function harness({ available = true } = {}) {
  let opens = 0;
  const state = { available };
  const world = createShopWorldInteraction({ getAvailable: () => state.available, openPanel: () => { opens += 1; return true; } });
  return { world, state, opens: () => opens };
}

test("anchor: 학생회관 앞 is derived from the runtime Student Center terrace, the same point as poi.student-center", () => {
  const terrace = STUDENT_TERRACES.find((item) => item.id === STUDENT_CENTER_FRONT_TERRACE_ID);
  const expected = terrace.frame.at(0.5, terrace.landing + 3);
  assert.deepEqual(studentCenterFrontPoint(), { x: expected.x, z: expected.z });
  assert.deepEqual({ x: A.x, z: A.z }, { x: expected.x, z: expected.z });
  assert.deepEqual(campusStudentDestinations()["poi.student-center"].position, { x: A.x, z: A.z },
    "the NPC destination and the shop entry share one anchor");
  assert.equal(getPlaceZoneAt(A)?.id, ZONE, "the anchor lies in the 인경호·학생회관 Place Zone");
  assert.equal(A.shopId, "shop.student_center");
  assert.throws(() => studentCenterFrontPoint([]), /terrace unavailable/);
  // No magic coordinates and no GIS evidence geometry as authority.
  for (const path of ["../src/shop/shop-world-interaction.js", "../src/student-center-front.js"]) {
    const text = source(path);
    assert.doesNotMatch(text, /\b1[34]\d\.\d+|\bx:\s*-?\d{2,}|\bz:\s*-?\d{2,}/, `${path}: no hard-coded campus coordinate`);
    assert.doesNotMatch(text, /reality-adapter|getCanonicalLandmark|bldg_07/, `${path}: no GIS evidence authority`);
  }
});

test("radius: 3.5 m via metersToWorld, clear of the tree-bench prompt at the anchor itself", () => {
  assert.equal(A.interactionRadius, metersToWorld(3.5));
  assert.equal(A.interactionRadius, 1.75);
  assert.equal(findSeat({ x: A.x, y: 0, z: A.z }), null, "standing on the anchor offers no seat, so the shop shows");
  assert.ok(SEAT_INTERACT_RANGE < A.interactionRadius);
});

test("far away → no action; inside the radius → 🛍 학생회관 상점 (F)", () => {
  const { world } = harness();
  assert.equal(world.observe(at(A.interactionRadius + 0.01), { placeZoneId: ZONE }), null);
  assert.equal(world.nearby, false);
  assert.equal(world.observe(at(10, 10), { placeZoneId: ZONE }), null);
  const action = world.observe(at(0, A.interactionRadius - 0.01), { placeZoneId: ZONE });
  assert.equal(action.id, "student-center-shop");
  assert.equal(action.icon, "🛍");
  assert.equal(action.label, "학생회관 상점");
  assert.equal(action.shortcut, "F");
  assert.equal(action.disabled, false);
  assert.equal(action.priority, STUDENT_CENTER_SHOP_CONTEXT_PRIORITY);
  assert.ok(Math.abs(action.distance - (A.interactionRadius - 0.01)) < 1e-9);
  assert.equal(world.nearby, true);
});

test("member trigger opens the existing panel once; out of range or blocked it does nothing", () => {
  const h = harness();
  const action = h.world.observe(at(0.3), { placeZoneId: ZONE });
  assert.equal(action.trigger(), true);
  assert.equal(h.opens(), 1);
  h.world.observe(at(5), { placeZoneId: ZONE });
  assert.equal(h.world.open(), false);
  h.world.observe(at(0.3), { placeZoneId: ZONE, blocked: true });
  assert.equal(h.world.open(), false);
  assert.equal(h.opens(), 1);
});

function fakeButton() {
  const handlers = new Map();
  const attrs = new Map();
  return {
    hidden: true, disabled: false, textContent: "", dataset: {},
    addEventListener(type, fn) { handlers.set(type, fn); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    removeAttribute(k) { attrs.delete(k); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    click() { return handlers.get("click")?.(); }
  };
}

test("PC F and the mobile #context-action button run the same slot trigger", () => {
  for (const coarsePointer of [false, true]) {
    const h = harness();
    const button = fakeButton();
    const slot = createContextActionController({ button, shortcut: "F", coarsePointer });
    slot.set("student-center-shop", h.world.observe(at(0.2), { placeZoneId: ZONE }));
    slot.refresh();
    assert.equal(button.hidden, false);
    assert.equal(button.textContent, "🛍 학생회관 상점");
    assert.equal(button.dataset.shortcut, coarsePointer ? undefined : "F", "touch never shows a keyboard hint");
    assert.equal(slot.trigger(), true, "F → interactionAction → contextActions.trigger()");
    button.click();
    assert.equal(h.opens(), 2, "both paths open the same panel");
  }
});

test("guest / signed-out: 🔒 로그인 후 상점, disabled, never opens", () => {
  const h = harness({ available: false });
  const action = h.world.observe(at(0.2), { placeZoneId: ZONE });
  assert.equal(action.icon, "🔒");
  assert.equal(action.label, "로그인 후 상점");
  assert.equal(action.disabled, true);
  assert.equal(action.trigger(), false);
  const button = fakeButton();
  const slot = createContextActionController({ button, shortcut: "F" });
  slot.set("student-center-shop", action);
  slot.refresh();
  assert.equal(button.disabled, true);
  assert.equal(slot.trigger(), false);
  button.click();
  assert.equal(h.opens(), 0);
});

test("proximity alone makes zero Shop / Wallet RPCs (guest and member)", async () => {
  for (const signedIn of [false, true]) {
    const calls = [];
    const client = { rpc: async (fn) => { calls.push(fn); return { data: null, error: { message: "X" } }; } };
    const getClient = () => (signedIn ? client : null);
    const shop = createShopClient({ getClient });
    const wallet = createWalletClient({ getClient });
    const world = createShopWorldInteraction({
      getAvailable: () => shop.accountId !== null && getClient() !== null,
      openPanel: () => { throw new Error("no open in this test"); }
    });
    if (!signedIn) { shop.setAccount(null); await wallet.setAccount(null); }
    for (let i = 0; i < 50; i += 1) world.observe(at(Math.sin(i) * 3, Math.cos(i) * 3), { placeZoneId: ZONE });
    await flush();
    assert.deepEqual(calls, [], `${signedIn ? "member" : "guest"}: walking near the shop reads nothing`);
  }
});

test("blocked (mounted, inside a room, shop open, lobby) → no action", () => {
  const { world } = harness();
  assert.equal(world.observe(at(0.1), { placeZoneId: ZONE, blocked: true }), null);
  assert.equal(world.nearby, false);
  assert.equal(world.blocked, true);
  const main = source("../src/main.js");
  assert.match(main,
    /shopWorld\.observe\(pos, \{\s*blocked: inside \|\| controller\.mounted \|\| shopPanel\.open \|\| lobbyWorld\.active \|\| lobbyTransition\.active,\s*placeZoneId: place\?\.id \?\? null\s*\}\)/,
    "main.js blocks the entry inside rooms, while mounted, while the shop is open and in the lobby");
  assert.match(main, /lobbyTransition\.active\) \{\s*inkyungLivingMoment\?\.setSuppressed\(true\);\s*guestbookWorldLabel\.hide\(\);\s*shopWorldLabel\.hide\(\);\s*contextActions\.set\("student-center-shop", null\);/,
    "the lobby suppresses the living guide and still clears the shop entry action and label");
});

test("another Place Zone (or no zone, e.g. inside a room) → no action even at the same point", () => {
  const { world } = harness();
  assert.equal(world.observe(at(0.1), { placeZoneId: "AREA_MAIN_GATE" }), null);
  assert.equal(world.observe(at(0.1), { placeZoneId: null }), null);
  assert.ok(world.observe(at(0.1), { placeZoneId: ZONE }));
});

test("priority 190: never hides NPC talk, events, seats, guestbook, Biryong, ducks or Follow stop; wins over doors", () => {
  const shop = harness().world.observe(at(0.1), { placeZoneId: ZONE });
  const others = {
    "mcm-minigame": 310, "mcm-event-npc": 305, "npc-talk": 300, seated: 280, seat: 260, guestbook: 255,
    "biryong-npc": BIRYONG_CONTEXT_PRIORITY.npc, "biryong-shout": BIRYONG_CONTEXT_PRIORITY.shout,
    "mechanical-duck": MECHANICAL_DUCK_CONTEXT_PRIORITY, follow: FOLLOW_CONTEXT_PRIORITY
  };
  for (const [id, priority] of Object.entries(others)) {
    // Even when the other action is farther away than the shop anchor.
    assert.equal(selectContextAction([shop, { id, priority, distance: 50 }]).id, id, `${id} (${priority}) stays on top`);
  }
  for (const [id, priority] of [["room-door", ROOM_CONTEXT_PRIORITY], ["personal-room-door", PERSONAL_ROOM_CONTEXT_PRIORITY], ["mcm-minigame-info", 140]]) {
    assert.equal(selectContextAction([shop, { id, priority, distance: 0 }]).id, "student-center-shop", `shop above ${id}`);
  }
  assert.equal(STUDENT_CENTER_SHOP_CONTEXT_PRIORITY, 190);
  assert.ok(STUDENT_CENTER_SHOP_CONTEXT_PRIORITY < FOLLOW_CONTEXT_PRIORITY && STUDENT_CENTER_SHOP_CONTEXT_PRIORITY > ROOM_CONTEXT_PRIORITY);
});

test("menu entry kept; both entries open the one existing shop panel", () => {
  const main = source("../src/main.js");
  const html = source("../campus/index.html");
  assert.match(html, /id="open-shop"[^>]*>🛍 상점</, "☰ → 🛍 상점 stays");
  assert.equal((main.match(/createShopPanel\(/g) ?? []).length, 1, "one panel");
  assert.equal((main.match(/createShopClient\(/g) ?? []).length, 1, "one shop client");
  assert.match(main, /shopButton\?\.addEventListener\("click", \(\) => shopPanel\.setOpen\(true\)\)/);
  assert.match(main, /createShopWorldInteraction\(\{\s*getAvailable: shopWorldAvailable,\s*openPanel: \(\) => shopPanel\.setOpen\(true\)\s*\}\)/);
  assert.match(main, /contextActions\.set\("student-center-shop", shopWorldAction\)/);
  const world = source("../src/shop/shop-world-interaction.js");
  assert.doesNotMatch(world, /\.rpc\(|createClient|document\.|localStorage|addEventListener/, "no RPC, DOM or key handling in the interaction");
});

test("marker copy: F hint only for keyboard pointers; locked for guests", () => {
  assert.deepEqual({ ...shopMarkerCopy({ available: true }) }, { icon: "🛍", title: "학생회관 상점", hint: "굿즈를 둘러보세요" });
  assert.equal(shopMarkerCopy({ available: true, nearby: true }).hint, "F · 상점 열기");
  assert.doesNotMatch(shopMarkerCopy({ available: true, nearby: true, coarsePointer: true }).hint, /F/);
  assert.deepEqual({ ...shopMarkerCopy({ available: false, nearby: true }) }, { icon: "🔒", title: "학생회관 상점", hint: "로그인 후 이용" });
});

test("marker: projects when visible and in range, hides otherwise", () => {
  const nodes = { icon: { textContent: "" }, title: { textContent: "" }, hint: { textContent: "" } };
  const classes = new Set();
  const element = {
    hidden: true, dataset: {}, style: {},
    classList: { remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    querySelector: (sel) => (sel.includes("icon") ? nodes.icon : sel.includes("title") ? nodes.title : nodes.hint)
  };
  let cameraPos = { x: 0, y: 2, z: 5 };
  const camera = { getPosition: () => cameraPos, camera: { worldToScreen: () => ({ x: 100, y: 80, z: 1 }) } };
  const canvas = { clientWidth: 360, clientHeight: 740, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const label = createShopWorldLabel({ element, camera, canvas, getWorldPosition: () => ({ x: 0, y: 2, z: 0 }), coarsePointer: false });
  assert.equal(label.update({ visible: true, nearby: true, available: true }), true);
  assert.equal(element.hidden, false);
  assert.equal(nodes.hint.textContent, "F · 상점 열기");
  assert.equal(element.dataset.state, "near");
  assert.ok(classes.has("is-near"));
  assert.equal(label.update({ visible: false }), false);
  assert.equal(element.hidden, true);
  cameraPos = { x: 0, y: 2, z: 500 };
  assert.equal(label.update({ visible: true, available: true }), false, "too far away");
  assert.throws(() => createShopWorldLabel({}), /dependencies required/);
});

test("distance2D", () => {
  assert.equal(distance2D({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
  assert.equal(distance2D(null, { x: 0, z: 0 }), Number.POSITIVE_INFINITY);
});
