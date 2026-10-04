import test from "node:test";
import assert from "node:assert/strict";
import { AUDIO_PROFILES, resolveAudioZone } from "../src/audio/audio-zones.js";
import { createWorldAudio } from "../src/audio/world-audio.js";
import {
  AF07_R2_ASSET_IDS,
  AF07_R2_PROFILE_ID,
  resolveAssetFactoryPreviewAmbience
} from "../src/audio/asset-factory-preview.js";

function rig({
  locked = false,
  unavailable = false,
  assetFactoryPreviewId = null,
  ambienceAssetLoader = undefined
} = {}) {
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
    disconnect() {}
  }
  class Context {
    constructor() { this.state = "suspended"; this.currentTime = 0; this.sampleRate = 1000; this.destination = new Node(); contexts.push(this); }
    createGain() { const node = new Node(); node.gain = new Param(); return node; }
    createBiquadFilter() { const node = new Node(); node.frequency = new Param(); return node; }
    createBufferSource() { const node = new Node(); node.loop = false; node.start = () => { node.started = true; }; node.stop = () => { node.stopped = true; }; sources.push(node); return node; }
    createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    async resume() { if (locked) throw new Error("gesture blocked"); this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }
  const documentLike = {
    visibilityState: "visible",
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type) { for (const handler of listeners.get(type) ?? []) handler(); },
    count() { return [...listeners.values()].reduce((n, group) => n + group.size, 0); }
  };
  const audio = createWorldAudio({
    documentLike,
    AudioContextClass: unavailable ? null : Context,
    assetFactoryPreviewId,
    ...(ambienceAssetLoader ? { ambienceAssetLoader } : {}),
    setTimeoutFn: handler => { const id = ++timerId; timers.set(id, handler); return id; },
    clearTimeoutFn: id => timers.delete(id)
  });
  const flush = () => { for (const [id, handler] of [...timers]) { timers.delete(id); handler(); } };
  return { audio, documentLike, flush, sources, contexts, timers };
}

test("room overrides Place Zone; unknown areas and other rooms are quiet", () => {
  assert.equal(resolveAudioZone({ placeZoneId: "AREA_MAIN_GATE" }), AUDIO_PROFILES.MAIN_GATE);
  assert.equal(resolveAudioZone({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" }), AUDIO_PROFILES.INKYUNG);
  assert.equal(resolveAudioZone({ space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_MAIN_GATE" }), AUDIO_PROFILES.PERSONAL_ROOM);
  assert.equal(resolveAudioZone({ space: "ROOM_DORM1_LOBBY", placeZoneId: "AREA_MAIN_GATE" }), null);
  assert.equal(resolveAudioZone({ placeZoneId: "UNKNOWN" }), null);
});

test("gate, pond and room crossfade without duplicate steady loops", async () => {
  const r = rig();
  r.audio.setState({ placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(r.audio.status().context, "locked");
  await r.audio.unlock();
  assert.equal(r.audio.status().activeSources, 2);
  r.audio.setState({ placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(r.audio.status().activeSources, 2);
  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" });
  assert.equal(r.audio.status().activeSources, 4);
  r.flush();
  assert.equal(r.audio.status().activeSources, 2);
  assert.equal(r.audio.status().zone, "INKYUNG");
  r.audio.setState({ space: "ROOM_PERSONAL_BASIC", placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" });
  r.flush();
  assert.equal(r.audio.status().activeSources, 2);
  assert.equal(r.audio.status().zone, "PERSONAL_ROOM");
  assert.equal(r.audio.status().exteriorMix, 0);
  r.audio.dispose();
  assert.equal(r.audio.status().activeSources, 0);
  assert.equal(r.documentLike.count(), 0);
});

test("ten campus to room cycles keep one context and bounded sources", async () => {
  const r = rig();
  await r.audio.unlock();
  for (let i = 0; i < 10; i++) {
    r.audio.setState({ placeZoneId: "AREA_MAIN_GATE" }); r.flush();
    assert.equal(r.audio.status().activeSources, 2);
    r.audio.setState({ space: "ROOM_DORM1_LOBBY" }); r.flush();
    assert.equal(r.audio.status().activeSources, 0);
    r.audio.setState({ space: "ROOM_PERSONAL_BASIC" }); r.flush();
    assert.equal(r.audio.status().activeSources, 2);
    r.audio.setState({ space: "ROOM_DORM1_LOBBY" }); r.flush();
    r.audio.setState({ placeZoneId: "AREA_MAIN_GATE" }); r.flush();
    assert.equal(r.audio.status().activeSources, 2);
  }
  assert.equal(r.contexts.length, 1);
  assert.equal(r.documentLike.count(), 4);
  r.audio.dispose();
  assert.equal(r.documentLike.count(), 0);
  assert.equal(r.timers.size, 0);
  assert.equal(r.sources.filter(source => !source.stopped).length, 0);
});

test("unavailable and suspended audio never block zone state", async () => {
  const missing = rig({ unavailable: true });
  missing.audio.setState({ placeZoneId: "AREA_MAIN_GATE" });
  assert.equal(await missing.audio.unlock(), false);
  assert.equal(missing.audio.status().degraded, true);
  missing.audio.dispose();
  const blocked = rig({ locked: true });
  blocked.audio.setState({ space: "ROOM_PERSONAL_BASIC" });
  assert.equal(await blocked.audio.unlock(), false);
  assert.equal(blocked.audio.status().zone, "PERSONAL_ROOM");
  blocked.audio.dispose();
});



test("AF-07 R2 preview profile replaces Inkyung synth with base layers and adds rain only in rain", () => {
  assert.equal(resolveAssetFactoryPreviewAmbience({
    profileId: "unknown", zone: "INKYUNG", weather: "RAIN"
  }), null);
  assert.equal(resolveAssetFactoryPreviewAmbience({
    profileId: AF07_R2_PROFILE_ID, zone: "MAIN_GATE", weather: "RAIN"
  }), null);

  const clear = resolveAssetFactoryPreviewAmbience({
    profileId: AF07_R2_PROFILE_ID, zone: "INKYUNG", weather: "CLEAR"
  });
  assert.equal(clear?.assets.length, 2);
  assert.equal(clear?.replaceSynthetic, true);
  assert.deepEqual(clear?.assets.map(asset => asset.id), [
    AF07_R2_ASSET_IDS.WATER_SHORE,
    AF07_R2_ASSET_IDS.AIR_LIFE
  ]);

  const rain = resolveAssetFactoryPreviewAmbience({
    profileId: AF07_R2_PROFILE_ID, zone: "INKYUNG", weather: "RAIN"
  });
  assert.equal(rain?.assets.length, 3);
  assert.equal(rain?.assets[2].id, AF07_R2_ASSET_IDS.RAIN);
  assert.ok(rain?.assets.every(asset => asset.rights.status === "verified"));
  assert.ok(rain?.assets.every(asset => asset.runtime.previewOnly === true));
});

test("AF-07 R2 loads three rain layers, retires synth in preview, and reuses base buffers for clear", async () => {
  let loads = 0;
  const r = rig({
    assetFactoryPreviewId: AF07_R2_PROFILE_ID,
    ambienceAssetLoader: async () => {
      loads += 1;
      return { id: `af07-buffer-${loads}`, duration: 30 };
    }
  });
  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", weather: "RAIN" });
  await r.audio.unlock();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  r.flush();
  let status = r.audio.status();
  assert.equal(loads, 3);
  assert.equal(status.zone, "INKYUNG");
  assert.equal(status.sampledAmbience.status, "active");
  assert.equal(status.sampledAmbience.activeAssetIds.length, 3);
  assert.equal(status.sampledAmbience.replacingSynthetic, true);
  assert.equal(status.ambienceSources, 3, "R2 rain uses water + air/life + rain after synth fallback retires");

  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", weather: "CLEAR" });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  r.flush();
  status = r.audio.status();
  assert.equal(loads, 3, "clear reuses the cached water and air/life buffers");
  assert.deepEqual(status.sampledAmbience.activeAssetIds, [
    AF07_R2_ASSET_IDS.WATER_SHORE,
    AF07_R2_ASSET_IDS.AIR_LIFE
  ]);
  assert.equal(status.ambienceSources, 2);
  r.audio.dispose();
});

test("AF-07 R2 asset load failure keeps the temporary synthetic Inkyung fallback", async () => {
  const r = rig({
    assetFactoryPreviewId: AF07_R2_PROFILE_ID,
    ambienceAssetLoader: async () => { throw new Error("cors blocked"); }
  });
  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", weather: "RAIN" });
  await r.audio.unlock();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const status = r.audio.status();
  assert.equal(status.sampledAmbience.status, "degraded");
  assert.equal(status.ambienceSources, 2);
  assert.equal(status.zone, "INKYUNG");
  r.audio.dispose();
});
