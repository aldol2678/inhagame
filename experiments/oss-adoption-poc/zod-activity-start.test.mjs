import test from "node:test";
import assert from "node:assert/strict";
import { validateActivityStartRequest } from "../../apps/world/src/activity/activity-contract.js";
import { parseActivityStartRequestZod } from "./zod-activity-start.mjs";

const valid = Object.freeze({
  activityId: "activity.fishing.inkyung",
  sourceRef: "world.inkyung",
  clientAttemptKey: "ABCDEFAB-1234-4ABC-8ABC-ABCDEFABCDEF",
  evidence: { cast: "short", score: 7 }
});

const cases = [
  ["valid", valid, true],
  ["valid without evidence", { ...valid, evidence: undefined }, true],
  ["null input", null, false],
  ["array input", [], false],
  ["unknown field", { ...valid, extra: true }, false],
  ["forbidden authority field", { ...valid, rewardAmount: 99 }, false],
  ["bad activity id", { ...valid, activityId: "fishing" }, false],
  ["bad source ref", { ...valid, sourceRef: "World.inkyung" }, false],
  ["bad client key", { ...valid, clientAttemptKey: "nope" }, false],
  ["array evidence", { ...valid, evidence: [] }, false],
  ["oversized evidence", { ...valid, evidence: { text: "x".repeat(2050) } }, false],
  ["non-serializable evidence", { ...valid, evidence: { value: 1n } }, false]
];

function accepted(fn, input) {
  try {
    fn(input);
    return true;
  } catch {
    return false;
  }
}

test("Zod PoC matches manual activity-start acceptance matrix", () => {
  for (const [name, input, expected] of cases) {
    const manual = accepted(validateActivityStartRequest, input);
    const zod = accepted(parseActivityStartRequestZod, input);
    assert.equal(manual, expected, "manual mismatch: " + name);
    assert.equal(zod, expected, "zod mismatch: " + name);
    assert.equal(zod, manual, "parity mismatch: " + name);
  }
});

test("Zod PoC preserves canonical valid output", () => {
  const manual = validateActivityStartRequest(valid);
  const zod = parseActivityStartRequestZod(valid);
  assert.deepEqual(zod, manual);
  assert.equal(zod.clientAttemptKey, valid.clientAttemptKey.toLowerCase());
  assert.ok(Object.isFrozen(zod));
  assert.ok(Object.isFrozen(zod.evidence));
});
