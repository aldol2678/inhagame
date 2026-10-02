import test from "node:test";
import assert from "node:assert/strict";
import { findPrivateDataViolations } from "../src/network/privacy.js";
import { MAIN_HALL, createClient, createWorld, run } from "./support/online-harness.mjs";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWEiLCJlbWFpbCI6ImFAaW5oYS5lZHUifQ.c2lnbmF0dXJl";

test("scanner flags private keys and email/JWT-looking values", () => {
  assert.deepEqual(findPrivateDataViolations({ v: 1, x: 1, displayName: "인덕이" }), []);
  const found = findPrivateDataViolations({
    email: "x", nested: { access_token: "a", refreshToken: "b" }, note: "mail me a@b.co", tag: JWT
  });
  assert.equal(found.length, 5, found.join("\n"));
});

test("a full auth session passed as identity/credentials never reaches the wire", () => {
  const world = createWorld();
  // What a Supabase auth session roughly looks like; the manager must copy public fields only.
  const authUser = {
    sessionId: "sess-a", userId: "user-a", displayName: "student@inha.edu",
    email: "student@inha.edu", phone: "010-0000-0000", user_metadata: { full_name: "Real Name", student_id: "12201234" },
    access_token: JWT, refresh_token: "refresh-secret"
  };
  const credentials = { access_token: JWT, refresh_token: "refresh-secret" };
  const a = createClient(world, { label: "A", identity: authUser, credentials });
  const b = createClient(world, { label: "B" });
  for (const client of [a, b]) { client.net.setPlaceZone(MAIN_HALL); client.net.start(); }
  a.sim.input.speed = 7;
  run(world, 500);
  a.net.reportJump();
  run(world, 500);
  a.net.reportTeleport({ x: 1, y: 1.15, z: 2, yaw: 0 });
  a.net.reportEmote("wave");
  run(world, 500);

  const traffic = world.hub.wire.filter((entry) => entry.kind !== "connect");
  assert.ok(traffic.some((e) => e.kind === "presence") && traffic.some((e) => e.kind === "pose") && traffic.some((e) => e.kind === "action"));
  for (const entry of traffic) assert.deepEqual(findPrivateDataViolations(entry.payload), [], JSON.stringify(entry));
  const serialized = JSON.stringify(traffic);
  for (const secret of ["student@inha.edu", JWT, "refresh-secret", "Real Name", "12201234", "010-0000-0000"]) {
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
  }
  assert.equal(b.net.remotes.get("sess-a").displayName, "인덕이", "email-shaped display name replaced");
  assert.deepEqual(Object.keys(a.net.identity), ["sessionId", "userId", "displayName"]);
});
