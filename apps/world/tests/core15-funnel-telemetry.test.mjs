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

function harness({ storage = memoryStorage(), accepted = true } = {}) {
  const sent = [];
  const telemetry = createCore15FunnelTelemetry({
    storage,
    track: (eventType, surface, target) => {
      sent.push({ eventType, surface, target });
      return accepted ? `event-${sent.length}` : null;
    }
  });
  return { telemetry, sent, storage };
}

test("METRIC-1 stores each milestone once per browser session with canonical privacy-safe context", () => {
  const h = harness();
  h.telemetry.startSession();
  h.telemetry.startSession();
  h.telemetry.firstMove();
  h.telemetry.firstZoneArrival();
  h.telemetry.firstNpcInteraction();
  h.telemetry.firstActivityStart();
  h.telemetry.firstActivityComplete();
  h.telemetry.firstReward();
  h.telemetry.coreLoopComplete();
  h.telemetry.worldReturn();
  h.telemetry.nextDiscoveryClick();

  assert.deepEqual(h.sent, [
    { eventType: "first_session_start", surface: "campus", target: null },
    { eventType: "first_move", surface: "campus", target: null },
    { eventType: "first_zone_arrival", surface: "campus", target: null },
    { eventType: "first_npc_interaction", surface: "campus", target: null },
    { eventType: "first_activity_start", surface: "campus", target: "inkyung_living" },
    { eventType: "first_activity_complete", surface: "campus", target: "inkyung_living" },
    { eventType: "first_reward", surface: "campus", target: "first_campus" },
    { eventType: "core_loop_complete", surface: "campus", target: "first_campus" },
    { eventType: "world_return", surface: "campus", target: null },
    { eventType: "next_discovery_click", surface: "campus", target: "main2_back_gate_guide" }
  ]);
  const stored = JSON.parse(h.storage.data.get(CORE15_FUNNEL_STORAGE_KEY));
  assert.equal(stored.length, h.sent.length);
  assert.ok(stored.every(value => Object.values(CORE15_EVENT).includes(value)));
});

test("METRIC-1 sessionStorage dedupe survives a page reload but not a new storage session", () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  assert.equal(first.telemetry.startSession(), true);
  assert.equal(first.telemetry.firstMove(), true);

  const second = harness({ storage });
  assert.equal(second.telemetry.startSession(), false);
  assert.equal(second.telemetry.firstMove(), false);
  assert.equal(second.sent.length, 0);

  const fresh = harness();
  assert.equal(fresh.telemetry.startSession(), true);
  assert.equal(fresh.sent.length, 1);
});

test("METRIC-1 never marks a milestone as seen when telemetry transport is unavailable", () => {
  const storage = memoryStorage();
  const failed = harness({ storage, accepted: false });
  assert.equal(failed.telemetry.firstReward(), false);
  assert.equal(storage.data.get(CORE15_FUNNEL_STORAGE_KEY), undefined);

  const recovered = harness({ storage, accepted: true });
  assert.equal(recovered.telemetry.firstReward(), true);
  assert.equal(recovered.sent[0].eventType, "first_reward");
});

test("METRIC-1 player encounter is proximity-based and stores no player identifier", () => {
  const h = harness();
  const position = { x: 0, z: 0 };
  assert.equal(h.telemetry.observePlayerEncounter([{ x: CORE15_ENCOUNTER_RADIUS_WORLD + 0.1, z: 0 }], position), false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.telemetry.observePlayerEncounter([{ x: CORE15_ENCOUNTER_RADIUS_WORLD, z: 0 }], position), true);
  assert.deepEqual(h.sent, [{ eventType: "first_player_encounter", surface: "campus", target: null }]);
  assert.equal(h.telemetry.observePlayerEncounter([{ x: 0, z: 0 }], position), false, "encounter is one-shot");
});

test("METRIC-1 ignores malformed remote points and unknown event names", () => {
  const h = harness();
  assert.equal(h.telemetry.observePlayerEncounter([{ userId: "secret" }, null, { x: NaN, z: 0 }], { x: 0, z: 0 }), false);
  assert.equal(h.telemetry.mark("player_secret_seen"), false);
  assert.equal(h.sent.length, 0);
});


test("METRIC-1 main wiring observes milestones without changing gameplay authority", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /const core15Funnel = npcTestMode \? null : createCore15FunnelTelemetry\(\)/,
    "preview/test NPC mode never emits product funnel telemetry");
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
  assert.match(main, /core15Funnel\?\.firstReward\(\);[\s\S]*?reward\.status === "SUCCESS" && reward\.replayed !== true[\s\S]*?core15Funnel\?\.coreLoopComplete\(\)/,
    "server First Campus reward owns reward and core-loop milestones");
  assert.match(main, /core15Funnel\?\.nextDiscoveryClick\(\)/,
    "next discovery click uses the session-deduped funnel tracker");
});

