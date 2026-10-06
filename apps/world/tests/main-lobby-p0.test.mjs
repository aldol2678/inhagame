import test from "node:test";
import assert from "node:assert/strict";
import { isLobbyShellRequested } from "../src/lobby/lobby-shell.js";
import { createLobbyWorldMode, LOBBY_CAMERA_PRESET } from "../src/lobby/lobby-world.js";
import { BACK_GATE_SPAWN, MAIN_GATE_SPAWN } from "../src/campus-spawn.js";
import { enterMainGate } from "../src/lobby/lobby-main-gate.js";
import { WORLD_RESUME_STORAGE_KEY, createWorldResumeStore, readWorldResume, validateResumeRecord } from "../src/lobby/world-resume.js";
import { enterResume, formatResumeAge } from "../src/lobby/lobby-resume.js";
import { BACK_GATE_LOCK, bindLockedBackGate } from "../src/lobby/lobby-back-gate.js";
import { createLobbyTransition, LOBBY_TRANSITION } from "../src/lobby/lobby-transition.js";
import { createLobbyMenu } from "../src/lobby/lobby-menu.js";
import { createLobbyPlayerSummary, DEFAULT_LOBBY_CHARACTER, lobbyProgressionText } from "../src/lobby/lobby-player-summary.js";
import { createLobbyPresenceSummary, LOBBY_PRESENCE_SCOPE } from "../src/lobby/lobby-presence-summary.js";
import { createLobbyQuestHighlight, selectLobbyQuest, LOBBY_QUEST_SOURCE } from "../src/lobby/lobby-quest-highlight.js";
import { createSpawnRegistry, DEFAULT_SPAWN_DEFINITIONS, SPAWN_ID, SPAWN_STATE, canStartSpawn } from "../src/lobby/spawn-registry.js";
import { QUEST_ID } from "../npc-factory/quest-contract.mjs";
import { createWorldLoading, WORLD_LOADING_PHASES } from "../src/lobby/lobby-loading.js";

test("P0.2 lobby query stays explicit", () => {
  assert.equal(isLobbyShellRequested({ search: "" }), false);
  assert.equal(isLobbyShellRequested({ search: "?lobby=0" }), false);
  assert.equal(isLobbyShellRequested({ search: "?lobby=1" }), true);
});

test("P0.2 locks movement/camera and renders the real player idle", () => {
  const calls = [];
  const player = {
    pos: { x: 0, y: 1.15, z: -98 },
    euler: { x: 0, y: 12, z: 0 },
    getLocalPosition() { return this.pos; },
    getLocalEulerAngles() { return this.euler; },
    setLocalEulerAngles(x, y, z) { this.euler = { x, y, z }; calls.push(["playerEuler", x, y, z]); }
  };
  const controller = {
    inputEnabled: true,
    setInputEnabled(value) { this.inputEnabled = value; calls.push(["controller", value]); }
  };
  const orbit = {
    inputEnabled: true, yaw: 1.1, pitch: .4, distance: 3.5, firstPerson: false,
    setInputEnabled(value) { this.inputEnabled = value; calls.push(["orbitInput", value]); },
    togglePerspective() { this.firstPerson = !this.firstPerson; },
    apply(pos, eyeHeight) { calls.push(["apply", pos, eyeHeight]); }
  };
  const character = {
    eyeHeight: 1.6,
    setMounted(value) { calls.push(["mounted", value]); },
    setFirstPerson(value) { calls.push(["firstPerson", value]); },
    update(_dt, state) { calls.push(["character", state]); }
  };
  const root = { dataset: {} };
  const lobby = createLobbyWorldMode({ player, controller, orbit, character, root });

  assert.equal(lobby.enter(), true);
  assert.equal(lobby.active, true);
  assert.equal(controller.inputEnabled, false);
  assert.equal(orbit.inputEnabled, false);
  assert.deepEqual(
    { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, playerYaw: player.euler.y },
    LOBBY_CAMERA_PRESET
  );
  assert.equal(root.dataset.lobbyWorld, "true");

  assert.equal(lobby.update(.016), true);
  const idle = calls.find(call => call[0] === "character")[1];
  assert.deepEqual(idle, { mounted: false, moving: false, grounded: true, emote: null, seated: false });
  assert.ok(calls.some(call => call[0] === "apply"), "fixed lobby orbit is applied to the real player");

  assert.equal(lobby.leave(), true);
  assert.equal(controller.inputEnabled, true);
  assert.equal(orbit.inputEnabled, true);
  assert.equal(player.euler.y, 12);
  assert.equal(root.dataset.lobbyWorld, undefined);
});


test("P0.2 external input authority receives lobby lifecycle without direct toggles", () => {
  const lifecycle = [];
  const player = {
    euler: { x: 0, y: 12, z: 0 },
    getLocalPosition: () => ({ x: 0, y: 1.15, z: -98 }),
    getLocalEulerAngles() { return this.euler; },
    setLocalEulerAngles(x, y, z) { this.euler = { x, y, z }; }
  };
  const controller = { inputEnabled: true, setInputEnabled() { throw new Error("direct controller input toggle"); } };
  const orbit = {
    inputEnabled: true, yaw: 1.1, pitch: .4, distance: 3.5, firstPerson: false,
    setInputEnabled() { throw new Error("direct orbit input toggle"); },
    togglePerspective() { this.firstPerson = !this.firstPerson; },
    apply() {}
  };
  const character = { eyeHeight: 1.6, setMounted() {}, setFirstPerson() {}, update() {} };
  const lobby = createLobbyWorldMode({
    player, controller, orbit, character, root: { dataset: {} },
    onActiveChange: active => lifecycle.push(active)
  });

  assert.equal(lobby.enter(), true);
  assert.deepEqual(lifecycle, [true]);
  assert.equal(lobby.leave(), true);
  assert.deepEqual(lifecycle, [true, false]);
});

test("P0.3 MAIN_GATE start exits lobby and places the player at the canonical anchor", () => {
  const calls = [];
  const lobby = { hidden: false };
  const documentLike = {
    body: { dataset: { lobbyShell: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: null, yaw: null,
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; calls.push(["position", x, y, z]); },
    setLocalEulerAngles(_x, y, _z) { this.yaw = y; calls.push(["yaw", y]); }
  };
  const lobbyWorld = {
    active: true,
    leave() { this.active = false; calls.push(["leave"]); return true; }
  };
  assert.equal(enterMainGate({ player, lobbyWorld, documentLike }), true);
  assert.deepEqual(player.pos, { x: MAIN_GATE_SPAWN.x, y: MAIN_GATE_SPAWN.y, z: MAIN_GATE_SPAWN.z });
  assert.equal(player.yaw, MAIN_GATE_SPAWN.yaw * 180 / Math.PI);
  assert.equal(lobbyWorld.active, false);
  assert.equal(lobby.hidden, true);
  assert.equal(documentLike.body.dataset.lobbyShell, undefined);
});

test("P0.3 MAIN_GATE skips the staged transition when already at the canonical spawn", () => {
  const lobby = { hidden: false };
  const documentLike = {
    body: { dataset: { lobbyShell: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: { ...MAIN_GATE_SPAWN },
    getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  const lobbyWorld = {
    active: true,
    leave() { this.active = false; return true; }
  };
  let transitionStarts = 0;
  let entered = 0;
  const transition = {
    start() { transitionStarts++; return true; }
  };

  assert.equal(enterMainGate({
    player, lobbyWorld, documentLike, transition,
    onEntered: () => { entered++; }
  }), true);
  assert.equal(transitionStarts, 0);
  assert.equal(entered, 1);
  assert.equal(lobbyWorld.active, false);
  assert.equal(lobby.hidden, true);
});

test("P0.3 MAIN_GATE keeps the staged transition when a real reposition is required", () => {
  const player = {
    pos: { x: MAIN_GATE_SPAWN.x + 12, y: MAIN_GATE_SPAWN.y, z: MAIN_GATE_SPAWN.z },
    getLocalPosition() { return this.pos; },
    setLocalPosition() { throw new Error("direct move should not run"); },
    setLocalEulerAngles() { throw new Error("direct yaw should not run"); }
  };
  const lobbyWorld = {
    active: true,
    leave() { throw new Error("transition owns the handoff"); }
  };
  let args = null;
  let entered = 0;
  const transition = {
    start(next) { args = next; return true; }
  };

  assert.equal(enterMainGate({
    player, lobbyWorld, transition,
    onEntered: () => { entered++; }
  }), true);
  assert.deepEqual(args.position, MAIN_GATE_SPAWN);
  assert.equal(args.cameraYaw, MAIN_GATE_SPAWN.yaw);
  assert.equal(entered, 0, 'presentation waits for the transition handoff');
  args.onComplete();
  assert.equal(entered, 1);
});

test("P0.3 MAIN_GATE start is inert outside lobby mode", () => {
  let moved = false;
  const player = { setLocalPosition() { moved = true; }, setLocalEulerAngles() { moved = true; } };
  assert.equal(enterMainGate({ player, lobbyWorld: { active: false } }), false);
  assert.equal(moved, false);
});


test("P0.4 resume store saves only safe grounded outdoor positions", () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
  let now = 10_000;
  const store = createWorldResumeStore({ storage, clock: { now: () => now }, saveIntervalMs: 2000 });
  const position = { x: 0, y: 1.15, z: -76 };
  const place = { id: "AREA_MAIN_GATE", displayName: "정문·남쪽 진입로" };

  assert.equal(store.maybeSave({ position, place, grounded: false }), false, "airborne is rejected");
  assert.equal(store.maybeSave({ position, place, grounded: true, mounted: true }), false, "mounted is rejected");
  assert.equal(store.maybeSave({ position, place, grounded: true, insideRoom: true }), false, "room is rejected");
  assert.equal(store.maybeSave({ position, place, grounded: true, yawDeg: 18, cameraYaw: .4 }), true);
  assert.ok(data.has(WORLD_RESUME_STORAGE_KEY));

  now += 1000;
  assert.equal(store.maybeSave({ position, place, grounded: true }), false, "writes are throttled");
  now += 1200;
  assert.equal(store.maybeSave({ position, place, grounded: true }), true);
  assert.equal(store.read().state, "VALID");
});

test("P0.4 rejects malformed or unsafe resume records", () => {
  assert.equal(validateResumeRecord(null).state, "INVALID");
  assert.equal(validateResumeRecord({ version: 1, x: 99999, y: 1.15, z: 0, savedAt: 1 }).state, "INVALID");
  assert.equal(validateResumeRecord({ version: 1, x: 0, y: 12, z: -76, savedAt: 1 }).state, "INVALID");
  const storage = { getItem: () => "{bad json" };
  assert.equal(readWorldResume(storage).state, "INVALID");
});

test("P0.4 resume handoff restores saved position while spawn unlock remains unrelated", () => {
  const lobby = { hidden: false };
  const documentLike = {
    body: { dataset: { lobbyShell: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: null, yaw: null,
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles(_x, y, _z) { this.yaw = y; }
  };
  const orbit = { yaw: 0 };
  const lobbyWorld = { active: true, leave() { this.active = false; return true; } };
  const record = { x: 12, y: 1.15, z: 34, yawDeg: 45, cameraYaw: 1.2, zoneId: "AREA_BACK_GATE" };

  assert.equal(enterResume({ player, orbit, lobbyWorld, record, documentLike }), true);
  assert.deepEqual(player.pos, { x: 12, y: 1.15, z: 34 });
  assert.equal(player.yaw, 45);
  assert.equal(orbit.yaw, 1.2);
  assert.equal(lobby.hidden, true);
  assert.equal(documentLike.body.dataset.lobbyShell, undefined);
});

test("P0.4 relative resume age stays compact", () => {
  const now = Date.UTC(2026, 8, 26, 7, 0, 0);
  assert.equal(formatResumeAge(now - 20_000, now), "방금 전");
  assert.equal(formatResumeAge(now - 12 * 60_000, now), "12분 전");
  assert.equal(formatResumeAge(now - 3 * 60 * 60_000, now), "3시간 전");
  assert.equal(formatResumeAge(now - 2 * 24 * 60 * 60_000, now), "2일 전");
});


test("P0.5 Back Gate is quest-locked before Main 1 completion", () => {
  assert.deepEqual(BACK_GATE_LOCK, {
    spawnId: "BACK_GATE",
    state: "LOCKED_PROGRESS",
    unlockType: "QUEST",
    unlockQuestId: QUEST_ID,
    title: "후문"
  });

  const listeners = new Map();
  const button = {
    attrs: new Map(),
    addEventListener(type, cb) { listeners.set(`button:${type}`, cb); },
    removeEventListener() {},
    setAttribute(key, value) { this.attrs.set(key, value); },
    focus() { this.focused = true; }
  };
  const closeButton = {
    addEventListener(type, cb) { listeners.set(`close:${type}`, cb); },
    removeEventListener() {},
    focus() { this.focused = true; }
  };
  const confirmButton = {
    addEventListener(type, cb) { listeners.set(`confirm:${type}`, cb); },
    removeEventListener() {},
    focus() { this.focused = true; }
  };
  const dialog = { hidden: true };
  const documentLike = {
    activeElement: button,
    addEventListener(type, cb) { listeners.set(`document:${type}`, cb); },
    removeEventListener() {}
  };
  const lock = bindLockedBackGate({ button, dialog, closeButton, confirmButton, documentLike });
  assert.equal(lock.canStart(), false);
  listeners.get("button:click")();
  assert.equal(lock.open, true);
  assert.equal(dialog.hidden, false);
  assert.equal(button.attrs.get("aria-expanded"), "true");
  assert.equal(closeButton.focused, true);

  listeners.get("confirm:click")();
  assert.equal(lock.open, false);
  assert.equal(dialog.hidden, true);
  assert.equal(button.attrs.get("aria-expanded"), "false");
});

test("P0.5 Escape closes locked Back Gate detail without changing lock state", () => {
  const listeners = new Map();
  const button = {
    addEventListener(type, cb) { listeners.set(`button:${type}`, cb); },
    removeEventListener() {},
    setAttribute() {},
    focus() {}
  };
  const dialog = { hidden: true };
  const closeButton = { addEventListener() {}, removeEventListener() {}, focus() {} };
  const confirmButton = { addEventListener() {}, removeEventListener() {}, focus() {} };
  const documentLike = {
    activeElement: button,
    addEventListener(type, cb) { listeners.set(`document:${type}`, cb); },
    removeEventListener() {}
  };
  const lock = bindLockedBackGate({ button, dialog, closeButton, confirmButton, documentLike });
  listeners.get("button:click")();
  let prevented = false;
  listeners.get("document:keydown")({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(lock.open, false);
  assert.equal(lock.canStart(), false);
  assert.equal(BACK_GATE_LOCK.state, "LOCKED_PROGRESS");
});


test("P0.6 transition keeps input locked until fade and camera blend complete", () => {
  const classes = new Set();
  const overlay = {
    hidden: true,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }
    }
  };
  const lobbyClasses = new Set();
  const lobby = {
    hidden: false,
    classList: {
      add(name) { lobbyClasses.add(name); },
      remove(name) { lobbyClasses.delete(name); }
    }
  };
  const documentLike = {
    body: { dataset: { lobbyShell: "true", lobbyWorld: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: { x: 0, y: 1.15, z: -98 },
    yaw: 180,
    getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles(_x, y, _z) { this.yaw = y; }
  };
  const controller = {
    inputEnabled: false,
    setInputEnabled(value) { this.inputEnabled = value; }
  };
  const orbit = {
    inputEnabled: false,
    yaw: 0, pitch: .18, distance: 5.6,
    setInputEnabled(value) { this.inputEnabled = value; },
    apply() {}
  };
  const character = {
    eyeHeight: 1.5,
    setMounted() {},
    setFirstPerson() {},
    update() {}
  };
  const lobbyWorld = {
    active: true,
    gameplayCamera: () => ({ yaw: .7, pitch: .4, distance: 3.5, firstPerson: false }),
    leave(options) {
      assert.deepEqual(options, { restoreCamera: false, restorePlayerEuler: false, enableInput: false });
      this.active = false;
      delete documentLike.body.dataset.lobbyWorld;
      return true;
    }
  };
  const transition = createLobbyTransition({
    player, controller, orbit, character, lobbyWorld, overlay, documentLike,
    reducedMotion: { matches: false }
  });

  assert.equal(transition.start({
    position: { x: 12, y: 1.15, z: 20 },
    yawDeg: 30,
    cameraYaw: 1.1
  }), true);
  assert.equal(transition.phase, "fade");
  assert.equal(controller.inputEnabled, false);
  assert.equal(orbit.inputEnabled, false);
  assert.equal(classes.has("on"), true);
  assert.equal(lobbyClasses.has("is-leaving"), true);

  for (let i = 0; i < 4; i++) transition.update(.05);
  assert.equal(transition.phase, "blend");
  assert.deepEqual(player.pos, { x: 12, y: 1.15, z: 20 });
  assert.equal(lobby.hidden, true);
  assert.equal(controller.inputEnabled, false, "input remains locked during camera blend");

  for (let i = 0; i < 3; i++) transition.update(.05);
  assert.equal(transition.active, true);
  assert.notEqual(orbit.yaw, 0);
  assert.notEqual(orbit.yaw, 1.1);

  for (let i = 0; i < 4; i++) transition.update(.05);
  assert.equal(transition.active, false);
  assert.equal(orbit.yaw, 1.1);
  assert.equal(controller.inputEnabled, true);
  assert.equal(orbit.inputEnabled, true);
  assert.equal(overlay.hidden, true);
  assert.equal(documentLike.body.dataset.lobbyTransition, undefined);
});

test("P0.6 external input authority owns transition lifecycle without direct toggles", () => {
  const lifecycle = [];
  const lobby = { hidden: false, classList: { add() {}, remove() {} } };
  const documentLike = {
    body: { dataset: { lobbyShell: "true", lobbyWorld: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: { x: 0, y: 1.15, z: -98 },
    getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  const controller = { setInputEnabled() { throw new Error("direct controller input toggle"); } };
  const orbit = {
    yaw: 0, pitch: .18, distance: 5.6,
    setInputEnabled() { throw new Error("direct orbit input toggle"); },
    apply() {}
  };
  const character = { eyeHeight: 1.5, setMounted() {}, setFirstPerson() {}, update() {} };
  const lobbyWorld = {
    active: true,
    gameplayCamera: () => ({ yaw: 0, pitch: .4, distance: 3.5 }),
    leave() { this.active = false; return true; }
  };
  const transition = createLobbyTransition({
    player, controller, orbit, character, lobbyWorld, documentLike,
    reducedMotion: { matches: true },
    onActiveChange: active => lifecycle.push(active)
  });

  assert.equal(transition.start({ position: { x: 0, y: 1.15, z: -98 } }), true);
  assert.deepEqual(lifecycle, [true, false]);
  assert.equal(transition.active, false);
});

test("P0.6 reduced-motion handoff completes without animation delay", () => {
  const lobby = { hidden: false, classList: { add() {}, remove() {} } };
  const documentLike = {
    body: { dataset: { lobbyShell: "true" } },
    getElementById(id) { return id === "world-lobby" ? lobby : null; }
  };
  const player = {
    pos: null,
    getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  const controller = { inputEnabled: false, setInputEnabled(v) { this.inputEnabled = v; } };
  const orbit = { inputEnabled: false, yaw: 0, pitch: .18, distance: 5.6, setInputEnabled(v) { this.inputEnabled = v; }, apply() {} };
  const character = { eyeHeight: 1.5, setMounted() {}, setFirstPerson() {}, update() {} };
  const lobbyWorld = {
    active: true,
    gameplayCamera: () => ({ yaw: 0, pitch: .4, distance: 3.5 }),
    leave() { this.active = false; return true; }
  };
  const transition = createLobbyTransition({
    player, controller, orbit, character, lobbyWorld, documentLike,
    reducedMotion: { matches: true }
  });
  assert.equal(transition.start({ position: { x: 0, y: 1.15, z: -98 } }), true);
  assert.equal(transition.active, false);
  assert.equal(controller.inputEnabled, true);
  assert.equal(orbit.inputEnabled, true);
  assert.equal(lobby.hidden, true);
});


test("P1.1 lobby menu opens, delegates profile/settings, and closes with Escape", () => {
  const listeners = new Map();
  const toggle = {
    attrs: new Map(), textContent: "☰",
    addEventListener(type, cb) { listeners.set(`toggle:${type}`, cb); },
    setAttribute(k, v) { this.attrs.set(k, v); },
    contains() { return false; },
    focus() { this.focused = true; }
  };
  const panel = {
    hidden: true,
    addEventListener(type, cb) { listeners.set(`panel:${type}`, cb); },
    contains() { return false; }
  };
  const profileButton = {
    addEventListener(type, cb) { listeners.set(`profile:${type}`, cb); },
    removeEventListener() {}
  };
  const settingsButton = {
    addEventListener(type, cb) { listeners.set(`settings:${type}`, cb); },
    removeEventListener() {}
  };
  let profileClicks = 0, settingsClicks = 0;
  const existingProfileButton = { click() { profileClicks++; } };
  const existingSettingsButton = { click() { settingsClicks++; } };
  const doc = {
    addEventListener(type, cb) { listeners.set(`doc:${type}`, cb); }
  };
  const menu = createLobbyMenu({ toggle, panel, profileButton, settingsButton, existingProfileButton, existingSettingsButton, doc });

  listeners.get("toggle:click")();
  assert.equal(menu.open, true);
  assert.equal(panel.hidden, false);
  assert.equal(toggle.attrs.get("aria-expanded"), "true");
  assert.equal(toggle.textContent, "×");

  listeners.get("profile:click")();
  assert.equal(profileClicks, 1);
  assert.equal(menu.open, false);

  menu.setOpen(true, { focus: false });
  listeners.get("settings:click")();
  assert.equal(settingsClicks, 1);
  assert.equal(menu.open, false);

  menu.setOpen(true, { focus: false });
  listeners.get("doc:keydown")({ code: "Escape" });
  assert.equal(menu.open, false);
  assert.equal(toggle.focused, true);
});


test("P1.2 player summary mirrors profile identity and signed-in progression/wallet", async () => {
  const nameElement = { textContent: "" };
  const lookElement = { textContent: "" };
  const progressionElement = { textContent: "", hidden: false };
  const walletElement = { textContent: "", hidden: false };
  const accountElement = { textContent: "" };
  const profile = { nickname: "인덕이", signedIn: false };
  let resolveReady;
  const character = {
    modelState: "loading",
    ready: new Promise(resolve => { resolveReady = resolve; })
  };
  const summary = createLobbyPlayerSummary({
    nameElement, lookElement, progressionElement, walletElement, accountElement, profile, character
  });

  assert.equal(nameElement.textContent, "인덕이");
  assert.equal(lookElement.textContent, DEFAULT_LOBBY_CHARACTER);
  assert.equal(accountElement.textContent, "게스트");
  assert.equal(progressionElement.hidden, true);
  assert.equal(walletElement.hidden, true);

  profile.nickname = "알돌";
  profile.signedIn = true;
  summary.render();
  summary.setProgression({ levelText: "Lv.3", expText: "240 / 500 EXP", fullText: "Lv.3 240 / 500 EXP" });
  summary.setWalletBalance(1250);
  assert.equal(nameElement.textContent, "알돌");
  assert.equal(accountElement.textContent, "INHAGAME 계정");
  assert.equal(progressionElement.textContent, "Lv.3 · 240/500 EXP");
  assert.equal(progressionElement.hidden, false);
  assert.equal(walletElement.textContent, "🪙 1,250");
  assert.equal(walletElement.hidden, false);

  profile.signedIn = false;
  summary.render();
  assert.equal(progressionElement.hidden, true, "guest never inherits account progression");
  assert.equal(walletElement.hidden, true, "guest never inherits account wallet");

  character.modelState = "fallback";
  resolveReady("fallback");
  await character.ready;
  await Promise.resolve();
  assert.equal(lookElement.textContent, DEFAULT_LOBBY_CHARACTER, "fallback does not invent a different skin");
  assert.equal(summary.status().modelState, "fallback");
});

test("P1.2 lobby progression keeps Level and EXP compact", () => {
  assert.equal(lobbyProgressionText({ levelText: "Lv.3", expText: "240 / 500 EXP", fullText: "fallback" }), "Lv.3 · 240/500 EXP");
  assert.equal(lobbyProgressionText({ levelText: "Lv.9", expText: "12,340 EXP", fullText: "fallback" }), "Lv.9 · 12,340 EXP");
  assert.equal(lobbyProgressionText({ fullText: "Lv.1 0 / 100 EXP" }), "Lv.1 0 / 100 EXP");
});

test("P1.2 player summary uses safe guest defaults when profile data is unavailable", () => {
  const nameElement = { textContent: "" };
  const lookElement = { textContent: "" };
  const accountElement = { textContent: "" };
  const summary = createLobbyPlayerSummary({ nameElement, lookElement, accountElement });
  assert.deepEqual(summary.status(), {
    nickname: "인덕이",
    signedIn: false,
    character: DEFAULT_LOBBY_CHARACTER,
    modelState: "unknown"
  });
  assert.equal(accountElement.textContent, "게스트");
});


test("P1.3 lobby presence shows world-wide population while friend context stays Place Zone scoped", () => {
  const zoneElement = { textContent: "" };
  const friendsButton = {
    textContent: "", disabled: true, attrs: new Map(),
    addEventListener(_type, cb) { this.click = cb; },
    setAttribute(k, v) { this.attrs.set(k, v); }
  };
  const remotes = new Set(["friend-a"]);
  const online = {
    status: () => ({ signedIn: true, state: "ONLINE", count: 4 }),
    remoteByUser: userId => remotes.has(userId) ? { userId } : null
  };
  const population = {
    status: () => ({ state: "READY", snapshot: { online: 12 } })
  };
  const social = { available: true };
  let opened = 0;
  const friendPanel = { open: false, setOpen() { opened++; this.open = true; return Promise.resolve(); } };
  const summary = createLobbyPresenceSummary({
    zoneElement, friendsButton, getOnline: () => online, getPopulation: () => population, social, friendPanel
  });
  summary.setFriends([{ userId: "friend-a" }, { userId: "friend-b" }]);

  const status = summary.status();
  assert.equal(status.scope, LOBBY_PRESENCE_SCOPE);
  assert.equal(status.worldCount, 12);
  assert.equal(status.zoneCount, 4);
  assert.equal(status.sameZoneFriends, 1);
  assert.equal(status.totalFriends, 2);
  assert.equal(zoneElement.textContent, "전체 접속 12명");
  assert.equal(friendsButton.textContent, "같은 구역 1명 · 친구 2명");
  assert.equal(friendsButton.disabled, false);

  friendsButton.click();
  assert.equal(opened, 1);
});

test("P1.3 world population remains visible to signed-out guests", () => {
  const zoneElement = { textContent: "" };
  const friendsButton = {
    textContent: "", disabled: false,
    addEventListener() {},
    setAttribute() {}
  };
  const summary = createLobbyPresenceSummary({
    zoneElement,
    friendsButton,
    getOnline: () => ({ status: () => ({ signedIn: false, state: "OFFLINE", count: 0 }) }),
    getPopulation: () => ({ status: () => ({ state: "READY", snapshot: { online: 7 } }) }),
    social: { available: false }
  });
  const status = summary.status();
  assert.equal(status.worldCount, 7);
  assert.equal(status.zoneCount, null);
  assert.equal(status.sameZoneFriends, 0);
  assert.equal(zoneElement.textContent, "전체 접속 7명");
  assert.equal(friendsButton.textContent, "로그인하면 친구 상태 확인");
  assert.equal(friendsButton.disabled, true);
});

test("P1.3 relationship changes update the cached friend count without a new RPC", () => {
  const summary = createLobbyPresenceSummary({
    getOnline: () => ({ status: () => ({ signedIn: true, state: "ONLINE", count: 1 }), remoteByUser: () => null }),
    social: { available: true }
  });
  summary.setFriends([]);
  summary.applyRelationship("friend-a", "friends");
  assert.equal(summary.status().totalFriends, 1);
  summary.applyRelationship("friend-a", "none");
  assert.equal(summary.status().totalFriends, 0);
});


test("P1.4 active authored NPC quest outranks the first tour", () => {
  const selected = selectLobbyQuest({
    tourStage: 0,
    quest: { enabled: true, signedIn: true, stage: 2 }
  });
  assert.deepEqual(selected, {
    source: LOBBY_QUEST_SOURCE.WORLD_QUEST,
    title: "첫 캠퍼스 탐방",
    objective: "인경호 방문",
    state: "진행 중",
    progress: "2 / 5",
    cta: "탐방 이어가기"
  });
});

test("C15.1 signed-in fresh account sees the persistent First Campus quest before local tour", () => {
  const selected = selectLobbyQuest({
    tourStage: 0,
    quest: { enabled: true, signedIn: true, stage: 0 }
  });
  assert.equal(selected.source, LOBBY_QUEST_SOURCE.WORLD_QUEST_AVAILABLE);
  assert.equal(selected.title, "첫 캠퍼스 탐방");
  assert.equal(selected.objective, "정문에서 나나율과 대화");
  assert.equal(selected.state, "시작 가능");
  assert.equal(selected.cta, "첫 탐방 시작하기");
});

test("C15.2 signed-in degraded quest status never falls back to the guest guided tour", () => {
  const selected = selectLobbyQuest({
    tourStage: 0,
    quest: { enabled: true, signedIn: true, ready: false, stage: 0 }
  });
  assert.equal(selected, null);
});


test("P1.4 signed-in account never sees browser-local tour when quest runtime is absent", () => {
  assert.equal(selectLobbyQuest({
    tourStage: 0,
    quest: null,
    accountSignedIn: true
  }), null);
});

test("P1.4 incomplete first tour is the guest-safe fallback", () => {
  const selected = selectLobbyQuest({
    tourStage: 1,
    quest: { enabled: false, signedIn: false, stage: 0 }
  });
  assert.equal(selected.source, LOBBY_QUEST_SOURCE.FIRST_TOUR);
  assert.equal(selected.title, "첫 캠퍼스 탐방");
  assert.equal(selected.objective, "본관 앞");
  assert.equal(selected.progress, "1 / 2");
  assert.equal(selected.cta, "탐방 이어가기");
});

test("P1.4 completed tour can surface the authored quest start when available", () => {
  const selected = selectLobbyQuest({
    tourStage: 2,
    quest: { enabled: true, signedIn: true, stage: 0 }
  });
  assert.deepEqual(selected, {
    source: LOBBY_QUEST_SOURCE.WORLD_QUEST_AVAILABLE,
    title: "첫 캠퍼스 탐방",
    objective: "정문에서 나나율과 대화",
    state: "시작 가능",
    progress: "0 / 5",
    cta: "첫 탐방 시작하기"
  });
});

test("P1.4 completed Main 1 points to the back-gate guide when Main 2 is available", () => {
  const selected = selectLobbyQuest({
    tourStage: 2,
    quest: {
      quest: { enabled: true, signedIn: true, stage: 5 },
      main2Quest: { enabled: true, signedIn: true, available: true, stage: 0 }
    }
  });
  assert.equal(selected.source, LOBBY_QUEST_SOURCE.WORLD_QUEST);
  assert.equal(selected.title, "길은 기억해 둘게");
  assert.equal(selected.objective, "후문 안쪽 안내 학생과 대화");
  assert.equal(selected.state, "시작 가능");
  assert.equal(selected.progress, "0 / 9");
});

test("P1.4 signed-in completed quest chain never resurrects the guest first tour", () => {
  assert.equal(selectLobbyQuest({
    tourStage: 0,
    quest: {
      quest: { enabled: true, signedIn: true, stage: 5 },
      main2Quest: { enabled: true, signedIn: true, available: true, stage: 9 }
    }
  }), null);
});

test("P1.4 hides the card when there is no unfinished or available task", () => {
  assert.equal(selectLobbyQuest({
    tourStage: 2,
    quest: { enabled: true, signedIn: true, stage: 5 }
  }), null);
  assert.equal(selectLobbyQuest({
    tourStage: 2,
    quest: { enabled: false, signedIn: false, stage: 0 }
  }), null);
});

test("P1.4 renderer clears completed highlights instead of leaving stale copy", () => {
  const root = { hidden: true };
  const stateElement = { textContent: "" };
  const kickerElement = { textContent: "" };
  const titleElement = { textContent: "" };
  const objectiveElement = { textContent: "" };
  const progressElement = { textContent: "" };
  const ctaElement = { textContent: "" };
  let tourStage = 0;
  let quest = null;
  const highlight = createLobbyQuestHighlight({
    root, kickerElement, stateElement, titleElement, objectiveElement, progressElement, ctaElement,
    getTourStage: () => tourStage,
    getQuest: () => quest
  });
  assert.equal(root.hidden, false);
  assert.equal(kickerElement.textContent, "퀘스트");
  assert.equal(titleElement.textContent, "첫 캠퍼스 탐방");
  assert.equal(ctaElement.textContent, "정문에서 시작하기 →");

  tourStage = 2;
  quest = { enabled: true, signedIn: true, stage: 5 };
  highlight.update();
  assert.equal(root.hidden, true);
  assert.equal(highlight.status(), null);
  assert.equal(ctaElement.textContent, "시작하기 →");
});


test("P1.5 default Spawn Registry owns the current Main/Back Gate contracts", () => {
  const registry = createSpawnRegistry();
  const main = registry.get(SPAWN_ID.MAIN_GATE);
  const back = registry.get(SPAWN_ID.BACK_GATE);

  assert.deepEqual(registry.list().map(item => item.spawnId), [SPAWN_ID.MAIN_GATE, SPAWN_ID.BACK_GATE]);
  assert.equal(main.state, SPAWN_STATE.AVAILABLE);
  assert.equal(main.canStart, true);
  assert.deepEqual(main.spawnAnchor, MAIN_GATE_SPAWN);
  assert.equal(back.state, SPAWN_STATE.LOCKED_PROGRESS);
  assert.equal(back.unlockType, "QUEST");
  assert.equal(back.unlockCondition.questId, QUEST_ID);
  assert.equal(back.canStart, false);
  assert.deepEqual(back.spawnAnchor, BACK_GATE_SPAWN);
  assert.equal(registry.anchor(SPAWN_ID.BACK_GATE), null, "locked spawn never yields a start anchor");
});

test("P1.5 resolver failures degrade to UNKNOWN instead of pretending content is locked", () => {
  const registry = createSpawnRegistry({ stateResolver() { throw new Error("offline"); } });
  const main = registry.get(SPAWN_ID.MAIN_GATE);
  assert.equal(main.state, SPAWN_STATE.UNKNOWN);
  assert.equal(main.canStart, false);
  assert.equal(main.visible, true);
});

test("P1.5 future definitions plug into the Registry without changing lobby code", () => {
  const future = {
    spawnId: SPAWN_ID.DORM,
    name: "기숙사",
    description: "미래 시작 지점",
    worldZone: null,
    spawnAnchor: null,
    state: SPAWN_STATE.HIDDEN,
    unlockType: "PROPERTY",
    unlockCondition: null,
    previewScene: null,
    onlineCountScope: "PLACE_ZONE",
    allowResume: true,
    allowFavorite: false,
    sortPriority: 30
  };
  const registry = createSpawnRegistry({
    definitions: [...Object.values(DEFAULT_SPAWN_DEFINITIONS), future]
  });
  assert.deepEqual(registry.list().map(item => item.spawnId), [SPAWN_ID.MAIN_GATE, SPAWN_ID.BACK_GATE]);
  assert.equal(registry.list({ includeHidden: true }).at(-1).spawnId, SPAWN_ID.DORM);
});

test("P1.5 Main 1 completion unlocks Back Gate through the default progress resolver", () => {
  const registry = createSpawnRegistry();
  const locked = registry.get(SPAWN_ID.BACK_GATE);
  const unlocked = registry.get(SPAWN_ID.BACK_GATE, { completedQuestIds: [QUEST_ID] });
  assert.equal(locked.state, SPAWN_STATE.LOCKED_PROGRESS);
  assert.equal(locked.canStart, false);
  assert.equal(unlocked.state, SPAWN_STATE.AVAILABLE);
  assert.equal(unlocked.canStart, true);
  assert.deepEqual(unlocked.spawnAnchor, BACK_GATE_SPAWN);
  assert.deepEqual(registry.anchor(SPAWN_ID.BACK_GATE, { completedQuestIds: new Set([QUEST_ID]) }), BACK_GATE_SPAWN);
});

test("P1.5 Back Gate binding switches from lock dialog to spawn start after Main 1 completion", () => {
  const listeners = new Map();
  const button = {
    dataset: {},
    attrs: new Map(),
    addEventListener(type, cb) { listeners.set(`button:${type}`, cb); },
    removeEventListener() {},
    setAttribute(key, value) { this.attrs.set(key, value); },
    querySelector() { return null; },
    classList: { toggle() {} },
    focus() {}
  };
  const dialog = { hidden: true };
  const closeButton = { addEventListener() {}, removeEventListener() {}, focus() {} };
  const confirmButton = { addEventListener() {}, removeEventListener() {}, focus() {} };
  const documentLike = { activeElement: button, addEventListener() {}, removeEventListener() {} };
  const registry = createSpawnRegistry();
  let complete = false;
  let started = null;
  const binding = bindLockedBackGate({
    button, dialog, closeButton, confirmButton, documentLike,
    getDefinition: () => registry.get(SPAWN_ID.BACK_GATE, {
      completedQuestIds: complete ? [QUEST_ID] : []
    }),
    onStart: definition => { started = definition.spawnId; return true; }
  });

  listeners.get("button:click")();
  assert.equal(binding.open, true);
  assert.equal(started, null);
  binding.closeDialog();

  complete = true;
  binding.refresh();
  assert.equal(binding.canStart(), true);
  assert.equal(button.dataset.spawnState, SPAWN_STATE.AVAILABLE);
  listeners.get("button:click")();
  assert.equal(binding.open, false);
  assert.equal(started, SPAWN_ID.BACK_GATE);
});

test("P1.5 a future evaluator can unlock Back Gate without changing its anchor definition", () => {
  const registry = createSpawnRegistry({
    stateResolver(definition) {
      return definition.spawnId === SPAWN_ID.BACK_GATE ? SPAWN_STATE.AVAILABLE : definition.state;
    }
  });
  const back = registry.get(SPAWN_ID.BACK_GATE);
  assert.equal(back.state, SPAWN_STATE.AVAILABLE);
  assert.equal(canStartSpawn(back), true);
  assert.deepEqual(registry.anchor(SPAWN_ID.BACK_GATE), BACK_GATE_SPAWN);
});

test("P1.5 Main Gate entry refuses a non-startable Registry definition", () => {
  let moved = false;
  const player = { setLocalPosition() { moved = true; }, setLocalEulerAngles() { moved = true; } };
  const lobbyWorld = { active: true, leave() { return true; } };
  const lockedMain = { ...createSpawnRegistry().get(SPAWN_ID.MAIN_GATE), state: SPAWN_STATE.LOCKED_PROGRESS };
  assert.equal(enterMainGate({ player, lobbyWorld, spawnDefinition: lockedMain }), false);
  assert.equal(moved, false);
});


test("P1.6 Presence data failure degrades without throwing", () => {
  const zoneElement = { textContent: "" };
  const friendsButton = { textContent: "", disabled: false, addEventListener() {}, setAttribute() {} };
  const summary = createLobbyPresenceSummary({
    zoneElement,
    friendsButton,
    getOnline: () => { throw new Error("presence unavailable"); },
    social: { available: true }
  });
  assert.doesNotThrow(() => summary.update());
  assert.equal(summary.status().degraded, true);
  assert.equal(zoneElement.textContent, "전체 접속 —");
  assert.equal(friendsButton.disabled, true);
});

test("P1.6 Quest source failure falls back to a valid first-tour task", () => {
  const root = { hidden: true };
  const stateElement = { textContent: "" };
  const titleElement = { textContent: "" };
  const objectiveElement = { textContent: "" };
  const progressElement = { textContent: "" };
  const highlight = createLobbyQuestHighlight({
    root, stateElement, titleElement, objectiveElement, progressElement,
    getTourStage: () => 0,
    getQuest: () => { throw new Error("quest unavailable"); }
  });
  assert.equal(highlight.health().degraded, true);
  assert.equal(root.hidden, false);
  assert.equal(titleElement.textContent, "첫 캠퍼스 탐방");
  assert.equal(objectiveElement.textContent, "정문 통과");
});

test("P1.6 optional summary failure cannot block the Registry-backed Main Gate", () => {
  const registry = createSpawnRegistry();
  const player = {
    pos: null,
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  const lobbyWorld = { active: true, leave() { this.active = false; return true; } };
  const definition = registry.get(SPAWN_ID.MAIN_GATE);
  assert.equal(enterMainGate({ player, lobbyWorld, spawnDefinition: definition }), true);
  assert.deepEqual(player.pos, { x: MAIN_GATE_SPAWN.x, y: MAIN_GATE_SPAWN.y, z: MAIN_GATE_SPAWN.z });
});


test("P1.7 loading phases are monotonic and finish at READY", () => {
  const root = { dataset: {}, hidden: false, classList: { add(value) { this.value = value; } } };
  const message = { textContent: "" };
  const detail = { textContent: "" };
  const bar = { style: {}, attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, v); } };
  const percent = { textContent: "" };
  const button = { hidden: true, addEventListener(_type, cb) { this.click = cb; } };
  const lobby = { inert: false };
  const callbacks = [];
  const timers = { setTimeout(cb) { callbacks.push(cb); return callbacks.length; }, clearTimeout() {} };
  let now = 0;
  const loading = createWorldLoading({
    root, messageElement: message, detailElement: detail, barElement: bar,
    percentElement: percent, continueButton: button, interactionRoot: lobby,
    clock: { now: () => now }, timers, slowAfterMs: 6500, fadeMs: 0
  });

  assert.equal(loading.status().phase, "BOOT");
  assert.equal(percent.textContent, WORLD_LOADING_PHASES.BOOT.progress + "%");
  assert.equal(loading.setPhase("WORLD"), true);
  assert.equal(loading.setPhase("RENDERER"), false, "progress never moves backward");
  loading.setPhase("STREAMING");
  loading.setEssentialReady(true);
  callbacks[0]();
  assert.equal(button.hidden, true, "slow load never exposes an early-entry bypass");
  assert.equal(lobby.inert, true, "keyboard and touch cannot enter the unfinished scene");
  assert.equal(loading.finish({ early: true }), false, "essential readiness cannot bypass rendering");
  assert.equal(root.hidden, false);
  loading.setPhase("RENDERING");
  loading.setRenderReady(true);
  loading.finish();
  assert.equal(lobby.inert, false);
  assert.equal(loading.status().finished, true);
  assert.equal(loading.status().phase, "READY");
});

test("P1.7 loading error stays visible instead of revealing a broken World", () => {
  const root = { dataset: {}, hidden: false, classList: { add() {} } };
  const message = { textContent: "" };
  const detail = { textContent: "" };
  const timers = { setTimeout() { return 1; }, clearTimeout() {} };
  const loading = createWorldLoading({ root, messageElement: message, detailElement: detail, timers });
  loading.fail("초기화 실패");
  assert.equal(root.dataset.state, "ERROR");
  assert.equal(root.hidden, false);
  assert.equal(message.textContent, "초기화 실패");
});
