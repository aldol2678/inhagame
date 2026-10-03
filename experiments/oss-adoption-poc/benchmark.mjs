import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { validateActivityStartRequest } from "../../apps/world/src/activity/activity-contract.js";
import { REPRESENTATIVE_ASSETS, runGltfTransformPoc } from "./gltf-transform-poc.mjs";
import { parseActivityStartRequestZod } from "./zod-activity-start.mjs";

const sample = Object.freeze({
  activityId: "activity.fishing.inkyung",
  sourceRef: "world.inkyung",
  clientAttemptKey: "abcdefab-1234-4abc-8abc-abcdefabcdef",
  evidence: { cast: "short", score: 7 }
});

function time(fn, iterations) {
  for (let i = 0; i < 1000; i += 1) fn(sample);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(sample);
  return performance.now() - started;
}

const iterations = 30000;
const manualMs = time(validateActivityStartRequest, iterations);
const zodMs = time(parseActivityStartRequestZod, iterations);

const gltf = [];
for (const asset of REPRESENTATIVE_ASSETS) {
  gltf.push(await runGltfTransformPoc(asset));
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: "isolated-poc-no-production-path-change",
  zod: {
    iterations,
    manualMs: Number(manualMs.toFixed(3)),
    zodMs: Number(zodMs.toFixed(3)),
    zodToManualRatio: Number((zodMs / manualMs).toFixed(3)),
    manualUsPerParse: Number(((manualMs * 1000) / iterations).toFixed(3)),
    zodUsPerParse: Number(((zodMs * 1000) / iterations).toFixed(3)),
    parityGate: "covered-by-node-test"
  },
  gltfTransform: gltf,
  limitations: [
    "Zod parity covers the selected activity-start contract, not all INHA WORLD validators.",
    "glTF Transform PoC uses dedup + prune only.",
    "Visual regression is evaluated by the separate deterministic visual gate; this benchmark JSON does not duplicate that result.",
    "PoC dependencies are isolated from deployed INHA WORLD runtime."
  ]
};

const output = path.join(process.cwd(), "poc-results.json");
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
