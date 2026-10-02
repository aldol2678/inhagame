import test from "node:test";
import assert from "node:assert/strict";
import {
  INKYUNG_DUCK_ROSTER,
  MECHANICAL_DUCK_CHANCE,
  DUCK_SHORE_OBSERVATION_RADIUS,
  createDuckBrain,
  advanceDuckBrain,
  inkyungDuckSpawnPoints,
  isInsideInkyungPond,
  distanceToInkyungPondShore,
  canObserveInkyungDucksFromShore,
  shouldSpawnMechanicalDuck
} from "../src/ambient-ducks-state.js";

test("Inkyung ambient roster is exactly three white ducks plus one mallard", () => {
  assert.equal(INKYUNG_DUCK_ROSTER.length, 4);
  assert.equal(INKYUNG_DUCK_ROSTER.filter(d => d.kind === "white").length, 3);
  assert.equal(INKYUNG_DUCK_ROSTER.filter(d => d.kind === "mallard").length, 1);
  assert.ok(INKYUNG_DUCK_ROSTER.every(d => d.speed > 0 && d.speed < 1));
});

test("derived duck spawns stay inside the canonical Inkyung Pond polygon", () => {
  const points = inkyungDuckSpawnPoints(5);
  assert.equal(points.length, 5);
  assert.ok(points.every(isInsideInkyungPond));
  assert.equal(new Set(points.map(p => p.x.toFixed(4) + "," + p.z.toFixed(4))).size, 5);
});

test("duck brain remains on water while swimming, grooming and flapping", () => {
  const spawn = inkyungDuckSpawnPoints(1)[0];
  const brain = createDuckBrain({ id: "test-duck", spawn, speed: 0.4, seed: 7 });
  for (let i = 0; i < 12000; i++) {
    const angle = i / 200;
    const player = i % 700 < 40 ? {
      x: brain.position.x + Math.cos(angle) * 0.5,
      z: brain.position.z + Math.sin(angle) * 0.5
    } : null;
    advanceDuckBrain(brain, 0.05, player);
    assert.ok(isInsideInkyungPond(brain.position), "duck left canonical pond at tick " + i);
    assert.ok(["idle", "swim", "groom", "flap"].includes(brain.state));
  }
});

test("mechanical duck spawn is rare by default and forceable only by caller", () => {
  assert.equal(MECHANICAL_DUCK_CHANCE, 0.08);
  assert.equal(shouldSpawnMechanicalDuck({ random: () => 0.079 }), true);
  assert.equal(shouldSpawnMechanicalDuck({ random: () => 0.08 }), false);
  assert.equal(shouldSpawnMechanicalDuck({ force: true, random: () => 1 }), true);
  assert.equal(shouldSpawnMechanicalDuck({ random: () => 0, chance: -1 }), false);
});


test("shore observation is reachable without entering pond water", () => {
  const spawn = inkyungDuckSpawnPoints(1)[0];
  let shore = null;
  for (let a = 0; a < 32 && !shore; a++) {
    const angle = a / 32 * Math.PI * 2;
    for (let r = 0.5; r <= 40; r += 0.5) {
      const point = { x: spawn.x + Math.cos(angle) * r, z: spawn.z + Math.sin(angle) * r };
      if (isInsideInkyungPond(point)) continue;
      if (canObserveInkyungDucksFromShore(point)) shore = point;
      break;
    }
  }
  assert.ok(shore, "a walkable shoreline observation point should exist");
  assert.ok(distanceToInkyungPondShore(shore) <= DUCK_SHORE_OBSERVATION_RADIUS);
  assert.equal(canObserveInkyungDucksFromShore({ x: 1000, z: 1000 }), false);
  assert.equal(canObserveInkyungDucksFromShore(spawn), false, "water itself is not a player observation surface");
});
