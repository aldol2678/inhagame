import test from "node:test";
import assert from "node:assert/strict";
import {
  createInkyungMechanicalDuckEvent,
  INKYUNG_SIDE_EVENT_STATE,
  INKYUNG_MECHANICAL_DUCK_EVENT_ID,
  INKYUNG_MECHANICAL_DUCK_LORE_ID
} from "../src/inkyung-mechanical-duck-event.js";
import { QUEST_NPC_ID } from "../npc-factory/npc-presence.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    dump() { return new Map(data); }
  };
}

test("side-event stays locked until first-tour completion unlocks it", () => {
  const event = createInkyungMechanicalDuckEvent({ storage: memoryStorage(), scope: "user-a" });
  assert.equal(event.status().eventId, INKYUNG_MECHANICAL_DUCK_EVENT_ID);
  assert.equal(event.status().loreId, INKYUNG_MECHANICAL_DUCK_LORE_ID);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.LOCKED);
  assert.equal(event.npcChoice(QUEST_NPC_ID), null);

  event.setUnlocked(true);
  assert.equal(event.status().unlocked, true);
  assert.equal(event.npcChoice(QUEST_NPC_ID)?.id, "start");
});

test("normal route: rumor -> ordinary duck -> mechanical duck -> Ga-yudam report -> complete", () => {
  const storage = memoryStorage();
  const event = createInkyungMechanicalDuckEvent({ storage, scope: "user-a" });
  event.setUnlocked(true);

  const start = event.advanceNpc(QUEST_NPC_ID, "start");
  assert.match(start.line, /기계/);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD);
  assert.equal(event.canObserveOrdinaryDuck(), true);

  const ordinary = event.observeOrdinaryDuck("white");
  assert.equal(ordinary.changed, true);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.SEARCHING);
  assert.equal(event.requiresMechanicalDuck(), true);
  assert.match(event.status().objective, /수상한 오리/);

  const found = event.observeMechanicalDuck();
  assert.equal(found.found, true);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND);
  assert.equal(event.status().loreUnlocked, true);
  assert.equal(event.npcChoice(QUEST_NPC_ID)?.id, "report");

  const report = event.advanceNpc(QUEST_NPC_ID, "report");
  assert.match(report.line, /인경호/);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.COMPLETE);
  assert.equal(event.status().complete, true);
  assert.equal(event.status().objective, "인경호 기계오리설 조사 완료");

  const restored = createInkyungMechanicalDuckEvent({ storage, scope: "user-a" });
  assert.equal(restored.status().complete, true);
  assert.equal(restored.status().loreUnlocked, true);
});

test("finding the Easter egg first is preserved and skips directly to the report phase after talking to Ga-yudam", () => {
  const event = createInkyungMechanicalDuckEvent({ storage: memoryStorage(), scope: "user-a" });
  const early = event.observeMechanicalDuck();
  assert.equal(early.prefound, true);
  assert.equal(event.status().prefoundMechanicalDuck, true);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.LOCKED);

  event.setUnlocked(true);
  assert.equal(event.npcChoice(QUEST_NPC_ID)?.id, "ack_prefound");
  const acknowledged = event.advanceNpc(QUEST_NPC_ID, "ack_prefound");
  assert.match(acknowledged.line, /이미 봤어요/);
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND);
  assert.equal(event.npcChoice(QUEST_NPC_ID)?.id, "report");
});

test("event progress is scoped per local account while guest pre-discovery can migrate into the first signed-in scope", () => {
  const storage = memoryStorage();
  const event = createInkyungMechanicalDuckEvent({ storage });
  event.observeMechanicalDuck();
  assert.equal(event.status().scope, "guest");
  assert.equal(event.status().prefoundMechanicalDuck, true);

  event.setScope("user-a");
  assert.equal(event.status().scope, "user-a");
  assert.equal(event.status().prefoundMechanicalDuck, true);
  event.setUnlocked(true);
  event.advanceNpc(QUEST_NPC_ID, "ack_prefound");
  event.advanceNpc(QUEST_NPC_ID, "report");
  assert.equal(event.status().complete, true);

  event.setScope("user-b");
  assert.equal(event.status().scope, "user-b");
  assert.equal(event.status().state, INKYUNG_SIDE_EVENT_STATE.LOCKED);
  assert.equal(event.status().complete, false);

  event.setScope("user-a");
  assert.equal(event.status().complete, true);
});

test("map target points to the pond while searching and to Ga-yudam after the find", () => {
  const event = createInkyungMechanicalDuckEvent({ storage: memoryStorage(), scope: "user-a" });
  event.setUnlocked(true);
  event.advanceNpc(QUEST_NPC_ID, "start");

  const pond = event.mapTarget();
  assert.equal(pond.kind, "side-event");
  assert.ok(Number.isFinite(pond.x) && Number.isFinite(pond.z));

  event.observeOrdinaryDuck("mallard");
  event.observeMechanicalDuck();
  const npc = event.mapTarget(id => id === QUEST_NPC_ID ? { x: 12, z: 34 } : null);
  assert.equal(npc.npcId, QUEST_NPC_ID);
  assert.equal(npc.x, 12);
  assert.equal(npc.z, 34);
});
