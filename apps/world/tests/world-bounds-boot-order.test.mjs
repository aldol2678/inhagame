import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTERIOR_WORLD_BOUNDS } from "../src/world-exterior-bounds.js";
import { WORLD_BOUNDS } from "../src/campus-layout.js";
import { CAMPUS_MOVEMENT_SPACE } from "../src/player-controller.js";

const playerSource = readFileSync(new URL("../src/player-controller.js", import.meta.url), "utf8");

test("WORLD_BOUNDS value remains identical while PlayerController uses the exterior owner directly", () => {
  assert.strictEqual(WORLD_BOUNDS, EXTERIOR_WORLD_BOUNDS);
  assert.strictEqual(CAMPUS_MOVEMENT_SPACE.bounds, EXTERIOR_WORLD_BOUNDS);
});

test("PlayerController does not eagerly capture boot-critical campus bindings", () => {
  assert.match(playerSource,
    /import \{ EXTERIOR_WORLD_BOUNDS as WORLD_BOUNDS \} from "\.\/world-exterior-bounds\.js";/);
  assert.match(playerSource, /get bounds\(\) \{ return WORLD_BOUNDS; \}/);
  assert.match(playerSource, /function CAMPUS_OBSTACLES_WITHOUT_BIKE\(\)/);
  assert.doesNotMatch(playerSource, /const CAMPUS_OBSTACLES_WITHOUT_BIKE\s*=\s*Object\.freeze/);
});
