import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CORE15_EVENT,
  CORE15_FUNNEL_STORAGE_KEY,
  CORE15_ENCOUNTER_RADIUS_WORLD,
  createCore15FunnelTelemetry
} from "../src/core15-funnel-telemetry.js";

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data
  };
}

function eventId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
}

function harness({ storage = memoryStorage(), accepted = true } = {}) {
  const sent = [];
  let seq = 0;
  const telemetry = createCore15FunnelTelemetry({
    storage,
    eventIdFactory: () => eventId(++seq),
    track: (eventType, surface, target, { eventId: stableEventId } = {}) => {
      sent.push({ eventType, surface, target, eventId: stableEventId });
      return Promise.resolve(accepted ? stableEventId : null);
    }
  });
  return { telemetry, sent, storage };
}

test("METRIC-1 confirms each milestone once per browser session with canonical privacy-safe context", async () => {
  const h = harness();
  h.telemetry.startSession();
  h.telemetry.startSession();
  h.telemetry.firstGoalSeen();
  h.telemetry.firstMove();
  h.telemetry.firstZoneArrival();
  h.telemetry.firstNpcInteraction();
  h.telemetry.questStarted();
  h.telemetry.firstActivityStart();
  h.telemetry.firstActivityComplete();
  h.telemetry.firstReward();
  h.telemetry.coreLoopComplete();
  h.telemetry.rewardSeen();
  h.telemetry.growthSeen();
  h.telemetry.nextGoalSeen();
  h.telemetry.worldReturn();
  h.telemetry.nextDiscoveryClick();
  await settle();

  const eventTypes = h.sent.map(event => event.eventType);
  for (const expected of [
    "first_session_start","first_goal_seen","first_move","first_zone_arrival","first_npc_interaction",
    "quest_started","first_activity_start","first_activity_complete","first_reward","core_loop_complete",
    "reward_seen","growth_seen","next_goal_seen","core15_complete","world_return","next_discovery_click"
  ]) assert.equal(eventTypes.filter(type => type === expected).length, 1, expected);

  const byType = Object.fromEntries(h.sent.map(event => [event.eventType, event]));
  assert.equal(byType.first_goal_seen.target, "first_campus");
  assert.equal(byType.first_activity_start.target, "inkyung_living");
  assert.equal(byType.next_goal_seen.target, "main2_back_gate_guide");
  assert.equal(byType.core15_complete.target, "first_campus");
  assert.ok(h.sent.every(event => /^00000000-0000-4000-8000-\d{12}$/.test(event.eventId)));

  const stored = JSON.parse(h.storage.data.get(CORE15_FUNNEL_STORAGE_KEY));
  assert.equal(stored.version, 2);
  assert.equal(stored.seen.length, h.sent.length);
  assert.deepEqual(stored.pending, {});
  assert.ok(stored.seen.every(value => Object.values(CORE15_EVENT).includes(value)));
});

test("METRIC-1 sessionStorage confirmed dedupe survives reload; legacy array storage remains readable", async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  assert.equal(first.telemetry.startSession(), true);
  assert.equal(first.telemetry.firstMove(), true);
  await settle();

  const second = harness({ storage });
  assert.equal(second.telemetry.startSession(), false);
  assert.equal(second.telemetry.firstMove(), false);
  await settle();
  assert.equal(second.sent.length, 0);

  const legacy = memoryStorage({ [CORE15_FUNNEL_STORAGE_KEY]: JSON.stringify(["first_session_start","first_move"]) });
  const migrated = harness({ storage: legacy });
  assert.equal(migrated.telemetry.startSession(), false);
  assert.equal(migrated.telemetry.firstMove(), false);
  assert.equal(migrated.telemetry.firstReward(), true);
  await settle();
  assert.equal(migrated.sent.length, 1);
});

test("METRIC-1 failed confirmation stays pending and reload retries the exact same event_id", async () => {
  const storage = memoryStorage();
  const failed = harness({ storage, accepted: false });
  assert.equal(failed.telemetry.firstReward(), true);
  await settle();

  const afterFailure = JSON.parse(storage.data.get(CORE15_FUNNEL_STORAGE_KEY));
  assert.deepEqual(afterFailure.seen, []);
  assert.equal(afterFailure.pending.first_reward, eventId(1));
  assert.equal(failed.telemetry.status().seen.includes("first_reward"), false);

  const recovered = harness({ storage, accepted: true });
  await settle();
  assert.equal(recovered.sent.length, 1, "constructor resumes the pending milestone");
  assert.equal(recovered.sent[0].eventType, "first_reward");
  assert.equal(recovered.sent[0].eventId, eventId(1), "same id makes lost acknowledgements idempotent");
  const afterRecovery = JSON.parse(storage.data.get(CORE15_FUNNEL_STORAGE_KEY));
  assert.ok(afterRecovery.seen.includes("first_reward"));
  assert.equal(afterRecovery.pending.first_reward, undefined);
});

test("METRIC-1 Product CORE-15 completes only after all four server-confirmed product prerequisites", async () => {
  const h = harness();
  h.telemetry.firstReward();
  h.telemetry.rewardSeen();
  h.telemetry.nextGoalSeen();
  await settle();
  assert.equal(h.sent.some(event => event.eventType === "core15_complete"), false);

  h.telemetry.growthSeen();
  await settle();
  assert.equal(h.sent.filter(event => event.eventType === "core15_complete").length, 1);

  h.telemetry.rewardSeen();
  h.telemetry.growthSeen();
  h.telemetry.nextGoalSeen();
  await settle();
  assert.equal(h.sent.filter(event => event.eventType === "core15_complete").length, 1, "completion is confirmed once");
});

test("METRIC-1 player encounter is proximity-based and stores no player identifier", async () => {
  const h = harness();
  const position = { x: 0, z: 0 };
  assert.equal(h.telemetry.observePlayerEncounter([{ x: CORE15_ENCOUNTER_RADIUS_WORLD + 0.1, z: 0 }], position), false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.telemetry.observePlayerEncounter([{ x: CORE15_ENCOUNTER_RADIUS_WORLD, z: 0 }], position), true);
  await settle();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(
    { eventType: h.sent[0].eventType, surface: h.sent[0].surface, target: h.sent[0].target },
    { eventType: "first_player_encounter", surface: "campus", target: null }
  );
  assert.equal(h.telemetry.observePlayerEncounter([{ x: 0, z: 0 }], position), false, "encounter is one-shot");
});

test("METRIC-1 ignores malformed remote points and unknown event names", async () => {
  const h = harness();
  assert.equal(h.telemetry.observePlayerEncounter([{ userId: "secret" }, null, { x: NaN, z: 0 }], { x: 0, z: 0 }), false);
  assert.equal(h.telemetry.mark("player_secret_seen"), false);
  await settle();
  assert.equal(h.sent.length, 0);
});

test("METRIC-1 main wiring observes milestones without changing gameplay authority", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /core15Funnel = npcTestMode \? null : createCore15FunnelTelemetry\(\{/,
    "preview/test NPC mode never emits product funnel telemetry");
  const funnelSource = readFileSync(new URL("../src/core15-funnel-telemetry.js", import.meta.url), "utf8");
  assert.match(funnelSource, /InhaHubTelemetry\?\.trackConfirmed/,
    "CORE-15 uses server-confirmed telemetry rather than best-effort hub track");
  assert.match(main, /onTriggered: action => \{[\s\S]*?firstNpcInteraction\(\)[\s\S]*?firstActivityComplete\(\)/,
    "shared Context Action observes NPC and Living Moment completion after successful actions");
  assert.match(main, /!lobbyWorld\.active && !lobbyTransition\.active && next\?\.id\) core15Funnel\?\.firstZoneArrival\(\)/,
    "lobby position updates cannot count as first-zone arrival");
  assert.match(main, /next\?\.id === INKYUNG_LIVING_ZONE_ID\) core15Funnel\?\.firstActivityStart\(\)/,
    "Inkyung arrival starts the first living activity");
  assert.match(main, /core15Funnel\?\.observePlayerEncounter\(getMapSocialMarkers\(\), pos\)/,
    "player encounter reuses filtered same-zone map positions without storing an identity");
  assert.match(main, /firstPlayerMovement = true;\s*core15Funnel\?\.firstMove\(\);/,
    "existing movement gate owns the first-move milestone");
  assert.match(main, /onQuestStateChange: progress => \{[\s\S]*?firstGoalSeen\(\)[\s\S]*?questStarted\(\)/);
  assert.match(main, /firstCampusCompletion\.accept\(reward\)/);
  assert.match(main, /firstCampusCompletion\.trackToast\(receipt, toast\)/);
  assert.match(main, /firstCampusCompletion\.growthReadback\(change\)/);
  assert.match(main, /firstCampusCompletion\.observe\(\{[\s\S]*?growthVisible:[\s\S]*?nextGoalVisible:/,
    "the completion owner observes real reward/growth/next-goal surfaces, rather than status success alone");
  assert.match(main, /bindCore15Account\(completionAccount\)[\s\S]*?firstCampusCompletion\.setAccount\(completionAccount\)/,
    "account-scoped presentation and telemetry change together before async clients");
  assert.match(main, /freshFirstCampusReward[\s\S]*?core15Funnel\?\.coreLoopComplete\(\)/,
    "legacy core_loop_complete remains at fresh reward settlement for historical continuity");
  assert.doesNotMatch(main, /core15Funnel\?\.core15Complete\(/,
    "product core15_complete is emitted only by the telemetry gate, never directly by gameplay");
  assert.match(main, /core15Funnel\?\.nextDiscoveryClick\(\)/,
    "next discovery click remains a separate action milestone");
});

