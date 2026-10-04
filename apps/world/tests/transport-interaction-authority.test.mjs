// Transport & Interaction Authority: E = emotion, F = interaction, M = transport.
// Keyboard and mobile buttons are two entrances to the same slot / controller action, and the
// network carries which mount a FLY pose rides so remote clients stop showing bikes as dragons.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Modules first (some read data through `window` detection at import time), globals after.
const { PlayerController, CAMPUS_MOVEMENT_SPACE } = await import("../src/player-controller.js");
const { MAIN_GATE_CAMPUS_BIKE, CAMPUS_BIKE_ID } = await import("../src/mounts/campus-bike-world.js");
const { DRAGON_MOUNT_ID, wireMountFor, mountIdForWire, remoteMountState } = await import("../src/mounts/mount-kinds.js");
const { createContextActionController } = await import("../src/context-action.js");
const { createCombatRuntimeV03 } = await import("../src/combat/combat-runtime-v03.js");
const { createInputFocusManager, INPUT_FOCUS_POLICY } = await import("../src/input/input-focus-manager.js");
const { createEmoteMenu } = await import("../src/online/emote-menu.js");
const { createPoseSource } = await import("../src/online/pose-source.js");
const { PosePublisher } = await import("../src/network/pose-publisher.js");
const { SnapshotInterpolator } = await import("../src/network/interpolation.js");
const { RemotePlayerManager } = await import("../src/network/remote-player-manager.js");
const { roomMovementSpace } = await import("../src/rooms/room-world-adapter.js");
const { ROOMS } = await import("../src/rooms/room-registry.js");
const {
  Anim, Mount, POSE_FIELDS, POSE_OPTIONAL_FIELDS, encodePose, validatePose, mountOf, buildPresence
} = await import("../src/network/protocol.js");
const { createFakeDocument } = await import("./support/fake-dom.mjs");

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const FOOT_Y = 1.15;
const BIKE = { x: MAIN_GATE_CAMPUS_BIKE.x, z: MAIN_GATE_CAMPUS_BIKE.z };
const OPEN_FIELD = { x: 0, z: -98 };

// A real PlayerController with its own window key listeners, driven like the browser.
function rig(at = BIKE) {
  const listeners = new Map();
  globalThis.window = { addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn); } };
  globalThis.HTMLElement ??= class {};
  globalThis.document = {
    body: { dataset: {} },
    getElementById: (id) => (["profile-panel", "view-settings", "keyboard-shortcuts-panel"].includes(id) ? { hidden: true } : null)
  };
  const pos = { x: at.x, y: FOOT_Y, z: at.z };
  const entity = {
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => Object.assign(pos, { x, y, z }),
    setLocalEulerAngles() {},
    getLocalRotation: () => ({ x: 0, y: 0, z: 0, w: 1 })
  };
  const controller = new PlayerController(entity);
  const key = (code, target = null) => {
    for (const fn of listeners.get("keydown") ?? []) fn({ code, repeat: false, target, preventDefault() {} });
    for (const fn of listeners.get("keyup") ?? []) fn({ code });
  };
  return { controller, entity, pos, key, move: (p) => Object.assign(pos, { x: p.x, y: FOOT_Y, z: p.z }) };
}

function fakeButton() {
  const attrs = {};
  return {
    hidden: true, disabled: false, textContent: "", dataset: {}, listeners: {},
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    tap() { return this.listeners.click?.(); }
  };
}
// The World's two slots as main.js wires them (interaction = F, transport = M).
function slots({ coarsePointer = true } = {}) {
  const interactionButton = fakeButton();
  const transportButton = fakeButton();
  return {
    interactionButton, transportButton,
    interaction: createContextActionController({ button: interactionButton, shortcut: "F", coarsePointer }),
    transport: createContextActionController({ button: transportButton, shortcut: "M", coarsePointer })
  };
}
const npcTalk = (onTalk) => ({ id: "npc-talk", icon: "💬", label: "학생과 대화", priority: 300, distance: 2, trigger: onTalk });

// ---- A. Input binding ----

test("A. E = emotion, F = interaction, M = transport: each key reaches only its own action", () => {
  // E toggles the emote menu and nothing else; F and M never open it.
  const doc = createFakeDocument();
  const menu = createEmoteMenu({ toggle: doc.createElement("button"), menu: doc.createElement("div"),
    onSelect: () => "started", doc, win: { setTimeout() {} } });
  for (const code of ["KeyF", "KeyM"]) doc.dispatch("keydown", { code, target: null });
  assert.equal(menu.open, false, "F and M never open emotes");
  doc.dispatch("keydown", { code: "KeyE", target: null });
  assert.equal(menu.open, true, "E opens emotes");

  // M is the only key that changes the mount; E and F leave it alone.
  const r = rig(OPEN_FIELD);
  r.key("KeyE"); r.key("KeyF");
  assert.equal(r.controller.mounted, false, "E and F never mount");
  r.key("KeyM");
  assert.equal(r.controller.mounted, true, "M mounts");

  // Wiring in the World: F → interaction slot, E ignores NPC/guestbook proximity, NPC and guestbook
  // own no E handler, and the context slots carry their key.
  const main = code("../src/main.js");
  assert.match(main, /createContextActionController\(\{\s*button: document\.getElementById\("context-action"\),\s*shortcut: "F",\s*onTriggered:/,
    "F remains the interaction slot while C15.3 observes successful actions");
  assert.match(main, /createContextActionController\(\{ button: document\.getElementById\("transport-action"\), shortcut: "M" \}\)/);
  assert.match(main, /event\.code !== "KeyF"[\s\S]{0,250}interactionAction\(\);/);
  const emoteGate = main.match(/const emoteMenu = createEmoteMenu\(\{[\s\S]*?shouldIgnoreShortcut:[\s\S]*?,\r?\n  \/\/ S1 rule/)?.[0];
  assert.ok(emoteGate, "emote shortcut gate remains wired in main");
  assert.doesNotMatch(emoteGate, /handlesTalkKey|handlesUseKey/, "near an NPC or the guestbook, E is still emotion");
  assert.match(main, /controller\.setTransportGate\(\(\) => !worldActionsSuspended\(\)\);/);
  const npc = code("../npc-factory/dev-runtime.mjs");
  assert.doesNotMatch(npc, /KeyE/, "NPC dialogue no longer listens to E");
  assert.match(npc, /id: 'npc-talk'[\s\S]{0,120}shortcut: 'F'/);
  assert.doesNotMatch(code("../src/guestbook/guestbook-interaction.js"), /addEventListener/, "guestbook owns no key");
  assert.match(code("../src/player-controller.js"), /event\.code === "KeyM" && !event\.repeat\) this\.transportAction\(\);/);
  const help = code("../campus/index.html");
  assert.match(help, /<kbd>E<\/kbd><\/span><strong>감정표현<\/strong>/);
  assert.match(help, /<kbd>F<\/kbd><\/span><strong>상호작용/);
  assert.match(help, /<kbd>M<\/kbd><\/span><strong>탈것/);
});

test("A. typing, a gated World (open panel / dialogue) and disabled input keep M from acting", () => {
  const r = rig(OPEN_FIELD);
  const input = new globalThis.HTMLElement();
  input.closest = () => input;
  r.key("KeyM", input);
  assert.equal(r.controller.mounted, false, "typing M in chat never mounts");
  let blocked = true;
  r.controller.setTransportGate(() => !blocked);
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "panel open: M does nothing");
  blocked = false;
  r.controller.setInputEnabled(false);
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "lobby/map input lock: M does nothing");
  r.controller.setInputEnabled(true);
  r.key("KeyM");
  assert.equal(r.controller.mounted, true);
});

// ---- B. Simultaneous interaction ----

test("B. NPC + bike: F talks, M boards the bike; neither steals the other", () => {
  const r = rig(BIKE);
  const s = slots({ coarsePointer: false });
  let talked = 0;
  s.interaction.set("npc", npcTalk(() => { talked += 1; }));
  s.transport.set("mount", r.controller.getMountContextAction());
  s.interaction.refresh(); s.transport.refresh();
  assert.equal(s.interactionButton.hidden, false);
  assert.equal(s.transportButton.hidden, false);
  assert.equal(s.interactionButton.dataset.shortcut, "F");
  assert.equal(s.transportButton.dataset.shortcut, "M");
  assert.equal(s.interactionButton.textContent, "💬 학생과 대화");
  assert.equal(s.transportButton.textContent, "🚲 자전거 타기");

  s.interaction.trigger();                      // F
  assert.equal(talked, 1);
  assert.equal(r.controller.mounted, false, "talking never mounts");
  r.key("KeyM");                                 // M
  assert.equal(r.controller.mountId, CAMPUS_BIKE_ID, "M at the bike boards the bike (not the dragon)");
  assert.equal(r.controller.mountBlocked, false);
  assert.equal(talked, 1, "boarding never talks");

  s.transport.set("mount", r.controller.getMountContextAction());
  s.transport.refresh();
  assert.equal(s.transportButton.textContent, "🚲 자전거에서 내리기");
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "M on the bike gets off");
});

test("B. coarse-pointer NPC interaction shows only 대화 while keeping the full accessible label", () => {
  const s = slots({ coarsePointer: true });
  s.interaction.set("npc", { ...npcTalk(() => {}), compactLabel: "대화" });
  s.interaction.refresh();
  assert.equal(s.interactionButton.textContent, "💬 대화");
  assert.equal(s.interactionButton.getAttribute("aria-label"), "학생과 대화");
});

test("B. M and the transport button run the same decision (getMountContextAction)", () => {
  for (const at of [BIKE, OPEN_FIELD]) {
    const byKey = rig(at);
    byKey.key("KeyM");
    const byButton = rig(at);
    const s = slots();
    s.transport.set("mount", byButton.controller.getMountContextAction());
    s.transport.refresh();
    s.transportButton.tap();
    assert.equal(byButton.controller.mountId, byKey.controller.mountId, `same result at ${at === BIKE ? "bike" : "open field"}`);
  }
});

test("B. retained transport button and M obey Combat locks and the live Explore authority", () => {
  const r = rig(OPEN_FIELD);
  const s = slots();
  const runtime = createCombatRuntimeV03();
  const inputFocus = createInputFocusManager();
  const main = code("../src/main.js");
  r.controller.setTransportGate(() => inputFocus.can("WORLD_ACTION"));
  const subscriptionStart = main.indexOf("combatRuntime.subscribe(state =>");
  const subscriptionEnd = main.indexOf("}, { emitCurrent: true });", subscriptionStart) + "}, { emitCurrent: true });".length;
  new Function("combatRuntime", "hudContext", "HUD_MODE", "controller", main.slice(subscriptionStart, subscriptionEnd))(
    runtime, { setMode() {} }, { COMBAT: "COMBAT", EXPLORE: "EXPLORE" }, r.controller);
  const slotStart = main.indexOf("// Transport has its own slot:");
  const slotEnd = main.indexOf("if (combatRuntime.active)", slotStart);
  const publish = new Function("controller", "transportActions", main.slice(slotStart, slotEnd));
  const refresh = () => { publish(r.controller, s.transport); s.transport.refresh(); };
  refresh();
  runtime.startTraining({ sourceRef: "combat.building5.training_gate", placeZoneId: "AREA_BUILDING_5_WEST" });
  r.key("KeyM");
  assert.equal(r.controller.mounted, false);
  assert.equal(s.transportButton.tap(), false, "pre-Combat callback must recheck the live lock before the next frame");
  assert.equal(r.controller.mounted, false);
  r.controller.setTransportLock("other-feature", true);
  runtime.end();
  assert.equal(r.controller.transportLocks.has("combat-v03"), false);
  assert.equal(s.transportButton.tap(), false, "ending Combat must preserve another feature's lock");
  r.controller.setTransportLock("other-feature", false);
  const claim = inputFocus.claim("panel", INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(s.transportButton.tap(), false, "button rechecks legacy gate even before its slot is refreshed");
  r.key("KeyM");
  assert.equal(r.controller.mounted, false);
  inputFocus.release(claim);
  // Position changed after rendering: activation must use the current mount offer, not the old dragon callback.
  r.move(BIKE);
  assert.equal(s.transportButton.tap(), true);
  assert.equal(r.controller.mountId, CAMPUS_BIKE_ID);
  refresh();
  assert.equal(s.transportButton.tap(), true);
  assert.equal(r.controller.mounted, false);
  r.key("KeyM");
  assert.equal(r.controller.mountId, CAMPUS_BIKE_ID, "Explore M and button still choose the same live vehicle");
});

// ---- C. Network ----

function sampleFrom(r) {
  const source = createPoseSource({ player: r.entity, controller: r.controller });
  return source.sample(1 / 60).pose;
}
function remoteAfter(packets) {
  const manager = new RemotePlayerManager({ localSessionId: "me" });
  manager.upsertPresence(buildPresence({ sessionId: "a", userId: "u-a", displayName: "상대", placeZoneId: "AREA_MAIN_GATE", joinedAt: 1 }), 0);
  let t = 0;
  for (const packet of packets) manager.receivePose("a", packet, t += 250, "AREA_MAIN_GATE");
  return manager.sample(t + 1000)[0];
}

test("C. local bike → outgoing mount=bike → remote renders the bike; dragon likewise", () => {
  const onBike = rig(BIKE);
  onBike.key("KeyM");
  const bikePose = sampleFrom(onBike);
  assert.equal(bikePose.anim, Anim.FLY, "anim stays FLY so older clients still accept the pose");
  assert.equal(bikePose.mount, Mount.BIKE);
  const bikePacket = encodePose(1, bikePose);
  assert.equal(bikePacket.mount, "bike");
  const bikeRemote = remoteAfter([bikePacket]);
  assert.equal(bikeRemote.mount, Mount.BIKE);
  assert.deepEqual(remoteMountState(bikeRemote), { mounted: true, mountId: CAMPUS_BIKE_ID });

  const onDragon = rig(OPEN_FIELD);
  onDragon.key("KeyM");
  const dragonPose = sampleFrom(onDragon);
  assert.equal(dragonPose.mount, Mount.DRAGON);
  const dragonRemote = remoteAfter([encodePose(1, dragonPose)]);
  assert.deepEqual(remoteMountState(dragonRemote), { mounted: true, mountId: DRAGON_MOUNT_ID });

  const onFoot = sampleFrom(rig(OPEN_FIELD));
  assert.equal(onFoot.mount, null);
  const footPacket = encodePose(1, onFoot);
  assert.deepEqual(Object.keys(footPacket), [...POSE_FIELDS], "walkers send exactly the old payload");
  assert.deepEqual(remoteMountState(remoteAfter([footPacket])), { mounted: false, mountId: null });

  // Remote avatar and local character share one visual rule: entity.mountKind.
  const avatar = code("../src/online/remote-avatar.js");
  assert.match(avatar, /remoteMountState\(sample\)/);
  assert.match(avatar, /entity\.mountKind = nextMountId;\s*character\.setMounted\(fly\);/);
  assert.match(code("../src/character-model.js"), /return player\.mountKind === CAMPUS_BIKE_ID;/);
});

test("C. the publisher sends at once when the mount kind changes, even with the same anim", () => {
  const publisher = new PosePublisher();
  const base = { x: 0, y: 1, z: 0, yaw: 0, anim: Anim.FLY, mount: Mount.BIKE };
  publisher.markSent(0, base);
  assert.equal(publisher.evaluate(1000, { ...base }), null);
  assert.equal(publisher.evaluate(1000, { ...base, mount: Mount.DRAGON }), "anim");
});

// ---- D. Backward compatibility ----

test("D. old payloads and odd mounts are accepted and fall back safely", () => {
  const legacy = { v: 1, seq: 1, x: 0, y: 1, z: 0, yaw: 0, vx: 0, vz: 0, anim: "fly" };
  const parsed = validatePose(legacy);
  assert.equal(parsed.ok, true);
  assert.equal("mount" in parsed.pose, false);
  assert.equal(remoteAfter([legacy]).mount, Mount.DRAGON, "FLY without mount = legacy dragon");
  assert.deepEqual(remoteMountState({ anim: Anim.FLY }), { mounted: true, mountId: DRAGON_MOUNT_ID });

  const future = { ...legacy, mount: "unicycle" };
  assert.equal(validatePose(future).ok, true, "an unknown mount never rejects the pose");
  assert.equal(validatePose(future).pose.mount, undefined);
  assert.equal(remoteAfter([future]).mount, Mount.DRAGON);
  for (const junk of [7, null, { type: "bike" }, "BIKE"]) assert.equal(validatePose({ ...legacy, mount: junk }).ok, true);

  const walking = { ...legacy, anim: "walk", mount: "bike" };
  assert.equal(validatePose(walking).pose.mount, undefined, "mount on a non-FLY pose is ignored");
  assert.equal(remoteAfter([walking]).mount, null);
  assert.equal(encodePose(1, { x: 0, y: 1, z: 0, yaw: 0, anim: Anim.WALK, mount: Mount.BIKE }).mount, undefined);

  assert.deepEqual([...POSE_OPTIONAL_FIELDS], ["mount"]);
  assert.equal(mountOf(Anim.IDLE, Mount.BIKE), null);
  assert.equal(mountOf(Anim.FLY, Mount.BIKE), Mount.BIKE);
});

// ---- Transitions ----

test("transitions: none ↔ bike ↔ dragon (incl. direct switches) render consistently", () => {
  const p = (seq, anim, mount) => ({ ...encodePose(seq, { x: 0, y: 1, z: 0, yaw: 0, anim, mount }) });
  const steps = [
    [Anim.IDLE, null, { mounted: false, mountId: null }],
    [Anim.FLY, Mount.BIKE, { mounted: true, mountId: CAMPUS_BIKE_ID }],
    [Anim.IDLE, null, { mounted: false, mountId: null }],
    [Anim.FLY, Mount.DRAGON, { mounted: true, mountId: DRAGON_MOUNT_ID }],
    [Anim.WALK, null, { mounted: false, mountId: null }],
    [Anim.FLY, Mount.BIKE, { mounted: true, mountId: CAMPUS_BIKE_ID }],
    [Anim.FLY, Mount.DRAGON, { mounted: true, mountId: DRAGON_MOUNT_ID }],
    [Anim.FLY, Mount.BIKE, { mounted: true, mountId: CAMPUS_BIKE_ID }]
  ];
  const packets = [];
  steps.forEach(([anim, mount, expected], i) => {
    packets.push(p(i + 1, anim, mount));
    assert.deepEqual(remoteMountState(remoteAfter(packets)), expected, `step ${i}: ${anim}/${mount}`);
  });

  // Interpolation never pairs one snapshot's anim with another's mount.
  const interp = new SnapshotInterpolator({ delayMs: 0 });
  interp.push({ x: 0, y: 1, z: 0, yaw: 0, anim: Anim.FLY, mount: Mount.BIKE }, 0);
  interp.push({ x: 1, y: 1, z: 0, yaw: 0, anim: Anim.IDLE }, 100);
  for (const t of [0, 25, 49, 51, 75, 100, 400]) {
    const s = interp.sample(t);
    assert.equal(s.anim === Anim.FLY, s.mount === Mount.BIKE, `t=${t}: anim ${s.anim} with mount ${s.mount}`);
  }

  // Locally a bike rider cannot jump straight to the dragon: M on the bike only gets off.
  const r = rig(BIKE);
  r.key("KeyM");
  assert.equal(r.controller.mountId, CAMPUS_BIKE_ID);
  r.move(OPEN_FIELD);
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "bike → none");
  r.key("KeyM");
  assert.equal(r.controller.mountId, DRAGON_MOUNT_ID, "none → dragon");
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "dragon (grounded) → none");
  assert.equal(wireMountFor(r.controller), null);
});

// ---- Space safety ----

test("space safety: rooms, lobby and teleports keep the existing mount policy", () => {
  const r = rig(OPEN_FIELD);
  r.controller.setMovementSpace(roomMovementSpace(ROOMS.ROOM_CLUBHOUSE_01));
  assert.equal(r.controller.getMountContextAction(), null, "no mount offer indoors");
  r.key("KeyM");
  assert.equal(r.controller.mounted, false, "M indoors does nothing");
  r.controller.setMovementSpace(CAMPUS_MOVEMENT_SPACE);
  r.key("KeyM");
  assert.equal(r.controller.mounted, true);
  // Existing policy: doors refuse a mounted player (no auto-dismount), so F cannot enter a room
  // while mounted, and M stays the way out.
  assert.match(code("../src/main.js"), /rooms\.contextAction\(\{ position: pos, grounded: controller\.grounded, mounted: controller\.mounted \}\)/);
  assert.equal(r.controller.getMountContextAction().id, "mount");
});

// ---- E. Mobile ----

test("E. mobile: separate interaction and transport buttons, shown only when useful", () => {
  const s = slots({ coarsePointer: true });
  const show = (interactionAction, transportAction) => {
    s.interaction.set("npc", interactionAction);
    s.transport.set("mount", transportAction);
    s.interaction.refresh(); s.transport.refresh();
    return [s.interactionButton.hidden ? null : s.interactionButton.textContent,
      s.transportButton.hidden ? null : s.transportButton.textContent];
  };
  const bikeAt = rig(BIKE);
  const board = bikeAt.controller.getMountContextAction();
  assert.deepEqual(show(npcTalk(() => {}), null), ["💬 학생과 대화", null], "NPC only");
  assert.deepEqual(show(null, board), [null, "🚲 타기"], "bike only (short touch label)");
  assert.equal(s.transportButton.getAttribute("aria-label"), "자전거 타기", "assistive tech keeps the full label");
  assert.deepEqual(show(npcTalk(() => {}), board), ["💬 학생과 대화", "🚲 타기"], "both at once");
  bikeAt.controller.boardBike();
  assert.deepEqual(show(null, bikeAt.controller.getMountContextAction()), [null, "🚲 내리기"], "mounted");
  assert.deepEqual(show(null, null), [null, null], "nothing to do");
  assert.equal(s.transportButton.dataset.shortcut, undefined, "touch shows no key hint");

  // Buttons are adapters: tapping runs the same action as F / M.
  let talked = 0;
  show(npcTalk(() => { talked += 1; }), rig(BIKE).controller.getMountContextAction());
  s.interactionButton.tap();
  assert.equal(talked, 1);
  s.interaction.setSuspended(true); s.transport.setSuspended(true);
  s.interaction.refresh(); s.transport.refresh();
  assert.equal(s.interactionButton.hidden && s.transportButton.hidden, true, "open panels hide both");
  assert.equal(s.interaction.trigger() || s.transport.trigger(), false, "and neither runs");

  // Layout: transport is part of the movement rail, not the shared F interaction column.
  // Touch keeps it fixed above RUN, mount-flight shifts it above the raised JUMP button, and
  // desktop keeps a compact right-bottom M slot. Context visibility never moves transport.
  const html = code("../campus/index.html");
  assert.match(html, /<button id="context-action"[^>]*hidden><\/button>\s*<button id="transport-action"[^>]*hidden><\/button>/);
  const css = code("../styles.css");
  assert.match(css, /@media \(pointer: coarse\) \{\s*#transport-action,\s*#context-action\[hidden\] \+ #transport-action \{\s*left: auto; right: max\(28px, env\(safe-area-inset-right\)\); transform: none;\s*bottom: max\(218px, calc\(env\(safe-area-inset-bottom\) \+ 176px\)\);/,
    "touch: transport is pinned directly above RUN");
  assert.match(css, /body\[data-movement-state="MOUNT_FLIGHT"\] #transport-action,\s*body\[data-movement-state="MOUNT_FLIGHT"\] #context-action\[hidden\] \+ #transport-action \{\s*bottom: max\(306px, calc\(env\(safe-area-inset-bottom\) \+ 264px\)\);/,
    "flight: transport clears the raised JUMP control");
  assert.match(css, /body\.joystick-right #transport-action,\s*body\.joystick-right #context-action\[hidden\] \+ #transport-action \{\s*left: max\(28px, env\(safe-area-inset-left\)\); right: auto;/,
    "touch action rail mirrors with joystick-right");
  assert.match(css, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?#context-action \{[\s\S]*?bottom: max\(208px,[\s\S]*?max-width: min\(148px,[\s\S]*?min-height: 44px;/s,
    "narrow touch: interaction gets its own compact row above the social cluster");
  assert.match(css, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?#run,[\s\S]*?#jump,[\s\S]*?#descend \{[\s\S]*?width: 68px;[\s\S]*?height: 68px;/s,
    "narrow touch: movement circles shrink without dropping below touch size");
  assert.match(css, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?#transport-action,[\s\S]*?#context-action\[hidden\] \+ #transport-action \{[\s\S]*?bottom: max\(190px,[\s\S]*?width: 68px;[\s\S]*?min-height: 48px;/s,
    "narrow touch: transport stays in the right rail with a compact footprint");
  assert.match(css, /body\[data-movement-state="MOUNT_FLIGHT"\] #transport-action,[\s\S]*?bottom: max\(268px,/s,
    "narrow touch: flight transport still clears the raised jump control");
  assert.match(css, /body:has\(#chat-form:not\(\[hidden\]\)\) > #context-action,[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/s,
    "typing in chat clears transient interaction buttons from the centre lane");
  assert.match(css, /@media \(pointer: fine\) and \(min-width: 700px\) \{[\s\S]*?#transport-action,\s*#context-action\[hidden\] \+ #transport-action \{\s*left: auto;\s*right: 20px;\s*transform: none;\s*bottom: 20px;/,
    "desktop: transport is a compact right-bottom M slot");
  assert.match(css, /body\[data-lobby-shell="true"\] > #transport-action,/);
  assert.match(css, /body\[data-lobby-transition="true"\] > #transport-action,/);
});

// ---- Two clients over the real World online stack (world-online → Realtime transport → NetworkManager) ----

test("two clients: A on the bike is a bike for B; B on the dragon is a dragon for A; dismounts clear", async () => {
  const { createRealtimeWorld, createWorldClient, runWorld } = await import("./support/online-world-harness.mjs");
  const world = createRealtimeWorld({ latencyMs: 40 });
  const a = createWorldClient(world, { label: "A", at: { x: 0, z: -98 } });
  const b = createWorldClient(world, { label: "B", at: { x: 2, z: -97 } });
  await runWorld(world, 2000);
  const seenBy = (viewer, other) => {
    const avatar = [...viewer.avatars.live.values()].find((x) => x.sessionId === other.online.status().sessionId);
    return avatar?.last ? remoteMountState(avatar.last) : null;
  };
  assert.deepEqual(seenBy(b, a), { mounted: false, mountId: null }, "both on foot and visible");
  assert.deepEqual(seenBy(a, b), { mounted: false, mountId: null });

  // The harness controller stands in for PlayerController: mounted + mountId is the whole state.
  Object.assign(a.local.controller, { mounted: true, mountId: CAMPUS_BIKE_ID });
  await runWorld(world, 1500);
  assert.deepEqual(seenBy(b, a), { mounted: true, mountId: CAMPUS_BIKE_ID }, "B sees A's bike, not a dragon");

  Object.assign(b.local.controller, { mounted: true, mountId: DRAGON_MOUNT_ID });
  await runWorld(world, 1500);
  assert.deepEqual(seenBy(a, b), { mounted: true, mountId: DRAGON_MOUNT_ID }, "A sees B's dragon");
  assert.deepEqual(seenBy(b, a), { mounted: true, mountId: CAMPUS_BIKE_ID }, "A is still a bike for B");

  Object.assign(a.local.controller, { mounted: false, mountId: null });
  Object.assign(b.local.controller, { mounted: false, mountId: null });
  await runWorld(world, 1500);
  assert.deepEqual(seenBy(b, a), { mounted: false, mountId: null });
  assert.deepEqual(seenBy(a, b), { mounted: false, mountId: null });
  for (const client of [a, b]) client.online.stop();
});
