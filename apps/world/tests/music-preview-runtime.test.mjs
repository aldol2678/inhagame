import test from "node:test";
import assert from "node:assert/strict";

import {
  createMusicPreviewRuntime,
  normalizeMusicPreviewState,
  resolveMusicPreviewBinding
} from "../src/music-editor/music-preview-runtime.js";

const asset = Object.freeze({
  id: "music.preview",
  uri: "project://music.preview",
  durationSeconds: 1
});

const cue = (id, overrides = {}) => Object.freeze({
  id,
  name: id,
  assetId: asset.id,
  gain: 0.7,
  loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.9 },
  transition: { fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
  priority: 0,
  ...overrides
});

const project = (extraBindings = []) => ({
  assets: [asset],
  cues: [
    cue("cue.gate"),
    cue("cue.pond", { gain: 0.5 }),
    cue("cue.room", { gain: 0.4 })
  ],
  bindings: [
    { id: "binding.gate", targetType: "placeZone", targetId: "AREA_MAIN_GATE", cueId: "cue.gate", enabled: true, priority: 10, fallback: "silence" },
    { id: "binding.pond", targetType: "placeZone", targetId: "AREA_INKYUNG_STUDENT_CENTER", cueId: "cue.pond", enabled: true, priority: 10, fallback: "silence" },
    { id: "binding.room", targetType: "room", targetId: "ROOM_PERSONAL_BASIC", cueId: "cue.room", enabled: true, priority: 10, fallback: "silence" },
    ...extraBindings
  ]
});

function rig({ unavailable = false } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const sources = [];
  const contexts = [];
  let timerId = 0;

  class Param {
    value = 1;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.disconnected = false; }
    connect(next) { return next; }
    disconnect() { this.disconnected = true; }
  }
  class Context {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = new Node();
      contexts.push(this);
    }
    createGain() {
      const node = new Node();
      node.gain = new Param();
      return node;
    }
    createBufferSource() {
      const node = new Node();
      node.loop = false;
      node.loopStart = 0;
      node.loopEnd = 0;
      node.start = () => { node.started = true; };
      node.stop = () => { node.stopped = true; };
      node.onended = null;
      sources.push(node);
      return node;
    }
    async decodeAudioData() { return { duration: 1 }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }

  const documentLike = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) ?? []) listener(); },
    count() { return [...listeners.values()].reduce((sum, group) => sum + group.size, 0); }
  };

  let currentProject = project();
  const runtime = createMusicPreviewRuntime({
    documentLike,
    AudioContextClass: unavailable ? null : Context,
    getProject: () => currentProject,
    loadAssetBlob: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
    setTimeoutFn: handler => { const id = ++timerId; timers.set(id, handler); return id; },
    clearTimeoutFn: id => timers.delete(id)
  });
  const flush = () => {
    for (const [id, handler] of [...timers]) {
      timers.delete(id);
      handler();
    }
  };
  return {
    runtime, documentLike, sources, contexts, timers, flush,
    setProject(next) { currentProject = next; }
  };
}

test("preview resolver gives Room precedence and highest Binding priority wins", () => {
  const lower = {
    id: "binding.gate.low",
    targetType: "placeZone",
    targetId: "AREA_MAIN_GATE",
    cueId: "cue.pond",
    enabled: true,
    priority: 1,
    fallback: "silence"
  };
  const p = project([lower]);

  assert.deepEqual(normalizeMusicPreviewState({ space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_MAIN_GATE" }), {
    space: "ROOM_PERSONAL_BASIC",
    placeZoneId: null
  });
  assert.equal(resolveMusicPreviewBinding(p, { space: "campus", placeZoneId: "AREA_MAIN_GATE" }).cue.id, "cue.gate");
  assert.equal(resolveMusicPreviewBinding(p, { space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_MAIN_GATE" }).cue.id, "cue.room");
  assert.equal(resolveMusicPreviewBinding(p, { space: "campus", placeZoneId: "AREA_UNKNOWN" }).cue, null);
});

test("preview crossfades gate, pond and room with bounded live sources", async () => {
  const r = rig();
  await r.runtime.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(r.runtime.status().context, "locked");

  assert.equal(await r.runtime.unlock(), true);
  assert.equal(r.runtime.status().cueId, "cue.gate");
  assert.equal(r.runtime.status().activeSources, 1);
  assert.equal(r.contexts.length, 1);

  assert.equal(await r.runtime.suspend(), true);
  assert.equal(r.runtime.status().context, "suspended");
  assert.equal(r.runtime.status().activeSources, 0, "explicit Studio suspension clears live sources");
  assert.equal(await r.runtime.unlock(), true);
  assert.equal(r.runtime.status().context, "running");
  assert.equal(r.runtime.status().cueId, "cue.gate");
  assert.equal(r.runtime.status().activeSources, 1);

  await r.runtime.setState({ space: "campus", placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" });
  assert.equal(r.runtime.status().cueId, "cue.pond");
  assert.equal(r.runtime.status().activeSources, 2, "outgoing + incoming overlap during crossfade");
  r.flush();
  assert.equal(r.runtime.status().activeSources, 1);

  await r.runtime.setState({ space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(r.runtime.status().targetType, "room");
  assert.equal(r.runtime.status().cueId, "cue.room");
  assert.equal(r.runtime.status().activeSources, 2);
  r.flush();
  assert.equal(r.runtime.status().activeSources, 1);

  r.runtime.dispose();
  assert.equal(r.runtime.status().activeSources, 0);
  assert.equal(r.documentLike.count(), 0);
  assert.equal(r.timers.size, 0);
  assert.equal(r.sources.filter(source => !source.stopped).length, 0);
});

test("twenty rapid state changes reuse fading handles and leave no orphan source or timer", async () => {
  const r = rig();
  await r.runtime.unlock();
  const states = [
    { space: "campus", placeZoneId: "AREA_MAIN_GATE" },
    { space: "campus", placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" },
    { space: "ROOM_PERSONAL_BASIC" }
  ];
  for (let index = 0; index < 20; index += 1) {
    await r.runtime.setState(states[index % states.length]);
    assert.ok(r.runtime.status().activeSources <= 3, "one live handle per Cue at most");
  }
  r.flush();
  assert.equal(r.runtime.status().activeSources, 1);
  assert.equal(r.runtime.status().fadingSources, 0);

  r.runtime.dispose();
  assert.equal(r.timers.size, 0);
  assert.equal(r.sources.filter(source => !source.stopped).length, 0);
});

test("preview volume, mute, visibility and load failures are isolated from the project", async () => {
  const r = rig();
  const current = project();
  const before = JSON.stringify(current);
  r.setProject(current);
  await r.runtime.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });
  await r.runtime.unlock();

  r.runtime.setMasterVolume(0.6);
  r.runtime.setMusicVolume(0.4);
  r.runtime.setMuted(true);
  assert.equal(r.runtime.status().masterVolume, 0.6);
  assert.equal(r.runtime.status().musicVolume, 0.4);
  assert.equal(r.runtime.status().muted, true);

  r.documentLike.visibilityState = "hidden";
  r.documentLike.emit("visibilitychange");
  await Promise.resolve();
  assert.equal(r.contexts[0].state, "suspended");
  r.documentLike.visibilityState = "visible";
  r.documentLike.emit("visibilitychange");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(r.contexts[0].state, "running");

  assert.equal(JSON.stringify(current), before, "preview lifecycle never mutates project data");
  r.runtime.dispose();

  const unavailable = rig({ unavailable: true });
  await unavailable.runtime.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(await unavailable.runtime.unlock(), false);
  assert.equal(unavailable.runtime.status().degraded, true);
  unavailable.runtime.dispose();
});
