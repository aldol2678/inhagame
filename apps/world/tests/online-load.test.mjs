// Packet and bandwidth budget for Online P0, measured on the fake transport (Notion §12 follow-up load check).
// Bytes are JSON payloads ({ sid, p }) only; real Realtime framing adds roughly 80–120 B per message.
import test from "node:test";
import assert from "node:assert/strict";
import { MAIN_HALL, RUN_SPEED, WALK_SPEED, createClient, createWorld, remoteIds, run } from "./support/online-harness.mjs";

const SECONDS = 60;
const CAPACITY_SECONDS = 2;
const REALISTIC_NETWORK = { latencyMs: 60, jitterMs: 80, lossRate: 0.01, duplicateRate: 0.02, seed: 7 };
const CAPACITY_NETWORK = { latencyMs: 0, jitterMs: 0, lossRate: 0, duplicateRate: 0, seed: 7 };
const REALTIME_PLAN_EVENTS_PER_SEC = Object.freeze({ pro: 500, proNoSpendCap: 2500 });

const BEHAVIOURS = {
  idle: { input: { speed: 0, heading: 0, turnRate: 0 } },
  walk: { input: { speed: WALK_SPEED, heading: 0, turnRate: 0 }, turnEveryMs: 5000 },
  runTurn: { input: { speed: RUN_SPEED, heading: 0, turnRate: 45 }, jumpEveryMs: 3000 }
};

function simulate(behaviours, network = REALISTIC_NETWORK, seconds = SECONDS) {
  const world = createWorld(network);
  const clients = behaviours.map((name, i) => {
    const client = createClient(world, { label: `P${i}`, position: { x: i * 3, z: 0 } });
    client.behaviour = BEHAVIOURS[name];
    client.nextTurn = client.behaviour.turnEveryMs;
    client.nextJump = client.behaviour.jumpEveryMs;
    client.net.setPlaceZone(MAIN_HALL);
    client.net.start();
    return client;
  });
  run(world, 1000);
  for (const client of clients) client.sim.input = { ...client.behaviour.input };
  const start = world.scheduler.now();
  let jumps = 0;
  const hub = world.hub.metrics;
  const base = { pose: { ...hub.pose }, action: { ...hub.action } };
  run(world, seconds * 1000, {
    onFrame(client, now) {
      const elapsed = now - start;
      if (client.nextTurn && elapsed >= client.nextTurn) { client.sim.input.heading += 90; client.nextTurn += client.behaviour.turnEveryMs; }
      if (client.nextJump && elapsed >= client.nextJump) {
        if (client.sim.jump() && client.net.reportJump()) jumps += 1;
        client.nextJump += client.behaviour.jumpEveryMs;
      }
    }
  });
  const poseSent = hub.pose.sent - base.pose.sent;
  const actionSent = hub.action.sent - base.action.sent;
  const upBytes = (hub.pose.bytes - base.pose.bytes) + (hub.action.bytes - base.action.bytes);
  const delivered = (hub.pose.delivered - base.pose.delivered) + (hub.action.delivered - base.action.delivered);
  const avgBytes = upBytes / Math.max(1, poseSent + actionSent);
  const discarded = clients.reduce((sum, c) => {
    const s = c.net.remotes.stats;
    return { duplicate: sum.duplicate + s.poseDuplicate + s.actionDuplicate, stale: sum.stale + s.poseStale + s.actionStale };
  }, { duplicate: 0, stale: 0 });
  const n = clients.length;
  const moving = behaviours.filter((name) => name !== "idle").length;
  return {
    world, clients,
    report: {
      players: n,
      posePerPlayerSec: +(poseSent / n / seconds).toFixed(2),
      posePerMovingSec: +(poseSent / Math.max(1, moving) / seconds).toFixed(2),
      totalPose: poseSent,
      totalActions: actionSent,
      jumpsReported: jumps,
      upBytesPerPlayerSec: Math.round(upBytes / n / seconds),
      downMsgsPerClientSec: +(delivered / n / seconds).toFixed(1),
      downBytesPerClientSec: Math.round(delivered * avgBytes / n / seconds),
      avgPacketBytes: Math.round(avgBytes),
      // Supabase defines a Realtime event as a WebSocket message sent from or delivered to a client.
      // Fake transport therefore approximates hosted-project event rate as uplink broadcasts + fan-out deliveries.
      realtimeEventsPerSec: +((poseSent + actionSent + delivered) / seconds).toFixed(1),
      fanoutPerBroadcast: +((delivered / Math.max(1, poseSent + actionSent))).toFixed(1),
      lost: (hub.pose.dropped - base.pose.dropped) + (hub.action.dropped - base.action.dropped),
      discardedDuplicate: discarded.duplicate,
      discardedStale: discarded.stale
    }
  };
}

const reports = {};

test("single player, 60 s: idle is silent, walking and running stay within 3–4 Hz", () => {
  for (const name of ["idle", "walk", "runTurn"]) {
    // An idle observer keeps the channel realistic and sends nothing in the window,
    // so the totals are the subject's own traffic.
    reports[name] = simulate([name, "idle"]).report;
  }
  const windowPoses = (name) => reports[name].totalPose;
  assert.equal(windowPoses("idle"), 0, "idle sends nothing during the 60 s window");
  const walkHz = windowPoses("walk") / SECONDS;
  const runHz = windowPoses("runTurn") / SECONDS;
  assert.ok(walkHz >= 3 && walkHz <= 4, `walk ${walkHz} Hz`);
  assert.ok(runHz >= 3 && runHz <= 4, `run/turn ${runHz} Hz`);
  assert.equal(reports.runTurn.totalActions, reports.runTurn.jumpsReported, "every jump went out as one action");
  assert.ok(reports.runTurn.jumpsReported >= SECONDS / 3 - 1);
});

test("4 players in one place zone: consistent membership, dedupe works, ≤ 4 Hz each", () => {
  const result = simulate(["walk", "runTurn", "walk", "idle"]);
  reports.players4 = result.report;
  for (const client of result.clients) {
    assert.equal(client.net.remotes.size, 3, `${client.label} sees exactly three others`);
    assert.equal(new Set(remoteIds(client)).size, 3);
    assert.ok(client.net.sent.pose / (SECONDS + 1) <= 4);
  }
  assert.ok(result.report.discardedDuplicate > 0, "duplicate deliveries happened and were discarded");
  assert.ok(result.report.posePerMovingSec >= 3 && result.report.posePerMovingSec <= 4);
});

test("10 players in one place zone: consistent membership and bounded fan-out", () => {
  const behaviours = Array.from({ length: 10 }, (_, i) => ["walk", "runTurn", "idle"][i % 3]);
  const result = simulate(behaviours);
  reports.players10 = result.report;
  for (const client of result.clients) {
    assert.equal(client.net.remotes.size, 9, `${client.label} sees exactly nine others`);
    assert.ok(client.net.remotes.list().every((p) => p.presence === "present"));
  }
  // Every moving remote is close to its true position on every observer.
  for (const observer of result.clients) {
    for (const subject of result.clients) {
      if (subject === observer) continue;
      const pose = observer.net.remotes.get(subject.sessionId).latestPose;
      const error = Math.hypot(pose.x - subject.sim.x, pose.z - subject.sim.z);
      assert.ok(error < RUN_SPEED * 0.8, `${observer.label}→${subject.label} error ${error.toFixed(2)} m`);
    }
  }
  assert.ok(result.report.downMsgsPerClientSec < 40, "fan-out stays well under Realtime per-client rates");
});

test("25/50/100 players in one place zone: characterize Realtime fan-out capacity", () => {
  const capacity = {};
  let previousEventsPerSec = 0;
  for (const players of [25, 50, 100]) {
    const behaviours = Array.from({ length: players }, (_, i) => ["walk", "runTurn", "idle"][i % 3]);
    const result = simulate(behaviours, CAPACITY_NETWORK, CAPACITY_SECONDS);
    const report = result.report;
    const label = `players${players}`;
    reports[label] = report;
    capacity[label] = {
      players,
      moving: behaviours.filter((name) => name !== "idle").length,
      posePerMovingSec: report.posePerMovingSec,
      fanoutPerBroadcast: report.fanoutPerBroadcast,
      realtimeEventsPerSec: report.realtimeEventsPerSec,
      pro500: report.realtimeEventsPerSec <= REALTIME_PLAN_EVENTS_PER_SEC.pro ? "WITHIN" : "OVER",
      pro2500: report.realtimeEventsPerSec <= REALTIME_PLAN_EVENTS_PER_SEC.proNoSpendCap ? "WITHIN" : "OVER"
    };
    for (const client of result.clients) {
      assert.equal(client.net.remotes.size, players - 1, `${client.label} sees exactly ${players - 1} others at ${players}-player scale`);
      assert.ok(client.net.remotes.list().every((p) => p.presence === "present"));
    }
    assert.ok(report.posePerMovingSec >= 3 && report.posePerMovingSec <= 4,
      `${players} players keep moving publishers within 3–4 Hz: ${report.posePerMovingSec}`);
    assert.ok(report.realtimeEventsPerSec > previousEventsPerSec,
      `${players} players must produce more fan-out than the previous scale`);
    previousEventsPerSec = report.realtimeEventsPerSec;
  }
  console.log("\nONLINE P0 SINGLE-ZONE CAPACITY PROBE (fake transport; quota comparison is diagnostic, not hosted-load proof)");
  console.table(capacity);
});

test("harsh jitter reorders packets; stale ones are discarded, membership stays exact", () => {
  const result = simulate(["runTurn", "runTurn", "walk", "walk"], { latencyMs: 80, jitterMs: 600, lossRate: 0.05, duplicateRate: 0.05, seed: 11 });
  reports.harsh = result.report;
  assert.ok(result.report.discardedStale > 0, "reordering occurred and stale packets were dropped");
  for (const client of result.clients) assert.equal(client.net.remotes.size, 3);
});

test("bandwidth report", () => {
  console.log("\nONLINE P0 LOAD REPORT (fake transport, 60 s, 60 ms ±80 ms jitter, 1% loss, 2% duplicates)");
  console.table(reports);
  assert.ok(Object.keys(reports).length >= 5);
});
