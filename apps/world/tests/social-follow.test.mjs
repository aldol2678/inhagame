// Social S1-C2 · 같이 가기 (Follow).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FollowController, FollowState, FollowStopReason, followEligibility, FOLLOW_CONTEXT_PRIORITY,
  FOLLOW_START_DISTANCE_METERS, FOLLOW_STOP_DISTANCE_METERS, FOLLOW_STUCK_MS, FOLLOW_STOP_MESSAGES,
  FOLLOW_RELATIONSHIP_RECHECK_MS, FOLLOW_TELEPORT_JUMP_METERS
} from "../src/social/follow-controller.js";
import { METERS_PER_WORLD_UNIT, metersToWorld } from "../src/world-scale.js";
import { Relationship, SocialClient } from "../src/social/social-client.js";
import { createPlayerCard, FOLLOW_LABELS } from "../src/social/player-card.js";
import { selectContextAction } from "../src/context-action.js";
import { locomotionIntent } from "../src/seat-anchors.js";
import { canOccupy } from "../src/world-collision.js";
import { POSE_FIELDS, PRESENCE_FIELDS } from "../src/network/protocol.js";
import { FakeSocialServer } from "./support/fake-social-server.mjs";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "b0000000-0000-4000-8000-0000000000b2";
const B2 = "b2000000-0000-4000-8000-0000000000b2";
const ZONE = "AREA_MAIN_GATE";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const m = metersToWorld;

// FollowController with fakes: a movable local point, one remote per user, a recording assist.
function rig({ relationship = Relationship.FRIENDS, mounted = false, local = { x: 0, y: 1.15, z: -98 } } = {}) {
  const clock = { t: 0, now() { return this.t; } };
  const me = { ...local };
  const remotes = new Map([[B, { userId: B, sessionId: "s-b", placeZoneId: ZONE, presence: "present", anim: "walk", displayName: "밥", pose: { x: 0, y: 1.15, z: -98 + m(5) } }]]);
  const state = { zone: ZONE, online: true, seated: false, intent: { move: false, jump: false, mount: false }, relationship, mounted };
  const calls = [];
  const assist = { current: null, set(i) { calls.push(["set", i]); assist.current = i; }, clear() { calls.push(["clear"]); assist.current = null; } };
  const follow = new FollowController({
    clock,
    getTarget: (userId) => remotes.get(userId) ?? null,
    getLocalPosition: () => Object.freeze({ ...me }),
    getLocalPlaceZoneId: () => state.zone,
    isNetworkOnline: () => state.online,
    canFollow: (userId) => followEligibility({ userId, selfUserId: A, signedIn: true, relationship: state.relationship,
      mounted: state.mounted, target: remotes.get(userId) ?? null, localPlaceZoneId: state.zone }),
    manualIntent: () => state.intent,
    isSeated: () => state.seated,
    assist
  });
  const place = (userId, meters, dir = { x: 0, z: 1 }) => {
    const r = remotes.get(userId);
    r.pose = { x: me.x + dir.x * m(meters), y: 1.15, z: me.z + dir.z * m(meters) };
  };
  return { clock, me, remotes, state, assist, calls, follow, place };
}

test("1–5, 46. only an accepted friend who is here can be followed", () => {
  const base = { userId: B, selfUserId: A, signedIn: true, mounted: false, localPlaceZoneId: ZONE,
    target: { presence: "present", placeZoneId: ZONE, pose: { x: 0, y: 0, z: 0 } } };
  assert.deepEqual(followEligibility({ ...base, relationship: Relationship.FRIENDS }), { ok: true, reason: null });
  for (const relationship of [Relationship.NONE, Relationship.OUTGOING, Relationship.INCOMING, Relationship.BLOCKED_BY_ME, Relationship.UNAVAILABLE, null]) {
    assert.equal(followEligibility({ ...base, relationship }).reason, "not_friends", String(relationship));
  }
  assert.equal(followEligibility({ ...base, relationship: Relationship.FRIENDS, signedIn: false, selfUserId: null }).reason, "signed_out", "guest");
  assert.equal(followEligibility({ ...base, relationship: Relationship.FRIENDS, userId: A }).reason, "self");
  assert.equal(followEligibility({ ...base, relationship: Relationship.FRIENDS, mounted: true }).reason, "mounted");
  assert.equal(followEligibility({ ...base, relationship: Relationship.FRIENDS, target: null }).reason, "not_present");
  assert.equal(followEligibility({ ...base, relationship: Relationship.FRIENDS, localPlaceZoneId: "AREA_OTHER" }).reason, "other_zone");
  const r = rig({ relationship: Relationship.OUTGOING });
  assert.equal(r.follow.start(B).ok, false);
  assert.equal(r.follow.state, FollowState.IDLE);
});

test("6–10. the target is a user UUID; toggle stops; a second friend replaces the first", () => {
  const r = rig();
  const asked = [];
  const getTarget = r.follow.getTarget;
  r.follow.getTarget = (id) => { asked.push(id); return getTarget(id); };
  r.remotes.set(B2, { userId: B2, sessionId: "s-b2", placeZoneId: ZONE, presence: "present", anim: "idle", displayName: "밥", pose: { x: 3, y: 1.15, z: -98 } });
  assert.equal(r.follow.start(B2).ok, true);
  r.follow.update();
  assert.ok(asked.every((id) => id === B2), "resolved by UUID, never by the shared nickname 밥");
  assert.equal(r.follow.targetUserId, B2);
  const events = [];
  r.follow.onChange((s, reason) => events.push(reason));
  assert.equal(r.follow.start(B).ok, true, "switch to another friend");
  assert.equal(r.follow.targetUserId, B);
  assert.deepEqual(events, ["start"], "the replaced follow stops silently");
  assert.deepEqual(r.follow.toggle(B), { ok: true, following: false });
  assert.equal(r.follow.state, FollowState.IDLE);
  assert.equal(r.follow.lastStop.reason, FollowStopReason.EXPLICIT);
});

test("11–13. 2 m to start, 1.5 m to stop, hold in between (no jitter)", () => {
  assert.equal(METERS_PER_WORLD_UNIT, 2, "one shared projection scale");
  assert.equal(FOLLOW_START_DISTANCE_METERS, 2);
  assert.equal(FOLLOW_STOP_DISTANCE_METERS, 1.5);
  const r = rig();
  const at = (meters) => { r.place(B, meters); r.follow.update(); return r.follow.moving; };
  r.follow.start(B);
  assert.equal(at(1.9), false, "inside the start distance: hold");
  assert.equal(at(2.0), false, "exactly 2 m still holds");
  assert.equal(at(2.05), true, "beyond 2 m: move");
  assert.equal(at(1.8), true, "between thresholds keeps moving");
  assert.equal(at(1.51), true);
  assert.equal(at(1.5), false, "at 1.5 m: stop");
  assert.equal(at(1.9), false, "between thresholds keeps holding");
  let flips = 0; let last = r.follow.moving;
  for (let i = 0; i < 200; i += 1) { if (at(1.75 + Math.sin(i) * 0.2) !== last) { flips += 1; last = r.follow.moving; } }
  assert.equal(flips, 0, "noise inside the band never toggles");
  assert.equal(r.follow.state, FollowState.FOLLOWING);
  const set = r.calls.filter((c) => c[0] === "set").at(-1);
  assert.ok(set, "moving requests assisted movement");
});

// PlayerController under Node, with a recording entity and window listeners.
async function realController(position) {
  const listeners = {};
  globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
  globalThis.document = { getElementById: (id) => (id === "profile-panel" || id === "view-settings" ? { hidden: true } : null) };
  globalThis.HTMLElement = class { closest() { return null; } };
  const { PlayerController } = await import("../src/player-controller.js");
  const pos = { ...position };
  const writes = [];
  const entity = {
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => { writes.push({ x, y, z }); Object.assign(pos, { x, y, z }); },
    setLocalEulerAngles() {}
  };
  const controller = new PlayerController(entity);
  const key = (type, code, target = null) => { for (const fn of listeners[type] ?? []) fn({ code, target, repeat: false, preventDefault() {} }); };
  const cleanup = () => { delete globalThis.window; delete globalThis.document; delete globalThis.HTMLElement; };
  return { controller, pos, writes, key, cleanup };
}

function wire(ctl, pos, remotes, { zone = ZONE } = {}) {
  const clock = { t: 0, now() { return this.t; } };
  const follow = new FollowController({
    clock,
    getTarget: (id) => remotes.get(id) ?? null,
    getLocalPosition: () => ({ ...pos }),
    getLocalPlaceZoneId: () => zone,
    isNetworkOnline: () => true,
    canFollow: () => ({ ok: true, reason: null }),
    manualIntent: () => locomotionIntent(ctl),
    isSeated: () => false,
    assist: { set: (i) => ctl.setAssistedMovement(i), clear: () => ctl.clearAssistedMovement() }
  });
  const frame = (yaw = 0, dt = 1 / 60) => { clock.t += dt * 1000; follow.update(); ctl.update(dt, yaw); };
  return { follow, frame, clock };
}

test("14–17, 40. camera yaw (third or first person) never bends world-space steering", async () => {
  const start = { x: 0, y: 1.15, z: -98 };
  const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  for (const yawDeg of [0, 90, 180, 270]) {
    for (const d of dirs) {
      const { controller, pos, cleanup } = await realController(start);
      try {
        const target = { x: start.x + d.x * 4, y: 1.15, z: start.z + d.z * 4 };
        const remotes = new Map([[B, { userId: B, placeZoneId: ZONE, presence: "present", anim: "walk", pose: target }]]);
        const { follow, frame } = wire(controller, pos, remotes);
        follow.start(B);
        for (let i = 0; i < 10; i += 1) frame(yawDeg * Math.PI / 180);
        const moved = { x: pos.x - start.x, z: pos.z - start.z };
        const along = moved.x * d.x + moved.z * d.z;
        const across = Math.abs(moved.x * d.z - moved.z * d.x);
        assert.ok(along > 0.5, `yaw ${yawDeg} toward ${JSON.stringify(d)}: moved ${JSON.stringify(moved)}`);
        assert.ok(across < 1e-6, `yaw ${yawDeg}: no sideways drift (${across})`);
      } finally { cleanup(); }
    }
  }
  assert.doesNotMatch(code("../src/social/follow-controller.js"), /firstPerson|orbit|yaw/i, "Follow never reads the camera");
});

test("18–19. steering goes through PlayerController collision; Follow never writes the position", async () => {
  // Main hall wall between the follower and the friend: collision holds, then Follow gives up.
  const start = { x: 54.8, y: 1.15, z: -12 };
  const { controller, pos, cleanup } = await realController(start);
  try {
    const remotes = new Map([[B, { userId: B, placeZoneId: "AREA_MAIN_HALL", presence: "present", anim: "walk", pose: { x: 54.8, y: 1.15, z: 26 } }]]);
    const { follow, frame } = wire(controller, pos, remotes, { zone: "AREA_MAIN_HALL" });
    follow.start(B);
    for (let i = 0; i < 60 * 8 && follow.active; i += 1) {
      frame();
      assert.ok(canOccupy(pos), `frame ${i}: inside an obstacle at ${JSON.stringify(pos)}`);
    }
    assert.ok(!(Math.abs(pos.x - 54.8) < 3 && pos.z > -2 && pos.z < 16), "never through the building");
  } finally { cleanup(); }
  const src = code("../src/social/follow-controller.js");
  assert.doesNotMatch(src, /setLocalPosition|setPosition|\.entity|teleport\(/, "no position writes in Follow");
  assert.match(code("../src/player-controller.js"), /(?:const|let) velocityX = assisted \? this\.assist\.x \* speed/, "assist feeds the normal velocity path");
  // The only effects are assist requests.
  const r = rig();
  r.follow.start(B);
  r.place(B, 6);
  r.follow.update();
  assert.ok(r.calls.every((c) => c[0] === "set" || c[0] === "clear"));
});

test("20–24, 27–28. human input cancels; chat typing never does", async () => {
  const start = { x: 0, y: 1.15, z: -98 };
  const cases = [
    ["KeyW", FollowStopReason.MANUAL], ["KeyD", FollowStopReason.MANUAL], ["ArrowUp", FollowStopReason.MANUAL],
    ["ArrowLeft", FollowStopReason.MANUAL], ["Space", FollowStopReason.JUMP], ["KeyM", FollowStopReason.MOUNT]
  ];
  for (const [key, reason] of cases) {
    const h = await realController(start);
    try {
      const remotes = new Map([[B, { userId: B, placeZoneId: ZONE, presence: "present", anim: "walk", pose: { x: 0, y: 1.15, z: -90 } }]]);
      const { follow, frame } = wire(h.controller, h.pos, remotes);
      follow.start(B);
      frame();
      // Typing in the chat input: the controller ignores it, Follow keeps going.
      const chatInput = new globalThis.HTMLElement();
      chatInput.closest = () => chatInput;
      for (const k of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyV", "KeyE", "Digit1", "Digit2", "Space", "KeyM"]) h.key("keydown", k, chatInput);
      frame();
      assert.equal(follow.active, true, "chat keys never cancel");
      assert.equal(h.controller.mounted, false);
      h.key("keydown", key);
      frame();
      assert.equal(follow.active, false, `${key} cancels`);
      assert.equal(follow.lastStop.reason, reason, key);
      assert.equal(h.controller.assist, null, "assist cleared");
    } finally { h.cleanup(); }
  }
  // Joystick.
  const r = rig();
  const ctl = { keys: new Set(), touchVector: { x: 0, y: 0 }, jumpQueued: false, mounted: false };
  r.follow.manualIntent = () => locomotionIntent(ctl);
  r.follow.start(B);
  r.follow.update();
  ctl.touchVector.x = 0.6;
  r.follow.update();
  assert.equal(r.follow.lastStop.reason, FollowStopReason.MANUAL, "joystick cancels");
});

test("25–26. Sit and Emote end Follow; seated players stand up before following", () => {
  const r = rig();
  r.follow.start(B);
  r.state.seated = true;
  r.follow.update();
  assert.equal(r.follow.lastStop.reason, FollowStopReason.SIT);
  const main = code("../src/main.js");
  assert.match(main, /const toggleSeat = \(\) => \{\s*if \(fullMap\?\.openState \|\| rooms\?\.status\(\)\.busy \|\| furnitureEditor\?\.open\) return false;\s*if \(!seats\.isSeated && seating\.nearby\) follow\.stop\(FollowStopReason\.SIT\);\s*return seating\.toggle\(\);/);
  // F runs the interaction slot's action; the seat action sits through toggleSeat (asserted below).
  assert.match(main, /KeyF[\s\S]{0,300}interactionAction\(\);/, "F runs the interaction slot");
  assert.match(main, /const interactionAction = \(\) => \{[\s\S]{0,500}return contextActions\.trigger\(\);/, "interaction slot = the context button's action");
  assert.match(main, /trigger: \(\) => toggleSeat\(\)/, "context seat sits through toggleSeat");
  assert.match(main, /if \(follow\.stop\(FollowStopReason\.EMOTE\)\) loco\.moving = locomotionIntent\(controller\)\.move;/);
  assert.match(main, /onSelect: \(id\) => requestEmote\(id\)/, "every emote goes through requestEmote");
  assert.match(main, /onFollow: \(userId\) => \{\s*if \(seats\.isSeated\) seating\.standUp\("follow"\);\s*return follow\.start\(userId\);/);
});

test("29–31. target leaves, changes Place Zone, or we change Place Zone → stop", () => {
  for (const [mutate, reason] of [
    [(r) => r.remotes.delete(B), FollowStopReason.TARGET_LEFT],
    [(r) => { r.remotes.get(B).presence = "suspect"; }, FollowStopReason.TARGET_LEFT],
    [(r) => { r.remotes.get(B).placeZoneId = "AREA_MAIN_HALL"; }, FollowStopReason.TARGET_ZONE],
    [(r) => { r.state.zone = "AREA_MAIN_HALL"; }, FollowStopReason.LOCAL_ZONE],
    [(r) => { r.state.online = false; }, FollowStopReason.OFFLINE]
  ]) {
    const r = rig();
    r.follow.start(B);
    r.follow.update();
    mutate(r);
    r.follow.update();
    assert.equal(r.follow.lastStop?.reason, reason);
    assert.equal(r.assist.current, null);
  }
});

test("32–33. friendship removed or blocked: stop at once (and on the periodic DB re-check)", async () => {
  const server = new FakeSocialServer([{ userId: A, nickname: "앨리스" }, { userId: B, nickname: "밥돌" }]);
  const a = new SocialClient({ getClient: () => server.clientFor(A), getSelfUserId: () => A });
  const b = new SocialClient({ getClient: () => server.clientFor(B), getSelfUserId: () => B });
  await a.request(B); await b.accept(A);
  await a.mine();
  assert.equal(a.relationshipOf(B), Relationship.FRIENDS);
  for (const [op, reason] of [["remove", FollowStopReason.RELATIONSHIP], ["block", FollowStopReason.BLOCKED]]) {
    const r = rig();
    r.follow.canFollow = (id) => followEligibility({ userId: id, selfUserId: A, signedIn: true, relationship: a.relationshipOf(id),
      target: r.remotes.get(id), localPlaceZoneId: ZONE });
    // Same wiring as main.js.
    const off = a.onRelationshipChange((userId, state) => {
      if (!r.follow.isFollowing(userId) || state === Relationship.FRIENDS) return;
      r.follow.stop(state === Relationship.BLOCKED_BY_ME ? FollowStopReason.BLOCKED : FollowStopReason.RELATIONSHIP);
    });
    assert.equal(r.follow.start(B).ok, true);
    await a[op](B);
    assert.equal(r.follow.lastStop.reason, reason, op);
    off();
    if (op === "remove") { await a.request(B); await b.accept(A); await a.mine(); }
  }
  assert.match(code("../src/main.js"), /social\.onRelationshipChange\(\(userId, state\) => \{\s*if \(!follow\.isFollowing\(userId\) \|\| state === Relationship\.FRIENDS\) return;/);
  // The other side ends it: the low-frequency database re-check catches it.
  const r = rig();
  let friends = true;
  r.follow.checkRelationship = async () => friends;
  r.follow.start(B);
  r.place(B, 1); // standing together, so only the re-check can end it
  r.clock.t += FOLLOW_RELATIONSHIP_RECHECK_MS + 1;
  r.follow.update(); await flush();
  assert.equal(r.follow.active, true);
  friends = false;
  r.clock.t += FOLLOW_RELATIONSHIP_RECHECK_MS + 1;
  r.follow.update(); await flush();
  assert.equal(r.follow.lastStop.reason, FollowStopReason.RELATIONSHIP);
});

test("34. a TELEPORT action or a large single-step jump of the friend stops Follow (never teleports us)", () => {
  const r = rig();
  r.follow.start(B);
  r.follow.update();
  r.follow.notifyTeleport(B);
  r.follow.update();
  assert.equal(r.follow.lastStop.reason, FollowStopReason.TELEPORT);
  const s = rig();
  s.follow.start(B);
  s.place(B, 5); s.follow.update();
  s.place(B, 5 + FOLLOW_TELEPORT_JUMP_METERS * 0.9); s.follow.update();
  assert.equal(s.follow.active, true, "fast but continuous is fine");
  s.place(B, 5 + FOLLOW_TELEPORT_JUMP_METERS * 2.1); s.follow.update();
  assert.equal(s.follow.lastStop.reason, FollowStopReason.TELEPORT);
  assert.deepEqual(s.me, { x: 0, y: 1.15, z: -98 }, "the follower stays where it is");
});

test("38. stuck against an obstacle: stop after the timeout with a short message", () => {
  const r = rig();
  const events = [];
  r.follow.onChange((_s, reason) => events.push(reason));
  r.follow.start(B);
  r.place(B, 10);
  for (let t = 0; t < FOLLOW_STUCK_MS - 100; t += 50) { r.clock.t += 50; r.follow.update(); }
  assert.equal(r.follow.active, true, "not before the timeout");
  r.clock.t += 200; r.follow.update();
  assert.equal(r.follow.lastStop.reason, FollowStopReason.STUCK);
  assert.equal(events.at(-1), "stuck");
  assert.equal(FOLLOW_STOP_MESSAGES.stuck, "길이 막혀 같이 가기를 멈췄어요.");
  assert.ok(Object.values(FOLLOW_STOP_MESSAGES).every((t) => !/차단/.test(t)), "never reveals a block");
  // Progress resets the timer.
  const p = rig();
  p.follow.start(B); p.place(B, 10);
  for (let i = 0; i < 100; i += 1) { p.clock.t += 50; p.me.z += m(0.3); p.place(B, 10); p.follow.update(); }
  assert.equal(p.follow.active, true);
});

test("speed: walk for a modest gap, sprint when the friend runs or the gap is large", () => {
  const r = rig();
  r.follow.start(B);
  r.remotes.get(B).anim = "walk";
  r.place(B, 4); r.follow.update();
  assert.equal(r.assist.current.sprint, false);
  r.remotes.get(B).anim = "run";
  r.place(B, 4.1); r.follow.update();
  assert.equal(r.assist.current.sprint, true);
  r.remotes.get(B).anim = "walk";
  r.place(B, 12); r.follow.update();
  assert.equal(r.assist.current.sprint, true, "catch up with the normal sprint speed");
  assert.match(code("../src/player-controller.js"), /const walkSpeed = sprint \? this\.sprintSpeed : this\.walkSpeed;/);
  assert.match(code("../src/player-controller.js"), /const speed = this\.mounted \? \(sprint \? mountBoost : mountCruise\) : walkSpeed;/);
});

test("29, 35–37. live harness: follow over Realtime, logout, outage without auto-resume, reload by user id", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: { x: 0, z: -98 } });
  const b = createWorldClient(world, { label: "B", at: { x: 0, z: -94 } });
  await runWorld(world, 1500);
  const follow = new FollowController({
    clock: world.scheduler,
    getTarget: (id) => a.online.remoteByUser(id),
    getLocalPosition: () => ({ ...a.local.pos }),
    getLocalPlaceZoneId: () => a.online.network?.placeZoneId ?? null,
    isNetworkOnline: () => a.online.network?.isOnline === true && a.online.network.zoneSynced === true,
    canFollow: (id) => followEligibility({ userId: id, selfUserId: "user-a", signedIn: true, relationship: Relationship.FRIENDS,
      target: a.online.remoteByUser(id), localPlaceZoneId: a.online.network?.placeZoneId }),
    manualIntent: () => locomotionIntent(a.local.controller),
    assist: {
      set: ({ x, z, sprint }) => { a.local.input = { speed: sprint ? 12 : 7, heading: Math.atan2(x, z) * 180 / Math.PI }; },
      clear: () => { a.local.input = { ...a.local.input, speed: 0 }; }
    }
  });
  a.online.onRemoteTeleport((id) => follow.notifyTeleport(id));
  const onFrame = (client) => { if (client === a) follow.update(); };
  const gap = () => Math.hypot(a.local.pos.x - b.local.pos.x, a.local.pos.z - b.local.pos.z) * METERS_PER_WORLD_UNIT;

  const target = a.online.remoteByUser("user-b");
  assert.equal(target.sessionId, "b-session-1");
  assert.ok(Object.isFrozen(target) && Object.isFrozen(target.pose), "read-only remote view");
  assert.equal(follow.start("user-b").ok, true);
  b.local.input = { speed: 3, heading: 0 };
  await runWorld(world, 1500, { onFrame });
  b.local.input = { speed: 0, heading: 0 };
  await runWorld(world, 2500, { onFrame });
  assert.equal(follow.active, true);
  assert.ok(a.local.pos.z > -97, `A followed north (${a.local.pos.z})`);
  assert.ok(gap() <= FOLLOW_START_DISTANCE_METERS + 0.6 && gap() >= FOLLOW_STOP_DISTANCE_METERS - 0.8, `settled at a social distance: ${gap().toFixed(2)} m`);
  assert.ok(!world.server.wire?.some?.((w) => /follow/i.test(JSON.stringify(w.payload ?? w))), "nothing about Follow on the wire");

  // 37. B reloads: a newer session for the same user supersedes the old one where B stands.
  const b2 = createWorldClient(world, { label: "B2", user: { id: "user-b", is_anonymous: false }, nickname: "DuckB", at: { x: b.local.pos.x, z: b.local.pos.z } });
  b2.local.pos = { ...b.local.pos };
  await runWorld(world, 1500, { onFrame });
  b.online.stop(); b.active = false;
  await runWorld(world, 1500, { onFrame });
  assert.equal(follow.active, true, "still following after the reload");
  assert.equal(a.online.remoteByUser("user-b").sessionId, "b2-session-1", "resolved by user id to the new session");

  // 29. B logs out.
  b2.online.stop(); b2.active = false;
  await runWorld(world, 3000, { onFrame });
  assert.equal(follow.active, false);
  assert.equal(follow.lastStop.reason, FollowStopReason.TARGET_LEFT);

  // 35–36. Our connection drops: stop; recovery never restarts it.
  const c = createWorldClient(world, { label: "C", user: { id: "user-b", is_anonymous: false }, at: { x: a.local.pos.x, z: a.local.pos.z + 4 } });
  await runWorld(world, 1500, { onFrame });
  assert.equal(follow.start("user-b").ok, true);
  world.server.setOnline(false);
  await runWorld(world, 1500, { onFrame });
  assert.equal(follow.lastStop.reason, FollowStopReason.OFFLINE);
  world.server.setOnline(true);
  await runWorld(world, 8000, { onFrame });
  assert.equal(a.online.status().state, "ONLINE");
  assert.equal(follow.active, false, "no automatic resume after reconnect");

  // 34 over the wire: a TELEPORT action.
  assert.equal(follow.start("user-b").ok, true);
  c.online.network.reportTeleport({ x: c.local.pos.x, y: 1.15, z: c.local.pos.z, yaw: 0 });
  await runWorld(world, 500, { onFrame });
  assert.equal(follow.lastStop.reason, FollowStopReason.TELEPORT);
  assert.deepEqual([...POSE_FIELDS], ["v", "seq", "x", "y", "z", "yaw", "vx", "vz", "anim"], "48. no Follow field in pose");
  assert.deepEqual([...PRESENCE_FIELDS], ["v", "sessionId", "userId", "displayName", "placeZoneId", "joinedAt"], "48. no Follow field in presence");
});

test("21 (card). Player Inspect: 같이 가기 only for friends; stop / switch labels; UUID target", async () => {
  const server = new FakeSocialServer([{ userId: A, nickname: "앨리스" }, { userId: B, nickname: "밥" }, { userId: B2, nickname: "밥" }]);
  const a = new SocialClient({ getClient: () => server.clientFor(A), getSelfUserId: () => A });
  const b2 = new SocialClient({ getClient: () => server.clientFor(B2), getSelfUserId: () => B2 });
  await a.request(B2); await b2.accept(A);
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  const following = { id: null, mounted: false };
  const asked = [];
  const card = createPlayerCard({ panel, social: a, doc, getSelfUserId: () => A,
    getRemote: (sid) => ({ "s-b": { userId: B, displayName: "밥" }, "s-b2": { userId: B2, displayName: "밥" } })[sid] ?? null,
    follow: {
      canFollow: () => (following.mounted ? { ok: false, reason: "mounted" } : { ok: true, reason: null }),
      isFollowing: (id) => following.id === id, isFollowingAnyone: () => following.id !== null,
      onFollow: (id) => { asked.push(id); following.id = id; return { ok: true }; },
      onStopFollow: () => { following.id = null; }
    } });
  const buttons = () => { const out = []; const walk = (n) => { if (n.tagName === "BUTTON") out.push(n); n.children.forEach(walk); }; walk(panel); return out; };
  const labels = () => buttons().map((x) => x.textContent).filter((l) => l !== "×");
  await card.open("s-b");
  assert.ok(!labels().includes(FOLLOW_LABELS.start), "not a friend: no 같이 가기");
  await card.open("s-b2");
  assert.deepEqual(labels(), [FOLLOW_LABELS.start, "친구 삭제", "차단", "신고"]);
  buttons().find((x) => x.textContent === FOLLOW_LABELS.start).click();
  assert.deepEqual(asked, [B2], "the Presence user id, never the shared nickname");
  assert.equal(panel.hidden, true, "the card closes once Follow starts");
  await card.open("s-b2");
  assert.equal(labels()[0], FOLLOW_LABELS.stop, "■ 같이 가기 중지 for the current target");
  buttons().find((x) => x.textContent === FOLLOW_LABELS.stop).click();
  assert.equal(following.id, null);
  following.id = "someone-else";
  card.refresh();
  assert.equal(labels()[0], FOLLOW_LABELS.switch, "👣 이 친구 따라가기 while following someone else");
  following.id = null; following.mounted = true;
  card.refresh();
  assert.equal(buttons().find((x) => x.textContent === FOLLOW_LABELS.start).disabled, true, "mounted: disabled");
});

test("41–45. Context Action: one shared slot; dialogue > seat > Follow stop > mount; no new button", () => {
  assert.ok(FOLLOW_CONTEXT_PRIORITY < 260 && FOLLOW_CONTEXT_PRIORITY > 120);
  assert.match(read("../npc-factory/dev-runtime.mjs"), /priority: 300/, "NPC dialogue stays highest");
  const follow = { id: "follow", label: "친구 따라가기 중지", priority: FOLLOW_CONTEXT_PRIORITY };
  const mount = { id: "mount", label: "탈것 탑승", priority: 100 };
  const mounted = { id: "mount", label: "탈것에서 내리기", priority: 120 };
  const seat = { id: "seat", label: "앉기", priority: 260, distance: 1 };
  const npc = { id: "npc", label: "대화하기", priority: 300 };
  assert.equal(selectContextAction([mount, follow]).id, "follow", "Follow stop outranks mount");
  assert.equal(selectContextAction([mounted, follow]).id, "follow");
  assert.equal(selectContextAction([follow, seat, mount]).id, "seat", "seat outranks Follow stop");
  assert.equal(selectContextAction([follow, seat, npc, mount]).id, "npc", "dialogue stays first");
  const main = code("../src/main.js");
  assert.match(main, /contextActions\.set\("follow", follow\.active \? \{\s*icon: "👣", label: "친구 따라가기 중지", priority: FOLLOW_CONTEXT_PRIORITY, pressed: true,\s*trigger: \(\) => follow\.stop\(FollowStopReason\.EXPLICIT\)\s*\} : null\);/);
  assert.doesNotMatch(main.match(/contextActions\.set\("follow"[\s\S]*?\);/)[0], /shortcut/, "no desktop shortcut text");
  const html = read("../campus/index.html");
  assert.doesNotMatch(html, /<button[^>]*(follow|같이)/i, "no permanent Follow button");
  assert.match(html, /<p id="follow-status" class="follow-status" role="status" aria-live="polite" hidden><\/p>/);
  assert.doesNotMatch(code("../src/social/follow-controller.js"), /createElement|document\./, "Follow creates no UI");
  assert.doesNotMatch(main, /createElement\("button"\)/);
});

test("39, 47. no persistence, no view-distance coupling", () => {
  const src = code("../src/social/follow-controller.js");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|\.rpc\(|\.from\(/, "Follow stores nothing");
  assert.doesNotMatch(src, /RC_|renderChunk|streaming|viewDistance/i, "render chunks and view distance play no part");
  const migrations = readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).map((f) => read(`../../../supabase/migrations/${f}`)).join("\n");
  assert.doesNotMatch(migrations, /create table[^;]*follow|add column[^;]*follow|world_follow/i, "no Follow table or column");
  for (const file of ["../src/network/protocol.js", "../src/network/network-manager.js", "../src/online/pose-source.js"]) {
    assert.doesNotMatch(code(file), /follow/i, file);
  }
});

