import test from "node:test";
import assert from "node:assert/strict";

import { createWorldAudio } from "../src/audio/world-audio.js";

const musicProject = () => ({
  schemaVersion: 1,
  projectId: "inha-world-music-runtime",
  name: "P1 Runtime Fixture",
  assets: [{
    id: "music.runtime",
    type: "audio",
    uri: "/assets/audio/runtime.wav",
    title: "Runtime",
    artist: "",
    fileName: "runtime.wav",
    mimeType: "audio/wav",
    byteLength: 1024,
    durationSeconds: 1,
    rights: { source: "team", license: "internal-test", approved: true },
    editor: { loop: { enabled: false, startSeconds: 0, endSeconds: 1 } }
  }],
  cues: [
    {
      id: "cue.gate",
      name: "Gate",
      assetId: "music.runtime",
      bus: "music",
      gain: 0.7,
      loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.9 },
      transition: { fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
      priority: 0,
      tags: [],
      notes: ""
    },
    {
      id: "cue.pond",
      name: "Pond",
      assetId: "music.runtime",
      bus: "music",
      gain: 0.6,
      loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.9 },
      transition: { fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
      priority: 0,
      tags: [],
      notes: ""
    },
    {
      id: "cue.room",
      name: "Room",
      assetId: "music.runtime",
      bus: "music",
      gain: 0.5,
      loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.9 },
      transition: { fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
      priority: 0,
      tags: [],
      notes: ""
    }
  ],
  bindings: [
    { id: "binding.gate", targetType: "placeZone", targetId: "AREA_MAIN_GATE", cueId: "cue.gate", enabled: true, priority: 10, fallback: "silence" },
    { id: "binding.pond", targetType: "placeZone", targetId: "AREA_INKYUNG_STUDENT_CENTER", cueId: "cue.pond", enabled: true, priority: 10, fallback: "silence" },
    { id: "binding.room", targetType: "room", targetId: "ROOM_PERSONAL_BASIC", cueId: "cue.room", enabled: true, priority: 10, fallback: "silence" }
  ],
  metadata: {}
});

function rig({ failMusic = false } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const sources = [];
  const contexts = [];
  let timerId = 0;

  class Param {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    connect(next) { return next; }
    disconnect() { this.disconnected = true; }
  }
  class Context {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.sampleRate = 1000;
      this.destination = new Node();
      contexts.push(this);
    }
    createGain() {
      const node = new Node();
      node.gain = new Param();
      return node;
    }
    createBiquadFilter() {
      const node = new Node();
      node.frequency = new Param();
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
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    async decodeAudioData() { return { duration: 1 }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }

  const documentLike = {
    visibilityState: "visible",
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }
  };

  const audio = createWorldAudio({
    documentLike,
    AudioContextClass: Context,
    musicAssetLoader: async () => {
      if (failMusic) throw new Error("fixture music missing");
      return new ArrayBuffer(8);
    },
    setTimeoutFn: handler => {
      const id = ++timerId;
      timers.set(id, handler);
      return id;
    },
    clearTimeoutFn: id => timers.delete(id)
  });

  const flush = () => {
    for (const [id, handler] of [...timers]) {
      timers.delete(id);
      handler();
    }
  };

  return { audio, timers, sources, contexts, flush };
}

test("P1 WorldAudio shares one context across ambience and MUSIC bus", async () => {
  const r = rig();
  await r.audio.setMusicProject(musicProject());
  await r.audio.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });

  const locked = r.audio.status();
  assert.equal(locked.music.configState, "ready");
  assert.equal(locked.music.cueId, "cue.gate");
  assert.equal(locked.context, "locked");

  assert.equal(await r.audio.unlock(), true);
  let status = r.audio.status();
  assert.equal(r.contexts.length, 1, "ambience and music share one AudioContext");
  assert.equal(status.ambienceSources, 2);
  assert.equal(status.music.activeSources, 1);
  assert.equal(status.activeSources, 3);
  assert.equal(status.music.cueId, "cue.gate");

  await r.audio.setState({ space: "campus", placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" });
  status = r.audio.status();
  assert.equal(status.music.cueId, "cue.pond");
  assert.equal(status.music.activeSources, 2, "outgoing and incoming music overlap while crossfading");
  r.flush();
  status = r.audio.status();
  assert.equal(status.ambienceSources, 2);
  assert.equal(status.music.activeSources, 1);
  assert.equal(status.activeSources, 3);

  await r.audio.setState({ space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(r.audio.status().music.cueId, "cue.room");
  r.flush();
  assert.equal(r.audio.status().music.activeSources, 1);

  r.audio.dispose();
  assert.equal(r.audio.status().activeSources, 0);
  assert.equal(r.timers.size, 0);
  assert.equal(r.sources.filter(source => !source.stopped).length, 0);
});

test("P1 music failure degrades MUSIC only while ambience remains usable", async () => {
  const r = rig({ failMusic: true });
  await r.audio.setMusicProject(musicProject());
  await r.audio.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(await r.audio.unlock(), true);

  const status = r.audio.status();
  assert.equal(status.degraded, false, "WorldAudio remains healthy");
  assert.equal(status.ambienceSources, 2, "ambience still plays");
  assert.equal(status.music.degraded, true, "MUSIC layer reports isolated degradation");
  assert.match(status.music.lastError, /fixture music missing/);
  assert.equal(status.music.activeSources, 0);

  r.audio.dispose();
});

test("P1 config errors fail closed to ambience-only and setMusicVolume does not affect master volume", async () => {
  const r = rig();
  await r.audio.setMusicConfigError(new Error("bad runtime config"));
  await r.audio.setState({ space: "campus", placeZoneId: "AREA_MAIN_GATE" });
  await r.audio.unlock();

  r.audio.setVolume(0.8);
  assert.equal(r.audio.setMusicVolume(0.25), 0.25);
  const status = r.audio.status();
  assert.equal(status.volume, 0.8);
  assert.equal(status.music.configState, "degraded");
  assert.equal(status.music.activeSources, 0);
  assert.equal(status.ambienceSources, 2);

  r.audio.dispose();
});
