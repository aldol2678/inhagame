import test from "node:test";
import assert from "node:assert/strict";
import { createSpaceFade } from "../src/rooms/space-fade.js";

const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
function rig({ reduced = false } = {}) {
  const classes = new Set();
  const overlay = { hidden: true, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
  const timers = [], frames = [];
  const fade = createSpaceFade({ overlay, reducedMotion: { matches: reduced },
    requestFrame: callback => frames.push(callback), setTimer: (callback, ms) => { timers.push({ callback, ms }); } });
  const advance = async () => { const next = timers.shift(); assert.ok(next, "expected fade timer"); next.callback(); await flush(); };
  return { overlay, timers, frames, fade, advance, on: () => classes.has("on") };
}

test("timer-driven switch exceptions reject only after overlay cleanup", async () => {
  const r = rig();
  const error = new Error("room scene unavailable");
  let caught;
  const result = Promise.resolve(r.fade(() => { throw error; })).catch(value => { caught = value; });
  r.frames.shift()();
  await r.advance();
  await r.advance();
  await result;
  assert.equal(caught, error);
  assert.equal(r.overlay.hidden, true);
  assert.equal(r.on(), false);
});

test("fade waits for asynchronous switch recovery before clearing black and settling", async () => {
  const r = rig();
  let reject;
  let settled = false;
  const work = new Promise((_resolve, fail) => { reject = fail; });
  work.catch(() => {});
  const result = Promise.resolve(r.fade(() => work)).catch(() => {}).then(() => { settled = true; });
  r.frames.shift()();
  await r.advance();
  assert.equal(r.on(), true, "keep intermediate scene covered while work is pending");
  assert.equal(settled, false);
  reject(new Error("async scene failure")); await flush();
  assert.equal(r.on(), false);
  await r.advance(); await result;
  assert.equal(r.overlay.hidden, true);
});

test("a late animation frame cannot repaint black after cleanup", async () => {
  const r = rig();
  const result = r.fade(() => {});
  await r.advance(); await r.advance(); await result;
  r.frames.shift()();
  assert.equal(r.on(), false);
  assert.equal(r.overlay.hidden, true);
});

test("reduced motion and absent overlay keep synchronous callback behavior", () => {
  const r = rig({ reduced: true });
  let count = 0;
  r.fade(() => { count += 1; });
  assert.equal(count, 1);
  assert.equal(r.timers.length, 0);
  assert.equal(r.overlay.hidden, true);
  const fade = createSpaceFade({ overlay: null, reducedMotion: { matches: false } });
  assert.throws(() => fade(() => { throw new Error("instant failure"); }), /instant failure/);
});
