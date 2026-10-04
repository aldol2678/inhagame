import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeMusicLayer } from "../src/audio/music-runtime.js";
import { createMusicPreviewRuntime } from "../src/music-editor/music-preview-runtime.js";

const state = id => ({ space: "campus", placeZoneId: `AREA_${id}` });
const project = () => ({
  projectId: "music-lifecycle-fixture",
  assets: ["A", "B", "C"].map(id => ({ id: `asset.${id}`, uri: `/audio/${id}.wav?v=1` })),
  cues: ["A", "B", "C"].map(id => ({
    id: `cue.${id}`, assetId: `asset.${id}`, name: id, gain: 0.6,
    loop: { enabled: true, startSeconds: 0, endSeconds: 1 },
    transition: { fadeInSeconds: 0.1, fadeOutSeconds: 0.2 }
  })),
  bindings: ["A", "B", "C"].map(id => ({
    id: `binding.${id}`, targetType: "placeZone", targetId: `AREA_${id}`,
    cueId: `cue.${id}`, enabled: true
  }))
});

// Web Audio and timers are the external boundary. Exercise the real runtimes,
// including returned state, decoded source identity and owned-node cleanup.
function rig(kind, { delayedDecode = false } = {}) {
  let currentProject = project();
  const sources = [];
  const gains = [];
  const decodes = [];
  const loads = [];
  const timers = new Map();
  let timerId = 0;
  let byteId = 0;
  const uris = new Map();

  class Param {
    value = 1;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    disconnects = 0;
    connect(next) { this.output = next; return next; }
    disconnect() { this.disconnects += 1; }
  }
  const context = {
    state: "running", currentTime: 0, destination: new Node(), closes: 0,
    createGain() {
      const node = new Node();
      node.gain = new Param();
      gains.push(node);
      return node;
    },
    createBufferSource() {
      const source = new Node();
      source.starts = 0;
      source.stops = 0;
      source.onended = null;
      source.start = () => { source.starts += 1; };
      source.stop = () => { source.stops += 1; };
      sources.push(source);
      return source;
    },
    decodeAudioData(bytes) {
      const buffer = { uri: uris.get(new Uint8Array(bytes)[0]), duration: 1 };
      if (!delayedDecode) return Promise.resolve(buffer);
      return new Promise((resolve, reject) => decodes.push({ buffer, resolve: () => resolve(buffer), reject }));
    },
    async resume() { this.state = "running"; },
    async suspend() { this.state = "suspended"; },
    async close() { this.closes += 1; this.state = "closed"; }
  };
  const load = async asset => {
    loads.push(asset.uri);
    const id = ++byteId;
    uris.set(id, asset.uri);
    return new Uint8Array([id]).buffer;
  };
  const timerOptions = {
    setTimeoutFn(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeoutFn(id) { timers.delete(id); }
  };
  const output = new Node();
  const runtime = kind === "runtime"
    ? createRuntimeMusicLayer({ getContext: () => context, getOutput: () => output, loadAssetArrayBuffer: load, ...timerOptions })
    : createMusicPreviewRuntime({
      documentLike: null,
      AudioContextClass: class { constructor() { return context; } },
      getProject: () => currentProject,
      loadAssetBlob: async asset => ({ arrayBuffer: () => load(asset) }),
      ...timerOptions
    });
  const setProject = next => {
    currentProject = next;
    return kind === "runtime" ? runtime.setProject(next) : runtime.refresh();
  };
  const ready = async () => {
    if (kind === "runtime") await runtime.setProject(currentProject);
    else await runtime.unlock();
  };
  const flush = () => {
    for (const [id, fn] of [...timers]) {
      timers.delete(id);
      fn();
    }
  };
  const gainProduct = source => {
    let node = source.output;
    let result = 1;
    while (node) { if (node.gain) result *= node.gain.value; node = node.output; }
    return result;
  };
  return { runtime, ready, setProject, sources, gains, context, output, timers, decodes, loads, flush, gainProduct };
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const live = r => r.sources.filter(source => source.stops === 0 && source.disconnects === 0);

for (const kind of ["runtime", "preview"]) {
  test(`${kind}: replacing the URI version under the same cue and asset replaces the source`, async () => {
    const r = rig(kind);
    await r.ready();
    await r.runtime.setState(state("A"));
    const before = r.sources[0];
    const next = project();
    next.assets[0].uri = "/audio/A.wav?v=2";
    await r.setProject(next);
    assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/A.wav?v=2"]);
    assert.equal(before.stops, 1);
    assert.equal(before.disconnects, 1);
    assert.equal(before.output.disconnects, 1);
    r.runtime.dispose();
  });

  test(`${kind}: late replaced-URI decode cannot start or replace the current source`, async () => {
    const r = rig(kind, { delayedDecode: true });
    await r.ready();
    const old = r.runtime.setState(state("A"));
    await settle();
    const next = project();
    next.assets[0].uri = "/audio/A.wav?v=2";
    const current = r.setProject(next);
    await settle();
    r.decodes[1].resolve();
    assert.equal(await current, true);
    r.decodes[0].resolve();
    assert.equal(await old, false);
    assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/A.wav?v=2"]);
    r.runtime.dispose();
  });

  test(`${kind}: concurrent A to B to A shares decoding and only latest selection starts`, async () => {
    const r = rig(kind, { delayedDecode: true });
    await r.ready();
    const a = r.runtime.setState(state("A"));
    await settle();
    const b = r.runtime.setState(state("B"));
    await settle();
    const again = r.runtime.setState(state("A"));
    await settle();
    assert.equal(r.decodes.length, 2, "one in-flight decode per asset identity");
    r.decodes[0].resolve();
    r.decodes[1].resolve();
    assert.deepEqual(await Promise.all([a, b, again]), [false, false, true]);
    assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/A.wav?v=1"]);
    r.runtime.dispose();
  });

  test(`${kind}: A to B to A cancels only A retirement and tolerates an already queued callback`, async () => {
    const r = rig(kind);
    await r.ready();
    await r.runtime.setState(state("A"));
    const first = r.sources[0];
    await r.runtime.setState(state("B"));
    const staleRetirement = [...r.timers.values()][0];
    await r.runtime.setState(state("A"));
    staleRetirement();
    r.flush();
    assert.deepEqual(live(r), [first]);
    assert.equal(r.runtime.status().activeSources, 1);
    assert.equal(r.runtime.status().fadingSources, 0);
    r.runtime.dispose();
    assert.ok(r.sources.every(source => source.stops === 1 && source.disconnects === 1));
  });

  test(`${kind}: natural completion retires its timer before the same cue starts again`, async () => {
    const r = rig(kind);
    await r.ready();
    await r.runtime.setState(state("A"));
    const ended = r.sources[0];
    await r.runtime.setState(state("B"));
    const staleRetirement = [...r.timers.values()][0];
    ended.onended();
    assert.equal(r.timers.size, 0);
    await r.runtime.setState(state("A"));
    staleRetirement();
    r.flush();
    assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/A.wav?v=1"]);
    r.runtime.dispose();
    r.runtime.dispose();
    assert.equal(ended.stops, 0, "an already-ended source needs no explicit stop");
    assert.ok(r.sources.every(source => source.disconnects === 1 && source.output.disconnects === 1));
    assert.ok(r.sources.slice(1).every(source => source.stops === 1));
    assert.equal(r.timers.size, 0);
  });

  test(`${kind}: rapid transitions and repeated silence leave no orphan source or timer`, async () => {
    const r = rig(kind);
    await r.ready();
    for (let i = 0; i < 24; i += 1) {
      await r.runtime.setState(state(["A", "B", "C"][i % 3]));
      assert.ok(live(r).length <= 3);
    }
    await r.runtime.setState(state("SILENCE"));
    await r.runtime.setState(state("SILENCE"));
    r.flush();
    assert.equal(live(r).length, 0);
    assert.equal(r.runtime.status().activeSources, 0);
    r.runtime.dispose();
    r.runtime.dispose();
    assert.equal(r.timers.size, 0);
    assert.ok(r.sources.every(source => source.stops === 1 && source.disconnects === 1));
    assert.ok(r.gains.every(gain => gain.disconnects === 1));
    assert.equal(r.output.disconnects, 0, "borrowed output is never disconnected");
  });

  test(`${kind}: repeated refresh does not postpone an outgoing source's retirement`, async () => {
    const r = rig(kind);
    await r.ready();
    await r.runtime.setState(state("A"));
    await r.runtime.setState(state("B"));
    const retirement = [...r.timers.keys()];
    for (let i = 0; i < 5; i += 1) await r.runtime.refresh();
    assert.deepEqual([...r.timers.keys()], retirement);
    r.flush();
    assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/B.wav?v=1"]);
    r.runtime.dispose();
  });

  test(`${kind}: zero cue gain is not a request to retire the selected source`, async () => {
    const r = rig(kind);
    await r.ready();
    const quiet = project();
    quiet.cues[0].gain = 0;
    await r.setProject(quiet);
    await r.runtime.setState(state("A"));
    const selected = live(r)[0];
    r.flush();
    assert.deepEqual(live(r), [selected]);
    assert.equal(r.runtime.status().fadingSources, 0);
    await r.setProject(project());
    assert.deepEqual(live(r), [selected]);
    assert.equal(r.gainProduct(selected), 0.6);
    r.runtime.dispose();
  });

  test(`${kind}: disposal during pending decode prevents any new source or retained timer`, async () => {
    const r = rig(kind, { delayedDecode: true });
    await r.ready();
    const pending = r.runtime.setState(state("A"));
    await settle();
    r.runtime.dispose();
    r.runtime.dispose();
    r.decodes[0].resolve();
    assert.equal(await pending, false);
    assert.equal(await r.runtime.refresh(), false);
    assert.equal(r.sources.length, 0);
    assert.equal(r.timers.size, 0);
    if (kind === "preview") assert.equal(r.context.closes, 1);
  });
}

test("runtime: volume and mute do not cancel outgoing retirement or destroy the selected source", async () => {
  const r = rig("runtime");
  await r.ready();
  await r.runtime.setState(state("A"));
  await r.runtime.setState(state("B"));
  const retiring = [...r.timers.keys()];
  r.runtime.setVolume(0.25);
  assert.deepEqual([...r.timers.keys()], retiring, "volume does not own transition timers");
  assert.equal(r.runtime.status().fadingSources, 1);
  r.runtime.setVolume(0);
  assert.ok(live(r).every(source => r.gainProduct(source) === 0), "mute silences both crossfade legs");
  r.flush();
  assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/B.wav?v=1"]);
  r.runtime.setVolume(0.5);
  assert.equal(r.gainProduct(live(r)[0]), 0.3, "unmute restores the existing selected source");
  r.runtime.dispose();
  r.runtime.dispose();
  assert.ok(r.sources.every(source => source.stops === 1 && source.disconnects === 1));
  assert.ok(r.gains.every(gain => gain.disconnects === 1));
});

test("preview: master/music volume and mute preserve outgoing retirement during crossfade", async () => {
  const r = rig("preview");
  await r.ready();
  await r.runtime.setState(state("A"));
  await r.runtime.setState(state("B"));
  const retiring = [...r.timers.keys()];
  r.runtime.setMasterVolume(0.5);
  r.runtime.setMusicVolume(0.25);
  r.runtime.setMuted(true);
  assert.deepEqual([...r.timers.keys()], retiring);
  assert.ok(live(r).every(source => r.gainProduct(source) === 0));
  r.flush();
  assert.deepEqual(live(r).map(source => source.buffer.uri), ["/audio/B.wav?v=1"]);
  r.runtime.setMuted(false);
  assert.equal(r.gainProduct(live(r)[0]), 0.075);
  r.runtime.dispose();
  r.runtime.dispose();
  assert.ok(r.sources.every(source => source.stops === 1 && source.disconnects === 1));
  assert.ok(r.gains.every(gain => gain.disconnects === 1));
});
