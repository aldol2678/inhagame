// Social S1-B1 · Expression / Emotes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { ActionType, EMOTE_IDS, encodeAction, validateAction } from "../src/network/protocol.js";
import { EMOTES, EMOTE_COOLDOWN_MS, EmoteController, REST_OFFSETS, composeEmotePose, emoteIsActive, emoteOffsets } from "../src/online/emotes.js";
import { createEmoteMenu } from "../src/online/emote-menu.js";
import { RemotePlayerView } from "../src/online/remote-player-view.js";
import { AGORA, MAIN_HALL, createClient, createWorld, run } from "./support/online-harness.mjs";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";
import { createFakeDocument } from "./support/fake-dom.mjs";

const FINAL_IDS = ["wave", "clap", "laugh", "dance", "photo_pose"];
const clockAt = (t = 0) => ({ t, now() { return this.t; } });
const idle = { moving: false, grounded: true, mounted: false };

test("1–2. exactly the five stable emote IDs are accepted on the wire", () => {
  assert.deepEqual([...EMOTE_IDS], FINAL_IDS);
  assert.deepEqual(Object.keys(EMOTES), FINAL_IDS);
  for (const id of FINAL_IDS) assert.ok(validateAction(encodeAction(1, ActionType.EMOTE, { emote: id })).ok, id);
  for (const bad of ["bow", "sit", "WAVE", "", "wave ", "dance2", "<script>", null, 7]) {
    assert.equal(validateAction(encodeAction(1, ActionType.EMOTE, { emote: bad })).ok, false, String(bad));
  }
  const extra = validateAction({ v: 1, id: 2, type: "emote", payload: { emote: "wave", x: 1, email: "a@b.c" } });
  assert.deepEqual(extra.action.payload, { emote: "wave" }, "payload carries only the emote ID");
  assert.equal(new EmoteController({ clock: clockAt() }).request("bow", idle), "invalid");
});

test("3–4. a local emote starts at once and ends after its duration", () => {
  const clock = clockAt(1000);
  const events = [];
  const emotes = new EmoteController({ clock });
  emotes.onChange((e) => events.push(`${e.type}:${e.id}${e.reason ? `:${e.reason}` : ""}`));
  assert.equal(emotes.request("wave", idle), "started");
  assert.deepEqual(emotes.update(idle), { id: "wave", elapsedMs: 0 });
  clock.t += EMOTES.wave.durationMs - 1;
  assert.equal(emotes.update(idle).id, "wave");
  clock.t += 1;
  assert.equal(emotes.update(idle), null);
  assert.deepEqual(events, ["start:wave", "end:wave:finished"]);
});

test("5, 7. movement cancels any emote, including a looping dance, and blocks starting one", () => {
  for (const id of FINAL_IDS) {
    const clock = clockAt();
    const emotes = new EmoteController({ clock });
    emotes.request(id, idle);
    clock.t += 200;
    assert.equal(emotes.update({ ...idle, moving: true }), null, `${id} cancelled by movement`);
    assert.equal(emotes.active, null);
  }
  const clock = clockAt();
  const dance = new EmoteController({ clock });
  dance.request("dance", idle);
  clock.t += 5000;
  assert.equal(dance.update(idle).id, "dance", "dance keeps looping while standing");
  clock.t += EMOTES.dance.durationMs;
  assert.equal(dance.update(idle), null, "dance is capped so it can never stick");
  assert.equal(new EmoteController({ clock: clockAt() }).request("wave", { ...idle, moving: true }), "busy");
  assert.equal(new EmoteController({ clock: clockAt() }).request("wave", { ...idle, mounted: true }), "busy");
});

test("6, 8. a jump ends dance and photo pose; short gestures may continue; mount ends all", () => {
  for (const [id, survives] of [["dance", false], ["photo_pose", false], ["wave", true], ["clap", true], ["laugh", true]]) {
    const clock = clockAt();
    const emotes = new EmoteController({ clock });
    emotes.request(id, idle);
    clock.t += 100;
    assert.equal(!!emotes.update({ ...idle, grounded: false }), survives, id);
  }
  const clock = clockAt();
  const photo = new EmoteController({ clock });
  photo.request("photo_pose", idle);
  clock.t += 1000;
  assert.equal(photo.cancel("ui"), true);
  assert.equal(photo.update(idle), null, "explicit cancel");
  const mounted = new EmoteController({ clock });
  clock.t += 5000;
  mounted.request("wave", idle);
  assert.equal(mounted.update({ ...idle, mounted: true }), null);
});

test("9. the character returns exactly to its rest pose; emotes are visually distinct", () => {
  const base = { bodyY: 0.017, bodyEuler: [0, 0, 0], wings: [[0, 0, 22], [0, 0, -22]], legs: [11, -11] };
  assert.deepEqual(composeEmotePose(base, REST_OFFSETS), base);
  const signatures = new Set();
  for (const id of FINAL_IDS) {
    const d = EMOTES[id].durationMs;
    assert.deepEqual(composeEmotePose(base, emoteOffsets(id, d)), base, `${id} rest after end`);
    assert.deepEqual(composeEmotePose(base, emoteOffsets(id, -1)), base, `${id} rest before start`);
    assert.deepEqual(composeEmotePose(base, emoteOffsets(id, 0)), base, `${id} blends in from rest`);
    const mid = composeEmotePose(base, emoteOffsets(id, Math.min(700, d / 2)));
    assert.notDeepEqual(mid, base, `${id} changes the pose`);
    signatures.add(JSON.stringify(mid));
  }
  assert.equal(signatures.size, 5, "five different poses");
  // Pure: the same elapsed time yields the same pose on every client.
  assert.deepEqual(emoteOffsets("dance", 1234), emoteOffsets("dance", 1234));
});

function pair() {
  const world = createWorld({ latencyMs: 40 });
  const a = createClient(world, { label: "A" });
  const b = createClient(world, { label: "B" });
  for (const c of [a, b]) { c.net.setPlaceZone(MAIN_HALL); c.net.start(); }
  return { world, a, b };
}

test("10, 12, 13. one request → one EMOTE action → the remote plays it exactly once", () => {
  const { world, a, b } = pair();
  run(world, 500);
  const clock = world.scheduler;
  const emotes = new EmoteController({ clock, send: (id) => a.net.reportEmote(id) });
  assert.equal(emotes.request("clap", idle), "started");
  assert.equal(emotes.request("wave", idle), "cooldown", "second tap inside the cooldown");
  run(world, 100);
  assert.equal(a.net.sent.action, 1);
  assert.equal(world.hub.metrics.action.sent, 1);
  const packet = world.hub.wire.find((w) => w.kind === "action").payload.p;
  assert.deepEqual(packet, { v: 1, id: 0, type: "emote", payload: { emote: "clap" } }, "no pose, profile or token in the action");
  const remote = () => b.net.sampleRemotes().find((r) => r.sessionId === "sess-a");
  assert.equal(remote().emote.id, "clap");
  const startedAt = b.net.remotes.get("sess-a").lastEmote.at;
  // The same packet delivered again must not restart the animation.
  world.hub.inject("action", "B", { placeZoneId: MAIN_HALL, sessionId: "sess-a", packet });
  run(world, 50);
  assert.equal(b.net.remotes.get("sess-a").lastEmote.at, startedAt);
  assert.equal(b.net.remotes.stats.actionDuplicate, 1);
  // Cooldown elapses → next emote goes out.
  run(world, EMOTE_COOLDOWN_MS);
  assert.equal(emotes.request("dance", idle), "started");
  run(world, 100);
  assert.equal(remote().emote.id, "dance");
  assert.equal(a.net.sent.action, 2);
});

test("remote emote stops when that player moves, or jumps during a dance", () => {
  const { world, a, b } = pair();
  run(world, 500);
  a.net.reportEmote("dance");
  run(world, 300);
  const remote = () => b.net.sampleRemotes().find((r) => r.sessionId === "sess-a");
  assert.ok(emoteIsActive(remote().emote));
  a.sim.input = { speed: 7, heading: 0, turnRate: 0 };
  run(world, 600);
  assert.equal(remote().emote.moved, true);
  assert.equal(emoteIsActive(remote().emote), false, "dance cancels and walking resumes");
  assert.equal(remote().anim, "walk");
});

test("14–16. zone leave, disconnect and reconnect clean remote emotes; no replay", () => {
  const { world, a, b } = pair();
  run(world, 500);
  const avatars = [];
  const view = new RemotePlayerView({ localSessionId: "sess-b", createAvatar: (s) => {
    const avatar = { emotes: [], update(sample) { if (sample.emote) avatar.emotes.push(sample.emote.id); }, destroy() { avatar.destroyed = true; } };
    avatars.push(avatar);
    return avatar;
  } });
  a.net.reportEmote("photo_pose");
  run(world, 200, { onFrame: (c) => { if (c === b) view.sync(b.net.sampleRemotes(), 1 / 60); } });
  assert.ok(avatars[0].emotes.includes("photo_pose"));
  // A walks away into another place zone: B drops A and its emote.
  a.net.setPlaceZone(AGORA);
  run(world, 300, { onFrame: (c) => { if (c === b) view.sync(b.net.sampleRemotes(), 1 / 60); } });
  assert.equal(avatars[0].destroyed, true);
  assert.equal(b.net.remotes.size, 0);
  // Back in the same zone: a new avatar without the old emote.
  a.net.setPlaceZone(MAIN_HALL);
  run(world, 400, { onFrame: (c) => { if (c === b) view.sync(b.net.sampleRemotes(), 1 / 60); } });
  assert.equal(b.net.sampleRemotes()[0].emote, null, "returning player has no stale emote");
  // Disconnect / reconnect: the old emote is never replayed.
  a.net.reportEmote("laugh");
  run(world, 100);
  world.hub.dropClient("A");
  run(world, 300);
  assert.equal(b.net.remotes.size, 0, "disconnect removes the remote and its emote");
  world.hub.restoreClient("A");
  run(world, 2500);
  assert.equal(b.net.remotes.size, 1);
  assert.equal(b.net.sampleRemotes()[0].emote, null, "reconnect does not replay");
});

test("11. guests keep local emotes but never broadcast; members do", async () => {
  const world = createRealtimeWorld();
  const guest = createWorldClient(world, { label: "G", user: null, at: { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z } });
  const member = createWorldClient(world, { label: "M", at: { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z } });
  const anonymous = createWorldClient(world, { label: "N", user: { id: "anon-7", is_anonymous: true }, at: { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z } });
  await runWorld(world, 600);
  assert.equal(anonymous.online.reportEmote("clap"), false, "anonymous accounts are guests too");
  const local = new EmoteController({ clock: world.scheduler, send: (id) => guest.online.reportEmote(id) });
  assert.equal(local.request("wave", idle), "started", "guest avatar still waves");
  assert.equal(local.stats.sent, 0);
  assert.equal(guest.online.reportEmote("wave"), false);
  assert.equal(guest.online.identity, null, "no network identity for guests");
  await runWorld(world, 200);
  assert.equal(world.server.wire.filter((w) => w.kind === "action").length, 0, "no guest traffic");
  assert.equal(member.online.reportEmote("wave"), true);
  await runWorld(world, 200);
  const actions = world.server.wire.filter((w) => w.kind === "action");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].topic, "world:campus:AREA_MAIN_HALL");
  assert.deepEqual(actions[0].payload.p.payload, { emote: "wave" });
});

function menuFixture(shouldIgnoreShortcut = () => false) {
  const doc = createFakeDocument();
  const toggle = doc.createElement("button");
  const menu = doc.createElement("div");
  const status = doc.createElement("p");
  const selected = [];
  let result = "started";
  const ui = createEmoteMenu({ toggle, menu, status, doc, win: { setTimeout: () => {} }, shouldIgnoreShortcut,
    onSelect: (id) => { selected.push(id); return result; } });
  return { doc, toggle, menu, status, selected, ui, setResult: (r) => { result = r; } };
}

test("a World block (open NPC dialogue, map, help) keeps E from toggling the emote menu", () => {
  let nearNpc = false;
  const f = menuFixture(() => nearNpc);
  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(f.ui.open, true, "unblocked, E opens emotes");
  nearNpc = true;
  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(f.ui.open, false, "blocked, E closes an existing emote menu");
  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(f.ui.open, false, "blocked, E never reopens emotes");
  nearNpc = false;
  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(f.ui.open, true, "unblocked again, E is emotion");
});

test("17–18. menu opens and closes; each of the five buttons maps to its ID", () => {
  const f = menuFixture();
  assert.equal(f.menu.hidden, true);
  assert.equal(f.toggle.getAttribute("aria-expanded"), "false");
  f.toggle.click();
  assert.equal(f.ui.open, true);
  assert.equal(f.toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(f.menu.children.map((b) => b.dataset.emote), FINAL_IDS);
  assert.deepEqual(f.menu.children.map((b) => b.children[1].textContent), ["인사", "박수", "웃기", "춤", "사진 포즈"]);
  assert.ok(f.menu.children.every((b) => b.getAttribute("aria-label") && b.type === "button"));
  for (const button of f.menu.children) { f.ui.setOpen(true); button.click(); }
  assert.deepEqual(f.selected, FINAL_IDS);
  assert.equal(f.ui.open, false, "a started emote closes the menu");

  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(f.ui.open, true, "E opens");
  f.doc.dispatch("keydown", { code: "Digit4", target: null });
  assert.equal(f.selected.at(-1), "dance", "4 = dance");
  f.doc.dispatch("keydown", { code: "KeyE", target: null });
  f.doc.dispatch("keydown", { code: "Escape", target: null });
  assert.equal(f.ui.open, false, "Esc closes");
  f.ui.setOpen(true);
  f.doc.dispatch("pointerdown", { target: f.doc.createElement("canvas") });
  assert.equal(f.ui.open, false, "outside pointer closes");
  const before = f.selected.length;
  f.doc.dispatch("keydown", { code: "Digit1", target: null });
  assert.equal(f.selected.length, before, "digits do nothing while closed");
  f.ui.setOpen(true);
  f.doc.dispatch("keydown", { code: "Digit1", target: { closest: () => ({}) } });
  assert.equal(f.selected.length, before, "typing in a field never triggers emotes");
  f.setResult("cooldown");
  f.menu.children[0].click();
  assert.equal(f.ui.open, true, "blocked emote keeps the menu open");
  assert.ok(f.menu.children[0].classList.contains("emote-blocked"));
  assert.match(f.status.textContent, /잠시 후/);
  f.ui.setAvailable(false);
  assert.equal(f.toggle.hidden, true);
  assert.equal(f.ui.open, false);
});

test("19. emote control lives in the compact social cluster", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../campus/index.html", import.meta.url), "utf8");
  assert.match(html, /class="social-cluster"/);
  assert.match(css, /\.social-cluster\s*\{/);
  assert.match(css, /\.social-cluster #emote-toggle,/);
  assert.match(css, /width:\s*48px;\s*height:\s*48px/, "compact social buttons remain touch sized");
  assert.match(css, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?\.social-cluster #nearby-toggle,[\s\S]*?width:\s*44px;\s*height:\s*44px;/s,
    "narrow phones use the 44px minimum touch target instead of the wider 48px row");
  assert.match(css, /body\.joystick-right \.social-cluster/, "cluster mirrors with left-handed controls");
  assert.match(css, /\.emote-option \{[^}]*width:\s*52px;\s*height:\s*58px/s, "emote options remain touch targets");
});

test("20. nickname: INHAGAME profile is the only authority; no World editing or local override", () => {
  const html = readFileSync(new URL("../campus/index.html", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../src/campus-profile.js", import.meta.url), "utf8");
  const online = readFileSync(new URL("../src/online/world-online.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /nickname-form|nickname-input/, "no nickname edit control in the World");
  const panel = html.slice(html.indexOf('id="profile-panel"'), html.indexOf("</section>", html.indexOf('id="profile-panel"')));
  assert.doesNotMatch(panel, /<input|<form/, "profile panel is display-only");
  assert.deepEqual(
    [...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map((m) => m[1]),
    ["graphics-show-fps", "invert-mouse-y", "chat-input"],
    "World inputs are limited to graphics/camera preferences and local chat; nickname stays profile-owned"
  );
  const settingsStart = html.indexOf('id="view-settings"');
  assert.ok(settingsStart >= 0, "graphics preferences live in the existing settings panel");
  const settingsPanel = html.slice(settingsStart, html.indexOf("</section>", settingsStart));
  assert.match(settingsPanel, /<input\b(?=[^>]*\bid="graphics-show-fps")(?=[^>]*\btype="checkbox")[^>]*>/,
    "the explicitly allowed FPS input is a checkbox inside the graphics settings panel");
  assert.doesNotMatch(profile, /localStorage|setItem|submit/, "no World nickname storage or form");
  assert.match(profile, /setIdentity\(identity\)/);
  assert.match(profile, /"\/profile\/"/, "members are sent to the INHAGAME profile to change it");
  assert.match(online, /from\("profiles"\)\.select\("nickname"\)/, "display name read from profiles");
  assert.match(online, /normalizeDisplayName\(displayName\)/, "local label matches what others see");
});
