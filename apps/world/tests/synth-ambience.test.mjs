import test from "node:test";
import assert from "node:assert/strict";
import { makeAmbienceBuffer } from "../src/audio/synth-ambience.js";

const rate = 8000;
const context = { sampleRate: rate, createBuffer: (_channels, length) => {
  const samples = new Float32Array(length);
  return { getChannelData: () => samples };
} };
const rms = (samples, start, end) => {
  let power = 0;
  for (let i = start * rate; i < end * rate; i++) power += samples[i] ** 2;
  return Math.sqrt(power / ((end - start) * rate));
};

test("outdoor cues leave quiet gaps instead of a constant hiss", () => {
  const gate = makeAmbienceBuffer(context, "traffic").getChannelData(0);
  const footsteps = makeAmbienceBuffer(context, "arrival").getChannelData(0);
  const pond = makeAmbienceBuffer(context, "water").getChannelData(0);
  assert.ok(rms(gate, 3, 4) > 3 * rms(gate, 0, 1));
  assert.ok(rms(footsteps, 1, 2) > 10 * rms(footsteps, 2, 3));
  assert.ok(rms(pond, 1, 2) > 3 * rms(pond, 2, 3));
  for (const samples of [gate, footsteps, pond]) {
    assert.ok(samples.every(Number.isFinite));
    assert.ok(Math.abs(samples[0] - samples.at(-1)) < 1e-6);
  }
});
