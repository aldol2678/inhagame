import test from "node:test";
import assert from "node:assert/strict";
import { RemotePlayerManager, RemotePresence } from "../src/network/remote-player-manager.js";
import { ActionType, Anim, buildPresence, encodeAction, encodePose } from "../src/network/protocol.js";

const MAIN_HALL = "AREA_MAIN_HALL";
const AGORA = "AREA_AGORA_6_9";
const STUDENT_CENTER = "AREA_INKYUNG_STUDENT_CENTER";

const presence = (sessionId, userId, placeZoneId = MAIN_HALL, joinedAt = 1000) =>
  buildPresence({ sessionId, userId, displayName: `Duck${sessionId.slice(-1)}`, placeZoneId, joinedAt });
const pose = (seq, x = 0, extra = {}) => encodePose(seq, { x, y: 1.15, z: 0, yaw: 0, anim: Anim.WALK, ...extra });

function manager() {
  const events = [];
  const remotes = new RemotePlayerManager({ localSessionId: "sess-me", localUserId: "user-me" });
  remotes.onEvent((event) => events.push(`${event.type}:${event.player.sessionId}${event.reason ? `:${event.reason}` : ""}`));
  return { remotes, events };
}

test("presence lifecycle: joined, updated, left", () => {
  const { remotes, events } = manager();
  remotes.upsertPresence(presence("sess-a", "user-a"), 0);
  remotes.upsertPresence({ ...presence("sess-a", "user-a"), displayName: "NewName" }, 10);
  assert.equal(remotes.get("sess-a").displayName, "NewName");
  remotes.removePresence("sess-a");
  assert.equal(remotes.removePresence("sess-a"), null, "second leave is a no-op");
  assert.deepEqual(events, ["playerJoined:sess-a", "playerUpdated:sess-a", "playerLeft:sess-a:left"]);
});

test("the local player never becomes a remote player", () => {
  const { remotes, events } = manager();
  assert.equal(remotes.upsertPresence(presence("sess-me", "user-me"), 0), null);
  assert.equal(remotes.upsertPresence(presence("sess-old-tab", "user-me"), 0), null, "own other session is a ghost of self");
  assert.equal(remotes.receivePose("sess-me", pose(1), 0).reason, "self");
  assert.equal(remotes.size, 0);
  assert.deepEqual(events, []);
  assert.equal(remotes.stats.presenceSelf, 2);
});

test("same session is never duplicated, and re-sync after reconnect reconciles", () => {
  const { remotes } = manager();
  for (let i = 0; i < 5; i += 1) remotes.upsertPresence(presence("sess-a", "user-a"), i);
  assert.equal(remotes.size, 1);
  remotes.upsertPresence(presence("sess-b", "user-b"), 0);
  remotes.markAllSuspect();
  assert.ok(remotes.list().every((p) => p.presence === RemotePresence.SUSPECT));
  // After reconnect the zone sync says A is still here, B left while we were away.
  remotes.reconcileZone(MAIN_HALL, [presence("sess-a", "user-a"), presence("sess-me", "user-me")], 100);
  assert.deepEqual(remotes.list().map((p) => [p.sessionId, p.presence]), [["sess-a", RemotePresence.PRESENT]]);
});

test("a reloaded client (new session, same user) replaces its ghost instead of duplicating", () => {
  const { remotes, events } = manager();
  remotes.upsertPresence(presence("sess-a1", "user-a", MAIN_HALL, 1000), 0);
  remotes.upsertPresence(presence("sess-a2", "user-a", MAIN_HALL, 5000), 10);
  assert.deepEqual(remotes.list().map((p) => p.sessionId), ["sess-a2"]);
  // The stale ghost's late presence echo must not bring it back.
  assert.equal(remotes.upsertPresence(presence("sess-a1", "user-a", MAIN_HALL, 1000), 20), null);
  assert.deepEqual(remotes.list().map((p) => p.sessionId), ["sess-a2"]);
  assert.deepEqual(events, ["playerJoined:sess-a1", "playerLeft:sess-a1:superseded", "playerJoined:sess-a2"]);
});

test("pose sequence ordering: stale, duplicate, reordered and malformed are ignored", () => {
  const { remotes } = manager();
  remotes.upsertPresence(presence("sess-a", "user-a"), 0);
  assert.ok(remotes.receivePose("sess-a", pose(1, 1), 0).accepted);
  assert.ok(remotes.receivePose("sess-a", pose(3, 3), 250).accepted);
  assert.equal(remotes.receivePose("sess-a", pose(2, 2), 260).reason, "stale", "late reordered packet");
  assert.equal(remotes.receivePose("sess-a", pose(3, 3), 270).reason, "duplicate");
  assert.equal(remotes.receivePose("sess-a", { ...pose(4), x: NaN }, 280).reason, "non_finite");
  assert.equal(remotes.receivePose("sess-a", { ...pose(4), v: 99 }, 280).reason, "unsupported_version");
  assert.equal(remotes.get("sess-a").latestPose.x, 3);
  assert.equal(remotes.get("sess-a").lastSeq, 3);
  const { poseAccepted, poseStale, poseDuplicate, poseInvalid } = remotes.stats;
  assert.deepEqual({ poseAccepted, poseStale, poseDuplicate, poseInvalid }, { poseAccepted: 2, poseStale: 1, poseDuplicate: 1, poseInvalid: 2 });
});

test("pose from another place zone is ignored", () => {
  const { remotes } = manager();
  remotes.upsertPresence(presence("sess-a", "user-a", AGORA), 0);
  assert.equal(remotes.receivePose("sess-a", pose(1), 0, MAIN_HALL).reason, "wrong_zone");
});

test("a pose that races ahead of its presence join is applied on join", () => {
  const { remotes } = manager();
  assert.equal(remotes.receivePose("sess-a", pose(7, 4), 100, MAIN_HALL).reason, "unknown_session");
  remotes.upsertPresence(presence("sess-a", "user-a"), 150);
  assert.equal(remotes.get("sess-a").latestPose.x, 4);
  // Too old orphans are dropped.
  remotes.receivePose("sess-b", pose(1, 9), 0, MAIN_HALL);
  remotes.upsertPresence(presence("sess-b", "user-b"), 5000);
  assert.equal(remotes.get("sess-b").latestPose, null);
});

test("jump action shows immediately; teleport snaps and discards older poses", () => {
  const { remotes } = manager();
  remotes.upsertPresence(presence("sess-a", "user-a"), 0);
  remotes.receivePose("sess-a", pose(1, 0, { anim: Anim.IDLE }), 0);
  assert.ok(remotes.receiveAction("sess-a", encodeAction(0, ActionType.JUMP), 1000).accepted);
  assert.equal(remotes.sample(1010)[0].anim, Anim.AIR, "no pose needed for the jump");
  assert.equal(remotes.sample(1700)[0].anim, Anim.IDLE, "jump visual expires");
  assert.equal(remotes.receiveAction("sess-a", encodeAction(0, ActionType.JUMP), 1100).reason, "duplicate");

  remotes.receiveAction("sess-a", encodeAction(1, ActionType.TELEPORT, { x: 80, y: 1.15, z: 40, yaw: 90, poseSeq: 5 }), 2000);
  const state = remotes.sample(2001)[0].pose;
  assert.deepEqual([state.x, state.z], [80, 40]);
  assert.equal(remotes.receivePose("sess-a", pose(4, 0), 2010).reason, "stale", "pre-teleport pose cannot drag back");
  assert.ok(remotes.receivePose("sess-a", pose(5, 80.5), 2020).accepted);
  remotes.receiveAction("sess-a", encodeAction(2, ActionType.EMOTE, { emote: "wave" }), 2030);
  assert.equal(remotes.get("sess-a").lastEmote.emote, "wave");
});

test("clearZone, retainZone and clearAll", () => {
  const { remotes } = manager();
  remotes.upsertPresence(presence("sess-a", "user-a", MAIN_HALL), 0);
  remotes.upsertPresence(presence("sess-b", "user-b", AGORA), 0);
  remotes.upsertPresence(presence("sess-c", "user-c", STUDENT_CENTER), 0);
  remotes.clearZone(MAIN_HALL);
  assert.deepEqual(remotes.list().map((p) => p.sessionId), ["sess-b", "sess-c"]);
  remotes.retainZone(AGORA);
  assert.deepEqual(remotes.list().map((p) => p.sessionId), ["sess-b"]);
  remotes.clearAll();
  assert.equal(remotes.size, 0);
});
