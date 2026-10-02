import test from "node:test";
import assert from "node:assert/strict";
import {
  ActionType, Anim, DEFAULT_DISPLAY_NAME, POSE_FIELDS, PRESENCE_FIELDS, PROTOCOL_VERSION,
  buildPresence, classifyAnim, encodeAction, encodePose, normalizeYaw, placeZoneTopic,
  validateAction, validatePose, validatePresence, PRESENCE_OPTIONAL_FIELDS, GUEST_ACTION_TYPES, guestDisplayName, isGuestAction
} from "../src/network/protocol.js";

const pose = (overrides = {}) => ({ v: PROTOCOL_VERSION, seq: 3, x: 1, y: 1.15, z: 2, yaw: 90, vx: 0, vz: 7, anim: Anim.WALK, ...overrides });

test("pose packet carries exactly the Notion minimum fields", () => {
  const packet = encodePose(5, { x: 1.23456, y: 1.15, z: -3.333, yaw: 190, vx: 0.004, vz: -6.999, anim: Anim.RUN });
  assert.deepEqual(Object.keys(packet), [...POSE_FIELDS]);
  assert.deepEqual(packet, { v: 1, seq: 5, x: 1.23, y: 1.15, z: -3.33, yaw: -170, vx: 0, vz: -7, anim: "run" });
  assert.ok(validatePose(packet).ok);
});

test("pose validation rejects malformed, unsupported, non-finite and missing values", () => {
  assert.ok(validatePose(pose()).ok);
  for (const [packet, reason] of [
    [null, "malformed"], [[], "malformed"], ["pose", "malformed"],
    [pose({ v: 2 }), "unsupported_version"], [pose({ v: undefined }), "unsupported_version"],
    [pose({ seq: -1 }), "malformed"], [pose({ seq: 1.5 }), "malformed"], [pose({ seq: "1" }), "malformed"],
    [pose({ x: NaN }), "non_finite"], [pose({ z: Infinity }), "non_finite"], [pose({ yaw: -Infinity }), "non_finite"],
    [pose({ vx: NaN }), "non_finite"], [pose({ y: "1" }), "non_finite"], [pose({ x: 1e9 }), "non_finite"],
    [pose({ anim: "moonwalk" }), "malformed"]
  ]) {
    assert.deepEqual(validatePose(packet), { ok: false, reason }, JSON.stringify(packet));
  }
  for (const key of ["x", "y", "z", "yaw", "vx", "vz"]) {
    const packet = pose();
    delete packet[key];
    assert.equal(validatePose(packet).reason, "missing_field", key);
  }
});

test("validated pose drops unknown fields", () => {
  const result = validatePose({ ...pose(), email: "a@b.co", extra: 1 });
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.pose), [...POSE_FIELDS]);
});

test("actions: jump, teleport and emote placeholder contracts", () => {
  const jump = encodeAction(0, ActionType.JUMP);
  assert.deepEqual(jump, { v: 1, id: 0, type: "jump", payload: {} });
  assert.ok(validateAction(jump).ok);
  const teleport = encodeAction(1, ActionType.TELEPORT, { x: 10.006, y: 1.15, z: 3, yaw: 270, poseSeq: 12 });
  assert.deepEqual(validateAction(teleport).action.payload, { x: 10.01, y: 1.15, z: 3, yaw: -90, poseSeq: 12 });
  assert.ok(validateAction(encodeAction(2, ActionType.EMOTE, { emote: "wave" })).ok);

  assert.equal(validateAction({ v: 1, id: 1, type: "attack", payload: {} }).reason, "unknown_action");
  assert.equal(validateAction({ v: 9, id: 1, type: "jump", payload: {} }).reason, "unsupported_version");
  assert.equal(validateAction({ v: 1, id: -1, type: "jump", payload: {} }).reason, "malformed");
  assert.equal(validateAction(encodeAction(3, ActionType.TELEPORT, { x: NaN, y: 0, z: 0, yaw: 0, poseSeq: 1 })).reason, "malformed");
  assert.equal(validateAction(encodeAction(3, ActionType.EMOTE, { emote: "<script>" })).reason, "malformed");
  // Jump payload extras are discarded, not forwarded.
  assert.deepEqual(validateAction({ v: 1, id: 4, type: "jump", payload: { token: "x" } }).action.payload, {});
});

test("presence is allowlisted and display names follow the campus nickname rule", () => {
  const session = {
    sessionId: "sess-1", userId: "4f1c2a9e-0000-4000-8000-000000000001", displayName: "인덕이123",
    placeZoneId: "AREA_MAIN_HALL", joinedAt: 1000,
    email: "student@inha.edu", access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", refresh_token: "r-1",
    user_metadata: { phone: "010" }
  };
  const presence = buildPresence(session);
  assert.deepEqual(Object.keys(presence), [...PRESENCE_FIELDS]);
  assert.equal(presence.displayName, "인덕이123");
  assert.equal(buildPresence({ ...session, displayName: "student@inha.edu" }).displayName, DEFAULT_DISPLAY_NAME);
  assert.equal(buildPresence({ ...session, displayName: undefined }).displayName, DEFAULT_DISPLAY_NAME);
  assert.ok(validatePresence(presence).ok);
  assert.equal(validatePresence({ ...presence, placeZoneId: "../etc" }).ok, false);
  assert.equal(validatePresence({ ...presence, sessionId: "" }).ok, false);
  assert.equal(validatePresence({ ...presence, v: 0 }).reason, "unsupported_version");
});

test("yaw normalisation, anim classification and zone topic", () => {
  assert.equal(normalizeYaw(190), -170);
  assert.equal(normalizeYaw(-190), 170);
  assert.equal(normalizeYaw(540), 180);
  assert.equal(normalizeYaw(-180), 180);
  assert.equal(classifyAnim({ moving: false }), Anim.IDLE);
  assert.equal(classifyAnim({ moving: true }), Anim.WALK);
  assert.equal(classifyAnim({ moving: true, sprint: true }), Anim.RUN);
  assert.equal(classifyAnim({ moving: true, sprint: true, grounded: false }), Anim.AIR);
  assert.equal(classifyAnim({ mounted: true, grounded: false }), Anim.FLY);
  assert.equal(placeZoneTopic("AREA_AGORA_6_9"), "world:campus:AREA_AGORA_6_9");
  assert.throws(() => placeZoneTopic("area:*"));
  assert.throws(() => placeZoneTopic("RC_0_0"), "render chunks are never channels");
  assert.throws(() => placeZoneTopic("AREA_main"), "topic grammar matches the RLS policy");
});

test("guest presence: name derived from the session, flag strict, members unchanged", () => {
  const base = { v: 1, sessionId: "a1b2c3d4-0000-4000-8000-00000000beef", userId: "anon-1", placeZoneId: "AREA_MAIN_HALL", joinedAt: 5 };
  const guest = validatePresence({ ...base, displayName: "관리자", guest: true });
  assert.equal(guest.ok, true);
  assert.equal(guest.presence.displayName, guestDisplayName(base.sessionId));
  assert.equal(guest.presence.displayName, "게스트 BEEF", "a guest cannot choose a member nickname");
  assert.equal(guest.presence.guest, true);
  assert.deepEqual(Object.keys(guest.presence), [...PRESENCE_FIELDS, "guest"], "a guest never carries equipment");
  assert.deepEqual([...PRESENCE_OPTIONAL_FIELDS], ["guest", "equipment"]);
  // Only the literal true marks a guest; members keep the exact P0 presence shape.
  for (const flag of ["true", 1, false, undefined]) {
    const member = validatePresence({ ...base, displayName: "오리친구", guest: flag }).presence;
    assert.deepEqual(Object.keys(member), [...PRESENCE_FIELDS]);
    assert.equal(member.displayName, "오리친구");
  }
  assert.equal(guestDisplayName("--"), "게스트");
  assert.deepEqual([...GUEST_ACTION_TYPES], [ActionType.JUMP, ActionType.TELEPORT]);
  assert.equal(isGuestAction(ActionType.CHAT), false);
  assert.equal(isGuestAction(ActionType.EMOTE), false);
});
