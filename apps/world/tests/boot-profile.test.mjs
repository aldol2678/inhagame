import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createWorldBootProfile,
  installWorldBootProfile,
  summarizeBootResources
} from "../src/lobby/boot-profile.js";

function fakePerformance() {
  let value = 10;
  const resources = [
    { name: "https://example.test/src/main.js", initiatorType: "script", transferSize: 100, encodedBodySize: 80, decodedBodySize: 160 },
    { name: "https://example.test/assets/induck-v3.glb", initiatorType: "fetch", transferSize: 200, encodedBodySize: 190, decodedBodySize: 190 },
    { name: "https://example.test/api/world-time", initiatorType: "fetch", transferSize: 50, encodedBodySize: 40, decodedBodySize: 40 },
    { name: "https://cdn.test/opaque.mjs", initiatorType: "script", transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }
  ];
  return {
    now() { const current = value; value += 5; return current; },
    mark() {},
    getEntriesByType(type) {
      if (type === "resource") return resources;
      if (type === "navigation") return [{
        responseEnd: 12, domContentLoadedEventEnd: 20, loadEventEnd: 25,
        transferSize: 500, encodedBodySize: 450, decodedBodySize: 900
      }];
      return [];
    }
  };
}

test("BOOT-PROFILE-01 aggregates resources without retaining resource URLs", () => {
  const summary = summarizeBootResources(fakePerformance());
  assert.equal(summary.requests, 4);
  assert.equal(summary.transferBytes, 350);
  assert.equal(summary.opaqueSizeEntries, 1);
  assert.deepEqual(summary.kinds, { script: 2, model: 1, api: 1 });
  assert.doesNotMatch(JSON.stringify(summary), /example\.test|cdn\.test/);
});

test("BOOT-PROFILE-01 records navigation-relative marks, spans and final READY state", () => {
  const perf = fakePerformance();
  const profile = createWorldBootProfile({ performanceTarget: perf, observerTarget: null });
  profile.annotate("renderer", "WebGPU");
  assert.equal(profile.startSpan("renderer"), true);
  assert.equal(profile.startSpan("renderer"), false, "duplicate open span is refused");
  const span = profile.endSpan("renderer", { ok: true });
  assert.equal(span.name, "renderer");
  assert.ok(span.startMs >= 0);
  assert.ok(span.durationMs > 0);
  profile.mark("essential-ready");
  const receipt = profile.finish({ degraded: false });
  assert.equal(receipt.state, "READY");
  assert.equal(receipt.metadata.renderer, "WebGPU");
  assert.equal(receipt.metadata.degraded, false);
  assert.equal(receipt.pendingSpans.length, 0);
  assert.equal(profile.finish().elapsedMs, receipt.elapsedMs, "finish is idempotent");
});

test("BOOT-PROFILE-01 freezes boot resource totals at READY", () => {
  const perf = fakePerformance();
  const profile = createWorldBootProfile({ performanceTarget: perf, observerTarget: null });
  const receipt = profile.finish();
  const original = receipt.resources.requests;
  const after = profile.status();
  assert.equal(after.resources.requests, original);
  assert.strictEqual(after.resources, receipt.resources);
});

test("BOOT-PROFILE-01 install is idempotent per target", () => {
  const target = {};
  const performanceTarget = fakePerformance();
  const first = installWorldBootProfile({ target, performanceTarget, observerTarget: null });
  const second = installWorldBootProfile({ target, performanceTarget, observerTarget: null });
  assert.strictEqual(first, second);
});

test("BOOT-PROFILE-01 wiring measures the existing boot contract without optimizing it", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const character = readFileSync(new URL("../src/character-model.js", import.meta.url), "utf8");
  const loading = readFileSync(new URL("../src/lobby/lobby-loading.js", import.meta.url), "utf8");
  assert.match(main, /startSpan\?\.\("asset-canary"\)/);
  assert.match(main, /startSpan\?\.\("world-time"\)/);
  assert.match(main, /startSpan\?\.\("initial-streaming-update"\)/);
  assert.match(main, /bootProfile: bootProfile\?\.status\?\.\(\) \?\? null/);
  assert.match(character, /bootSpan: "asset-induck"/);
  assert.match(character, /bootSpan: "asset-annyongi"/);
  assert.match(character, /Promise\.all\(\[duckReady, dragonReady\]\)/,
    "prelaunch Annyongi remains available-to-all and boot-blocking in the measurement-only baseline");
  assert.match(loading, /profile\?\.finish\?\.\(\{ degraded \}\)/);
});
