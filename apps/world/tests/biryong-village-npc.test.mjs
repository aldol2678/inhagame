import test from "node:test";
import assert from "node:assert/strict";

import { createPurposefulStudent } from "../npc-factory/purposeful-student-state.mjs";
import {
  BIRYONG_VILLAGE_NPC_BY_ID,
  BIRYONG_VILLAGE_NPC_DESTINATIONS,
  BIRYONG_VILLAGE_NPC_PERIODS,
  BIRYONG_VILLAGE_NPC_ROSTER,
  validateBiryongVillageNpcRoster
} from "../src/biryong/biryong-village-npc-contract.js";
import { createBiryongVillageNpcNavigator } from "../src/biryong/biryong-village-npc-navigation.js";

const implementedZones = new Set(["BR_STATION","BR_MARKET","BR_WORKSHOP","BR_INN","BR_COUNCIL","BR_RESIDENTIAL"]);

test("Biryong Village P0 roster is exactly the selected eight NPC vertical slice", () => {
  assert.equal(validateBiryongVillageNpcRoster(), true);
  assert.equal(BIRYONG_VILLAGE_NPC_ROSTER.length, 8);
  assert.deepEqual(BIRYONG_VILLAGE_NPC_ROSTER.map(npc => npc.name), [
    "강소라", "한여울", "남이솔", "윤하린", "오미래", "한세온", "류가람", "이담"
  ]);
  assert.equal(BIRYONG_VILLAGE_NPC_BY_ID.size, 8);
  assert.deepEqual(BIRYONG_VILLAGE_NPC_PERIODS, ["morning","class_time","lunch","evening","night"]);
});

test("all eight NPCs have one deterministic routine slot for every shared World Clock period", () => {
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    assert.equal(npc.schedule.length, BIRYONG_VILLAGE_NPC_PERIODS.length, npc.id);
    assert.equal(npc.schedule.at(-1).sink, true, `${npc.name} leaves the outdoor scene at night`);
    for (const entry of npc.schedule) {
      const destination = BIRYONG_VILLAGE_NPC_DESTINATIONS[entry.destination];
      assert.ok(destination, `${npc.name}: ${entry.destination}`);
      if (destination.zoneId) assert.equal(implementedZones.has(destination.zoneId), true,
        `${npc.name} uses only implemented runtime zones when visible`);
      if (!destination.zoneId) assert.equal(entry.sink, true,
        `${npc.name} cannot remain visible in an unimplemented outer destination`);
    }
  }
});

test("every Biryong NPC destination is walkable and every schedule transition has a route", () => {
  const navigator = createBiryongVillageNpcNavigator();
  for (const destination of Object.values(BIRYONG_VILLAGE_NPC_DESTINATIONS)) {
    assert.equal(navigator.walkable(destination.position), true, destination.id);
  }
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    for (let index = 1; index < npc.schedule.length; index += 1) {
      const from = BIRYONG_VILLAGE_NPC_DESTINATIONS[npc.schedule[index - 1].destination].position;
      const to = BIRYONG_VILLAGE_NPC_DESTINATIONS[npc.schedule[index].destination].position;
      const route = navigator.route(from, to);
      assert.ok(route?.length, `${npc.name}: ${npc.schedule[index - 1].destination} -> ${npc.schedule[index].destination}`);
      assert.deepEqual(route.at(-1), to);
    }
  }
});

test("purposeful baseline accepts each Biryong routine and supports shared-period switching", () => {
  const navigator = createBiryongVillageNpcNavigator();
  const destinations = Object.fromEntries(Object.entries(BIRYONG_VILLAGE_NPC_DESTINATIONS)
    .map(([key, value]) => [key, { ...value, position: { ...value.position } }]));

  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    const spawn = destinations[npc.schedule[0].destination].position;
    const controller = createPurposefulStudent({
      id: npc.id, spawn, destinations, schedule: npc.schedule, navigator,
      speed: 1.1, holdAtActivity: true, startHidden: npc.schedule[0].sink === true
    });
    assert.notEqual(controller.status().phase, "FAILED", npc.name);
    for (let index = 0; index < npc.schedule.length; index += 1) {
      controller.setScheduleIndex(index);
      assert.notEqual(controller.status().phase, "FAILED", `${npc.name} period ${index}`);
      assert.equal(controller.status().destination, npc.schedule[index].destination);
    }
  }
});

test("main wires the Biryong NPC runtime only to the BIRYONG_REALM scene", async () => {
  const fs = await import("node:fs");
  const code = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(code, /createBiryongVillageNpcRuntime/);
  assert.match(code, /root: biryongRealmScene\.root/);
  assert.match(code, /getActive: \(\) => biryongRealm\?\.inBiryong === true/);
  assert.match(code, /biryongVillageNpcs: biryongVillageNpcs\?\.status\(\) \?\? null/);
});
