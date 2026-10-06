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


test("AF-07 R2 resolves central-registry base layers and rain variant", () => {
  assert.equal(resolveAssetFactoryPreviewAmbience({
    profileId: "unknown", zone: "INKYUNG", weather: "RAIN"
  }), null);
  const clear = resolveAssetFactoryPreviewAmbience({
    profileId: AF07_R2_PROFILE_ID, zone: "INKYUNG", weather: "CLEAR"
  });
  assert.deepEqual(clear?.layers.map(layer => layer.asset.id), [
    AF07_R2_ASSET_IDS.INKYUNG_WATER_SHORE,
    AF07_R2_ASSET_IDS.INKYUNG_AIR_LIFE
  ]);
  const rain = resolveAssetFactoryPreviewAmbience({
    profileId: AF07_R2_PROFILE_ID, zone: "INKYUNG", weather: "RAIN"
  });
  assert.equal(rain?.layers.length, 3);
  assert.equal(rain?.layers[2].asset.id, AF07_R2_ASSET_IDS.INKYUNG_RAIN);
  assert.ok(rain?.layers.every(layer => layer.asset.metadata.rights.status === "verified"));
  assert.ok(rain?.layers.every(layer => layer.asset.metadata.qa.status === "owner-accepted"));
});

test("AF-07 R2 replaces the temporary Inkyung synth after central-registry layers load", async () => {
  let loads = 0;
  const r = rig({
    assetFactoryPreviewId: AF07_R2_PROFILE_ID,
    ambienceAssetLoader: async () => {
      loads += 1;
      return { id: `af09-buffer-${loads}`, duration: 30 };
    }
  });
  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", weather: "RAIN" });
  await r.audio.unlock();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  r.flush();
  let status = r.audio.status();
  assert.equal(loads, 3);
  assert.equal(status.sampledAmbience.status, "active");
  assert.equal(status.sampledAmbience.activeAssetIds.length, 3);
  assert.equal(status.sampledAmbience.replacingSynthetic, true);
  assert.equal(status.ambienceSources, 3);

  r.audio.setState({ placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", weather: "CLEAR" });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  r.flush();
  status = r.audio.status();
  assert.equal(loads, 3);
  assert.deepEqual(status.sampledAmbience.activeAssetIds, [
    AF07_R2_ASSET_IDS.INKYUNG_WATER_SHORE,
    AF07_R2_ASSET_IDS.INKYUNG_AIR_LIFE
  ]);
  assert.equal(status.ambienceSources, 2);
  r.audio.dispose();
});

test("AF-07 R2 central-registry asset load failure preserves the procedural fallback", async () => {
  const r = rig({
    assetFactoryPreviewId: AF07_R2_PROFILE_ID,
    ambienceAssetLoader: async () => { throw new Error("asset unavailable"); }
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
