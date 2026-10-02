// Social S1-B2 · Local chat.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { ActionType, CHAT_MAX_LENGTH, encodeAction, normalizeChatText, validateAction } from "../src/network/protocol.js";
import {
  CHAT_BUBBLE_MS, CHAT_FEED_LIMIT, CHAT_RATE_LIMIT_COUNT, CHAT_RATE_LIMIT_WINDOW_MS, CHAT_REPEAT_WINDOW_MS,
  ChatComposer, ChatFeed, LOCAL_CHAT_RADIUS_M, METERS_PER_WORLD_UNIT, withinChatRadius
} from "../src/online/local-chat.js";
import {
  CHAT_FEED_EXPANDED, CHAT_FEED_VISIBLE, CHAT_PREVIEW_MS, createChatPanel
} from "../src/online/chat-panel.js";
import { createEmoteMenu } from "../src/online/emote-menu.js";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";
import { FakeElement, createFakeDocument } from "./support/fake-dom.mjs";

const HALL = { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z };
const HALL_FAR = { x: 38.5, z: -23.5 }; // still AREA_MAIN_HALL, ~43 m from HALL
const AGORA = FACILITIES.find((f) => f.id === "fac_agora_courtyard").center;
const clockAt = (t = 0) => ({ t, now() { return this.t; } });
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Source without comments, so documentation about what is avoided does not count as use.
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("1–5. message normalization: Korean, emoji, whitespace, length, control characters", () => {
  assert.deepEqual(normalizeChatText("  안녕하세요!  "), { ok: true, text: "안녕하세요!" });
  assert.deepEqual(normalizeChatText("반가워 👋 👨‍👩‍👧"), { ok: true, text: "반가워 👋 👨‍👩‍👧" }, "emoji and ZWJ sequences survive");
  for (const blank of ["", "   ", "\n\t ", "　", "​​"]) assert.equal(normalizeChatText(blank).ok, false, JSON.stringify(blank));
  assert.equal(normalizeChatText("가".repeat(CHAT_MAX_LENGTH)).ok, true);
  assert.equal(normalizeChatText("가".repeat(CHAT_MAX_LENGTH + 1)).reason, "too_long");
  assert.equal(normalizeChatText("👋".repeat(CHAT_MAX_LENGTH)).ok, true, "limit counts code points, not UTF-16 units");
  assert.equal(CHAT_MAX_LENGTH, 120);
  assert.deepEqual(normalizeChatText("a\u0000b\u0007c‮d⁦e\nf   g"), { ok: true, text: "abcde f g" });
  assert.equal(normalizeChatText(null).reason, "malformed");
  // Wire: only normalized text and finite coordinates, nothing else.
  const ok = validateAction(encodeAction(3, ActionType.CHAT, { text: "안녕!", x: 1, y: 1.15, z: 2 }));
  assert.deepEqual(ok.action.payload, { text: "안녕!", x: 1, y: 1.15, z: 2 });
  for (const payload of [{ text: " 안녕", x: 0, y: 0, z: 0 }, { text: "", x: 0, y: 0, z: 0 }, { text: "hi", x: NaN, y: 0, z: 0 }, { text: "x".repeat(121), x: 0, y: 0, z: 0 }]) {
    assert.equal(validateAction({ v: 1, id: 1, type: "chat", payload }).ok, false, JSON.stringify(payload).slice(0, 40));
  }
});

test("11–12. proximity: inclusive 15 m radius in world space (1 unit = 2 m)", () => {
  assert.equal(LOCAL_CHAT_RADIUS_M, 15);
  assert.equal(METERS_PER_WORLD_UNIT, 2);
  const me = { x: 0, y: 1.15, z: 0 };
  const at = (m) => ({ x: m / METERS_PER_WORLD_UNIT, y: 1.15, z: 0 });
  assert.equal(withinChatRadius(me, at(14.9)), true, "14.9 m visible");
  assert.equal(withinChatRadius(me, at(15.0)), true, "15.0 m visible (<= radius)");
  assert.equal(withinChatRadius(me, at(15.1)), false, "15.1 m hidden");
  assert.equal(withinChatRadius(me, { x: 0, y: 1.15 + 7.6, z: 0 }), false, "height counts too");
});

function feedWith(clock) {
  const feed = new ChatFeed({ clock });
  feed.setPlaceZone("AREA_MAIN_HALL");
  const alice = { sessionId: "s-a", userId: "u-a", displayName: "앨리스", placeZoneId: "AREA_MAIN_HALL" };
  const near = { x: 0, y: 1.15, z: 0 };
  return { feed, alice, near };
}

test("13–18. feed and bubbles: create, expire, replace, leave and zone change clear", () => {
  const clock = clockAt(1000);
  const { feed, alice, near } = feedWith(clock);
  assert.equal(feed.receive({ sender: alice, placeZoneId: "AREA_MAIN_HALL", text: "안녕!", position: near, receiverPosition: near }), "shown");
  assert.deepEqual(feed.entries.map((e) => [e.name, e.text]), [["앨리스", "안녕!"]]);
  assert.equal(feed.bubbleFor("s-a"), "안녕!");
  clock.t += 1000;
  feed.receive({ sender: alice, placeZoneId: "AREA_MAIN_HALL", text: "또 봐", position: near, receiverPosition: near });
  assert.equal(feed.bubbleFor("s-a"), "또 봐", "newer message replaces the bubble");
  assert.equal(feed.bubbles.size, 1, "one bubble per player");
  clock.t += CHAT_BUBBLE_MS - 1;
  assert.equal(feed.bubbleFor("s-a"), "또 봐");
  clock.t += 1;
  assert.equal(feed.bubbleFor("s-a"), null, "bubble expires after 4 s");
  feed.receive({ sender: alice, placeZoneId: "AREA_MAIN_HALL", text: "잘 가", position: near, receiverPosition: near });
  feed.forget("s-a");
  assert.equal(feed.bubbleFor("s-a"), null, "player leave clears the bubble");
  feed.setPlaceZone("AREA_AGORA_6_9");
  assert.deepEqual(feed.entries, [], "zone change clears the old-zone feed");
  assert.equal(feed.receive({ sender: alice, placeZoneId: "AREA_MAIN_HALL", text: "늦은 메시지", position: near, receiverPosition: near }), "other_zone");
  assert.equal(feed.receive({ sender: null, placeZoneId: "AREA_AGORA_6_9", text: "?", position: near, receiverPosition: near }), "unknown_sender");
  const far = { x: 20, y: 1.15, z: 0 };
  assert.equal(feed.receive({ sender: { ...alice, placeZoneId: "AREA_AGORA_6_9" }, placeZoneId: "AREA_AGORA_6_9", text: "멀리", position: far, receiverPosition: near }), "out_of_range");
  assert.equal(feed.entries.length, 0, "out-of-range messages never reach the feed");
  for (let i = 0; i < CHAT_FEED_LIMIT + 10; i += 1) feed.addOwn({ sessionId: "me", name: "나", text: `m${i}` });
  assert.equal(feed.entries.length, CHAT_FEED_LIMIT, "in-memory feed is capped");
});

test("19–22. rate limit 3 / 5 s and repeated-message suppression", () => {
  const clock = clockAt(0);
  const sent = [];
  const composer = new ChatComposer({ clock, send: (t) => { sent.push(t); return true; } });
  for (const text of ["하나", "둘", "셋"]) assert.equal(composer.submit(text).result, "sent");
  assert.equal(composer.submit("넷").result, "rate_limited", "4th within 5 s is not broadcast");
  assert.equal(sent.length, CHAT_RATE_LIMIT_COUNT);
  clock.t += CHAT_RATE_LIMIT_WINDOW_MS;
  assert.equal(composer.submit("넷").result, "sent", "window expiry restores sending");

  const c2 = new ChatComposer({ clock: clockAt(0), send: () => true });
  assert.equal(c2.submit("안녕").result, "sent");
  c2.clock.t += 2000;
  assert.equal(c2.submit(" 안녕 ").result, "sent", "one repeat is fine");
  c2.clock.t += 2000;
  assert.equal(c2.submit("안녕").result, "repeated", "third identical message within 10 s is suppressed");
  assert.equal(c2.submit("응 안녕").result, "sent", "other replies still work");
  c2.clock.t += CHAT_REPEAT_WINDOW_MS;
  assert.equal(c2.submit("안녕").result, "sent");
  assert.equal(new ChatComposer({ clock: clockAt(), send: () => true, moderation: { check: () => ({ ok: false }), isBlocked: () => false } }).submit("x").result, "moderated", "moderation hook is honoured");
});

async function hallPair() {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", nickname: "앨리스", at: HALL });
  const b = createWorldClient(world, { label: "B", nickname: "밥", at: HALL });
  await runWorld(world, 700);
  return { world, a, b };
}
const chatWire = (world) => world.server.wire.filter((w) => w.kind === "action" && w.payload.p.type === "chat");

test("7–9, 24. members send on the AREA channel; the name shown comes from Presence/profile", async () => {
  const { world, a, b } = await hallPair();
  assert.equal(a.online.chat.submit("안녕!").result, "sent");
  await runWorld(world, 200);
  const wire = chatWire(world);
  assert.equal(wire.length, 1);
  assert.equal(wire[0].topic, "world:campus:AREA_MAIN_HALL");
  assert.deepEqual(Object.keys(wire[0].payload.p.payload).sort(), ["text", "x", "y", "z"], "no name, email or token in the packet");
  assert.deepEqual(b.online.chat.feed.entries.map((e) => [e.name, e.text]), [["앨리스", "안녕!"]]);
  assert.equal(b.online.chat.feed.bubbleFor(a.online.status().sessionId), "안녕!");
  assert.deepEqual(a.online.chat.feed.entries.map((e) => [e.name, e.text, e.self]), [["앨리스", "안녕!", true]], "own message in own feed");
  assert.equal(a.online.chat.ownBubble(), "안녕!");
  // Remote avatar receives the bubble text through the view sample.
  const avatar = b.avatars.live.get(a.online.status().sessionId);
  assert.equal(avatar.last.bubble, "안녕!");
});

test("25, 23. spoofed name fields are ignored; unknown senders dropped; duplicate packets shown once", async () => {
  const { world, a, b } = await hallPair();
  const aSid = a.online.status().sessionId;
  const channel = [...b.online.transport.channels.values()][0].channel;
  const fire = (sid, packet) => channel.fire("broadcast", "action", { payload: { sid, p: packet } });
  fire(aSid, { v: 1, id: 50, type: "chat", payload: { text: "나는 관리자", x: HALL.x, y: 1.15, z: HALL.z, displayName: "관리자", name: "관리자", nickname: "관리자" } });
  fire(aSid, { v: 1, id: 50, type: "chat", payload: { text: "나는 관리자", x: HALL.x, y: 1.15, z: HALL.z } });
  fire("ghost-session", { v: 1, id: 1, type: "chat", payload: { text: "유령", x: HALL.x, y: 1.15, z: HALL.z } });
  assert.deepEqual(b.online.chat.feed.entries.map((e) => [e.name, e.text]), [["앨리스", "나는 관리자"]],
    "Presence name wins; the duplicate and the unknown session are not shown");
  assert.equal(b.online.network.remotes.stats.actionDuplicate, 1);
});

test("10–12 live path: other zone never displays; far speaker in the same zone is filtered", async () => {
  const { world, a, b } = await hallPair();
  b.local.teleportTo(AGORA);
  await runWorld(world, 900);
  assert.equal(b.online.status().placeZone, "AREA_AGORA_6_9");
  a.online.chat.submit("본관에서 안녕");
  await runWorld(world, 200);
  assert.equal(b.online.chat.feed.entries.length, 0, "no cross-zone chat");
  b.local.teleportTo(HALL_FAR);
  await runWorld(world, 900);
  assert.equal(b.online.status().placeZone, "AREA_MAIN_HALL");
  world.scheduler.advance(CHAT_REPEAT_WINDOW_MS);
  a.online.chat.submit("멀리 있니?");
  await runWorld(world, 200);
  assert.equal(chatWire(world).at(-1).topic, "world:campus:AREA_MAIN_HALL", "delivered on the zone channel…");
  assert.equal(b.online.chat.feed.entries.length, 0, "…but not presented beyond 15 m");
  assert.equal(b.online.chat.feed.stats.outOfRange, 1);
});

test("8. guests never broadcast chat", async () => {
  const world = createRealtimeWorld();
  const guest = createWorldClient(world, { label: "G", user: null, at: HALL });
  const anon = createWorldClient(world, { label: "N", user: { id: "anon-9", is_anonymous: true }, at: HALL });
  await runWorld(world, 600);
  assert.equal(guest.online.chat.submit("안녕").result, "signed_out");
  assert.equal(anon.online.chat.submit("안녕").result, "signed_out");
  assert.equal(guest.online.chat.signedIn, false);
  await runWorld(world, 200);
  assert.equal(chatWire(world).length, 0);
});

test("32–33. offline/reconnecting: sending fails gracefully, nothing is queued or replayed", async () => {
  const { world, a, b } = await hallPair();
  world.server.setOnline(false);
  await runWorld(world, 300);
  assert.equal(a.online.chat.submit("지금 보내져?").result, "offline");
  assert.ok(a.local.frames > 0);
  world.server.setOnline(true);
  await runWorld(world, 3000);
  assert.equal(a.online.status().state, "ONLINE");
  assert.equal(chatWire(world).length, 0, "the offline message was never sent later");
  assert.equal(b.online.chat.feed.entries.length, 0);
  assert.equal(a.online.chat.submit("이제 보내져").result, "sent");
  await runWorld(world, 200);
  assert.deepEqual(b.online.chat.feed.entries.map((e) => e.text), ["이제 보내져"]);
});

function createManualTimers() {
  let now = 0, nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, delay = 0) {
      const id = nextId++;
      tasks.set(id, { at: now + Number(delay || 0), fn });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    pending() { return tasks.size; }
  };
}

function panelFixture({ signedIn = true, result = "sent", win = undefined } = {}) {
  const doc = createFakeDocument();
  const el = (tag) => doc.createElement(tag);
  const toggle = el("button"), form = el("form"), input = el("input"), feedList = el("ol"), hint = el("p");
  input.value = "";
  input.closest = (sel) => (sel.includes("input") ? input : null);
  form.append(input);
  const submitted = [];
  const openChanges = [];
  let focusCalls = 0;
  const chat = { signedIn, submit: (text) => { submitted.push(text); return { result }; } };
  const panel = createChatPanel({
    toggle, form, input, feedList, hint, doc, getChat: () => chat,
    onFocusChat: () => { focusCalls += 1; },
    onOpenChange: (open) => { openChanges.push(open); },
    ...(win ? { win } : {})
  });
  return {
    doc, toggle, form, input, feedList, hint, panel, submitted,
    focusCalls: () => focusCalls,
    openChanges
  };
}

test("6. chat text is rendered with textContent only (HTML stays literal)", () => {
  const f = panelFixture();
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  f.panel.renderFeed([{ name: "<b>밥</b>", text: evil, self: false }]);
  const item = f.feedList.children[0];
  assert.equal(item.children[0].textContent, "<b>밥</b>");
  assert.equal(item.children[1].textContent, evil, "rendered verbatim as text");
  for (const file of ["../src/online/chat-panel.js", "../src/online/remote-avatar.js", "../src/online/local-chat.js", "../src/main.js"]) {
    assert.doesNotMatch(code(file), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, file);
  }
});

test("P2-A desktop preview shows 5 recent lines and expands the local log on Enter", () => {
  const timers = createManualTimers();
  const f = panelFixture({ win: timers });
  const entries = Array.from({ length: 15 }, (_, i) => ({ name: `n${i}`, text: `m${i}`, self: false }));

  f.panel.renderFeed(entries);
  assert.equal(CHAT_FEED_VISIBLE, 5);
  assert.equal(CHAT_FEED_EXPANDED, 12);
  assert.equal(f.panel.renderedCount, 5);
  assert.equal(f.feedList.getAttribute("data-mode"), "PREVIEW");
  assert.equal(f.feedList.getAttribute("data-faded"), "false");

  f.panel.setOpen(true, { focus: false });
  assert.equal(f.panel.renderedCount, 12);
  assert.equal(f.feedList.getAttribute("data-mode"), "EXPANDED");
  assert.equal(f.feedList.getAttribute("data-faded"), "false");
  assert.equal(timers.pending(), 0, "expanded chat never fades while the player is typing");

  f.panel.setOpen(false, { focus: false });
  assert.equal(f.panel.renderedCount, 5);
  assert.equal(f.feedList.getAttribute("data-mode"), "PREVIEW");
  assert.equal(timers.pending(), 1, "closing returns to the timed preview");
});

test("P2-A preview fades after 8 s, resets on a new message and stays visible while expanded", () => {
  const timers = createManualTimers();
  const f = panelFixture({ win: timers });

  f.panel.renderFeed([{ name: "앨리스", text: "안녕", self: false }]);
  assert.equal(CHAT_PREVIEW_MS, 8000);
  timers.advance(CHAT_PREVIEW_MS - 1);
  assert.equal(f.panel.previewFaded, false);
  timers.advance(1);
  assert.equal(f.panel.previewFaded, true);

  f.panel.renderFeed([
    { name: "앨리스", text: "안녕", self: false },
    { name: "밥", text: "반가워", self: false }
  ]);
  assert.equal(f.panel.previewFaded, false, "new activity revives the preview");

  f.panel.setOpen(true, { focus: false });
  timers.advance(CHAT_PREVIEW_MS * 2);
  assert.equal(f.panel.previewFaded, false, "expanded log stays readable");
});

test("P2-A desktop CSS uses a lower-left translucent preview while mobile keeps the local 15 m contract", () => {
  const css = read("../styles.css");
  const html = read("../campus/index.html");
  assert.match(css, /@media \(pointer: fine\) and \(min-width: 700px\)[\s\S]*\.chat-feed, \.chat-form, \.chat-hint[\s\S]*left:\s*max\(20px/s);
  assert.match(css, /\.chat-feed\[data-mode="PREVIEW"\]\[data-faded="true"\]\s*\{\s*opacity:\s*0;/);
  assert.match(css, /\.chat-feed\[data-mode="EXPANDED"\][\s\S]*background:\s*rgba\(8,24,38,\.88\)/);
  assert.match(html, /aria-label="근처 채팅"/);
  assert.match(html, /placeholder="근처 15m에 말하기"/);
});

test("26–30. while the chat input is focused no gameplay control fires; Esc gives them back", async () => {
  // Real PlayerController with a fake window/document.
  const { PlayerController } = await import("../src/player-controller.js");
  const listeners = {};
  globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
  // Closed profile/settings panels, so only the input guard can stop the keys.
  globalThis.document = { getElementById: (id) => (id === "profile-panel" || id === "view-settings" ? { hidden: true } : null) };
  globalThis.HTMLElement = FakeElement;
  const controller = new PlayerController({ getLocalPosition: () => ({ x: 0, y: 1.15, z: 0 }), setLocalPosition() {}, setLocalEulerAngles() {} });
  const f = panelFixture();
  const press = (code, target) => {
    const event = { code, key: code, target, repeat: false, preventDefault() {} };
    for (const fn of listeners.keydown ?? []) fn(event);
    f.doc.dispatch("keydown", event);
  };
  const emoteSelections = [];
  const emoteDoc = f.doc;
  const toggle = emoteDoc.createElement("button"), menu = emoteDoc.createElement("div");
  const emoteMenu = createEmoteMenu({ toggle, menu, doc: emoteDoc, win: { setTimeout() {} }, onSelect: (id) => { emoteSelections.push(id); return "started"; } });

  press("Enter", null);
  assert.equal(f.panel.open, true, "Enter opens chat");
  assert.equal(f.focusCalls(), 1, "held movement keys are released on open");
  const typed = ["KeyW", "KeyA", "Space", "KeyM", "KeyE", "Digit1", "Digit2", "KeyV"];
  for (const key of typed) press(key, f.input);
  assert.deepEqual(typed.filter((key) => controller.keys.has(key)), [], "no gameplay keys registered while typing");
  assert.equal(controller.mounted, false, "M does not mount");
  assert.equal(controller.jumpQueued, false, "Space does not jump");
  assert.equal(emoteMenu.open, false, "E does not open emotes");
  assert.deepEqual(emoteSelections, [], "1–5 do not play emotes");
  // V: the camera toggle ignores INPUT targets (#115 guard) and the chat field is an <input>.
  assert.match(read("../src/orbit-camera-controller.js"), /INPUT\|TEXTAREA\|SELECT/);
  assert.match(read("../campus/index.html"), /<input id="chat-input"/);

  f.input.dispatch("keydown", { code: "Escape", key: "Escape" });
  assert.equal(f.panel.open, false, "Esc closes chat");
  press("KeyW", null);
  assert.ok(controller.keys.has("KeyW"), "movement works again after closing");
  press("KeyE", null);
  assert.equal(emoteMenu.open, true, "E works again after closing");
  delete globalThis.window; delete globalThis.document; delete globalThis.HTMLElement;
});

test("chat panel open-state callback fires only on real transitions", () => {
  const f = panelFixture();
  assert.deepEqual(f.openChanges, []);

  f.panel.setOpen(true);
  f.panel.setOpen(true);
  assert.deepEqual(f.openChanges, [true], "reopening an already open panel does not duplicate ownership");

  f.panel.setOpen(false);
  f.panel.setOpen(false);
  assert.deepEqual(f.openChanges, [true, false], "closing an already closed panel does not double-release ownership");

  const guest = panelFixture({ signedIn: false });
  assert.equal(guest.panel.setOpen(true), false);
  assert.deepEqual(guest.openChanges, [], "rejected guest open never acquires input ownership");
});

test("chat panel: Enter sends, empty Enter closes, guests get a login hint", () => {
  const f = panelFixture();
  f.panel.setOpen(true);
  f.input.value = "   ";
  f.input.dispatch("keydown", { code: "Enter", key: "Enter" });
  assert.equal(f.panel.open, false, "empty Enter closes chat and hands control back");
  assert.deepEqual(f.submitted, [], "empty Enter never submits a message");
  f.panel.setOpen(true);
  f.input.value = "안녕";
  f.input.dispatch("keydown", { code: "Enter", key: "Enter", isComposing: true });
  assert.deepEqual(f.submitted, [], "IME composition Enter does not send");
  f.input.dispatch("keydown", { code: "Enter", key: "Enter" });
  assert.deepEqual(f.submitted, ["안녕"]);
  assert.equal(f.input.value, "", "input cleared after sending");
  assert.equal(f.panel.open, false, "sending hands control back to the game");
  const limited = panelFixture({ result: "rate_limited" });
  limited.panel.setOpen(true);
  limited.input.value = "하나 더";
  limited.panel.send();
  assert.equal(limited.panel.open, true, "a blocked message keeps the input open");
  assert.match(limited.hint.textContent, /5초에 3개/);
  const guest = panelFixture({ signedIn: false });
  guest.toggle.click();
  assert.equal(guest.panel.open, false);
  assert.match(guest.hint.textContent, /로그인/);
  guest.panel.refreshAvailability();
  assert.equal(guest.toggle.getAttribute("aria-disabled"), "true");
});

test("31. mobile layout: chat shares the compact social cluster above the joystick", () => {
  const css = read("../styles.css");
  const html = read("../campus/index.html");
  assert.match(html, /class="social-cluster"[\s\S]*id="emote-toggle"[\s\S]*id="chat-toggle"/);
  assert.match(css, /\.social-cluster\s*\{[^}]*bottom:\s*max\(154px/s, "cluster sits above the normal joystick");
  assert.doesNotMatch(css, /joystick-large/, "one fixed joystick size: no large-joystick cluster rule");
  assert.match(css, /body\.joystick-right \.social-cluster/, "left-handed layout mirrors the cluster");
  assert.match(css, /\.social-cluster #chat-toggle \{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;/);
  assert.match(css, /--keyboard-inset/, "chat input still lifts above the on-screen keyboard");
});

test("34. chat is ephemeral: no storage, no table, no archive", () => {
  for (const file of ["../src/online/local-chat.js", "../src/online/chat-panel.js", "../src/online/world-online.js"]) {
    assert.doesNotMatch(code(file), /localStorage|sessionStorage|indexedDB|from\("chat|chat_messages|chat_history/, file);
  }
  // main.js may use browser storage for unrelated features (for example a Hub message-draft handoff);
  // chat wiring itself must never read or write browser persistence.
  const main = code("../src/main.js");
  assert.doesNotMatch(main, /(?:chat|Chat)[^\n]*(?:localStorage|sessionStorage|indexedDB)|(?:localStorage|sessionStorage|indexedDB)[^\n]*(?:chat|Chat)/,
    "chat wiring has no persistence calls");
  const migrations = readdirSync(new URL("../../../supabase/migrations/", import.meta.url));
  assert.ok(!migrations.some((m) => /chat/i.test(m)), "no chat migration");
});
