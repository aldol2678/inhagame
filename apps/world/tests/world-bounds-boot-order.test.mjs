import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTERIOR_WORLD_BOUNDS } from "../src/world-exterior-bounds.js";
import { WORLD_BOUNDS } from "../src/campus-layout.js";
import { CAMPUS_MOVEMENT_SPACE } from "../src/player-controller.js";

const playerSource = readFileSync(new URL("../src/player-controller.js", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/campus-layout.js", import.meta.url), "utf8");

test("WORLD_BOUNDS compatibility export resolves to the exterior bounds owner", () => {
  assert.strictEqual(WORLD_BOUNDS, EXTERIOR_WORLD_BOUNDS);
  assert.strictEqual(CAMPUS_MOVEMENT_SPACE.bounds, EXTERIOR_WORLD_BOUNDS);
});

test("PlayerController does not eagerly capture boot-critical campus bindings", () => {
  assert.match(playerSource,
    /import \{ EXTERIOR_WORLD_BOUNDS as WORLD_BOUNDS \} from "\.\/world-exterior-bounds\.js";/);
  assert.match(playerSource, /get bounds\(\) \{ return WORLD_BOUNDS; \}/);
  assert.doesNotMatch(playerSource, /const CAMPUS_OBSTACLES_WITHOUT_BIKE\s*=\s*Object\.freeze/);
  assert.match(playerSource, /getCampusObstaclesWithoutBike\(\)/);
});

test("campus-layout keeps WORLD_BOUNDS as an indirect compatibility export", () => {
  assert.match(layoutSource,
    /export \{ EXTERIOR_WORLD_BOUNDS as WORLD_BOUNDS \} from '\.\/world-exterior-bounds\.js';/);
  assert.doesNotMatch(layoutSource, /export const WORLD_BOUNDS\s*=/);
});
