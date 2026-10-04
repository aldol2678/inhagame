import { AUDIO_TRANSITION, resolveAudioZone } from "./audio-zones.js";
import { makeAmbienceBuffer } from "./synth-ambience.js";
import { createRuntimeMusicLayer } from "./music-runtime.js";
import { resolveAssetFactoryPreviewAmbience } from "./asset-factory-preview.js";

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

async function defaultAmbienceAssetLoader(context, url, fetchFn) {
  if (typeof fetchFn !== "function") throw new Error("E_AMBIENCE_ASSET_FETCH_UNAVAILABLE");
  if (typeof context?.decodeAudioData !== "function") throw new Error("E_AMBIENCE_ASSET_DECODE_UNAVAILABLE");
  const response = await fetchFn(url, { mode: "cors", cache: "force-cache" });
  if (!response?.ok) throw new Error(`E_AMBIENCE_ASSET_HTTP_${response?.status ?? "UNKNOWN"}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

export function createWorldAudio({
  documentLike = globalThis.document,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fadeSeconds = AUDIO_TRANSITION.fadeSeconds,
  musicAssetLoader = undefined,
  ambienceAssetLoader = undefined,
  assetFactoryPreviewId = null,
  fetchFn = globalThis.fetch,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  let context = null;
  let master = null;
  let ambienceBus = null;
  let musicBus = null;
  let desired = { space: "campus", placeZoneId: null, placeId: null, weather: null };
  let volume = 1;
  let musicVolume = 1;
  let degraded = false;
  let disposed = false;
  const handles = new Map();
  const buffers = new Map();
  const sampledBuffers = new Map();
  let sampled = null;
  let sampledRequest = 0;
  let sampledError = null;
  const loadAmbienceAsset = ambienceAssetLoader ??
    ((audioContext, url) => defaultAmbienceAssetLoader(audioContext, url, fetchFn));
  const music = createRuntimeMusicLayer({
    getContext: () => context,
    getOutput: () => musicBus,
    ...(musicAssetLoader ? { loadAssetArrayBuffer: musicAssetLoader } : {}),
    setTimeoutFn,
    clearTimeoutFn
  });

  function stopHandle(id) {
    const handle = handles.get(id);
    if (!handle) return;
    if (handle.timer) clearTimeoutFn(handle.timer);
    for (const source of handle.sources) { try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); }
    for (const node of handle.nodes) node.disconnect();
    handles.delete(id);
  }

  function stopSampled() {
    if (!sampled) return;
    for (const source of sampled.sources) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    for (const node of sampled.nodes) node.disconnect();
    sampled = null;
  }

  function ensureSynthetic(profile) {
    if (!profile) return null;
    const handle = handles.get(profile.id) ?? startProfile(profile);
    if (handle.timer || handle.gain.gain.value < 1) fade(handle, 1);
    return handle;
  }

  function fade(handle, target) {
    if (handle.timer) { clearTimeoutFn(handle.timer); handle.timer = null; }
    const now = context.currentTime;
    handle.gain.gain.cancelScheduledValues(now);
    handle.gain.gain.setValueAtTime(handle.gain.gain.value, now);
    handle.gain.gain.linearRampToValueAtTime(target, now + fadeSeconds);
    if (target === 0) {
      handle.timer = setTimeoutFn(() => stopHandle(handle.id), Math.ceil(fadeSeconds * 1000) + 50);
    }
  }

  function startProfile(profile) {
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(ambienceBus);
    const handle = { id: profile.id, gain, sources: [], nodes: [gain], timer: null };
    try {
      for (const layer of profile.layers) {
        let buffer = buffers.get(layer.kind);
        if (!buffer) { buffer = makeAmbienceBuffer(context, layer.kind); buffers.set(layer.kind, buffer); }
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const layerGain = context.createGain();
        source.buffer = buffer;
        source.loop = true;
        filter.type = "lowpass";
        filter.frequency.value = layer.filterHz;
        layerGain.gain.value = layer.gain;
        source.connect(filter).connect(layerGain).connect(gain);
        handle.sources.push(source);
        handle.nodes.push(filter, layerGain);
      }
      handles.set(profile.id, handle);
      for (const source of handle.sources) source.start();
      return handle;
    } catch (error) {
      handles.set(profile.id, handle);
      stopHandle(profile.id);
      throw error;
    }
  }

  async function refreshSampled(profile) {
    const plan = resolveAssetFactoryPreviewAmbience({
      profileId: assetFactoryPreviewId,
      zone: profile?.id ?? null,
      weather: desired.weather
    });
    if (!plan) {
      sampledRequest += 1;
      stopSampled();
      sampledError = null;
      return;
    }
    if (sampled?.planId === plan.id) return;

    const request = ++sampledRequest;
    try {
      const loaded = await Promise.all(plan.assets.map(async asset => {
        let buffer = sampledBuffers.get(asset.id);
        if (!buffer) {
          buffer = await loadAmbienceAsset(context, asset.uri);
          if (request !== sampledRequest || disposed) return null;
          sampledBuffers.set(asset.id, buffer);
        }
        return { asset, buffer };
      }));
      if (request !== sampledRequest || disposed || context?.state !== "running" || loaded.some(item => !item)) return;

      const current = resolveAssetFactoryPreviewAmbience({
        profileId: assetFactoryPreviewId,
        zone: resolveAudioZone(desired)?.id ?? null,
        weather: desired.weather
      });
      if (current?.id !== plan.id) return;

      const sources = [];
      const nodes = [];
      const groupGain = context.createGain();
      groupGain.gain.value = 1;
      groupGain.connect(ambienceBus);
      nodes.push(groupGain);

      for (const { asset, buffer } of loaded) {
        const source = context.createBufferSource();
        const layerGain = context.createGain();
        source.buffer = buffer;
        source.loop = true;
        layerGain.gain.value = clamp(asset.runtime.gain);
        source.connect(layerGain).connect(groupGain);
        sources.push(source);
        nodes.push(layerGain);
      }

      const previous = sampled;
      sampled = {
        planId: plan.id,
        assetIds: plan.assets.map(asset => asset.id),
        sources,
        nodes
      };
      for (let i = 0; i < loaded.length; i++) {
        const duration = Number(loaded[i].buffer?.duration);
        const requestedOffset = Number(loaded[i].asset.runtime.offsetSeconds) || 0;
        const offset = Number.isFinite(duration) && duration > 0 ? requestedOffset % duration : 0;
        sources[i].start(0, offset);
      }
      if (previous) {
        for (const source of previous.sources) {
          try { source.stop(); } catch { /* Already stopped. */ }
          source.disconnect();
        }
        for (const node of previous.nodes) node.disconnect();
      }
      if (plan.replaceSynthetic && profile && handles.has(profile.id)) fade(handles.get(profile.id), 0);
      sampledError = null;
    } catch (error) {
      if (request !== sampledRequest || disposed) return;
      stopSampled();
      sampledError = String(error?.message ?? error);
      ensureSynthetic(profile);
    }
  }

  function apply() {
    if (!context || context.state !== "running" || disposed) return;
    const profile = resolveAudioZone(desired);
    const plan = resolveAssetFactoryPreviewAmbience({
      profileId: assetFactoryPreviewId,
      zone: profile?.id ?? null,
      weather: desired.weather
    });
    for (const [id, handle] of handles) {
      if (id !== profile?.id && !handle.timer) fade(handle, 0);
    }
    const sampledReady = plan && sampled?.planId === plan.id;
    if (profile && !sampledReady) ensureSynthetic(profile);
    if (profile && sampledReady && plan.replaceSynthetic && handles.has(profile.id) && !handles.get(profile.id).timer) {
      fade(handles.get(profile.id), 0);
    }
    void refreshSampled(profile);
  }

  async function unlock() {
    if (disposed || !AudioContextClass) { degraded = true; return false; }
    try {
      if (!context) {
        context = new AudioContextClass();
        master = context.createGain();
        ambienceBus = context.createGain();
        musicBus = context.createGain();
        master.gain.value = volume;
        ambienceBus.gain.value = 1;
        musicBus.gain.value = musicVolume;
        ambienceBus.connect(master);
        musicBus.connect(master);
        master.connect(context.destination);
      }
      if (context.state !== "running") await context.resume();
      if (context.state !== "running") { degraded = true; return false; }
      degraded = false;
      apply();
      await music.refresh();
      return true;
    } catch {
      degraded = true;
      return false;
    }
  }

  function setState(state) {
    desired = {
      space: state?.space ?? "campus",
      placeZoneId: state?.placeZoneId ?? null,
      placeId: state?.placeId ?? null,
      weather: typeof state?.weather === "string" ? state.weather.toUpperCase() : null
    };
    try { apply(); } catch { degraded = true; }
    return music.setState(desired);
  }
  function setVolume(value) {
    volume = clamp(value);
    if (master && context) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(volume, context.currentTime, 0.04);
    }
  }
  function setMusicProject(project) {
    return music.setProject(project);
  }
  function setMusicConfigError(error) {
    return music.setConfigError(error);
  }
  function setMusicVolume(value) {
    musicVolume = clamp(value);
    const next = musicVolume;
    if (musicBus && context) {
      musicBus.gain.cancelScheduledValues?.(context.currentTime);
      musicBus.gain.setTargetAtTime?.(next, context.currentTime, 0.04);
      if (!musicBus.gain.setTargetAtTime) musicBus.gain.value = next;
    }
    return next;
  }
  function onVisibility() {
    if (!context || disposed) return;
    if (documentLike?.visibilityState === "hidden") { void context.suspend().catch(() => { degraded = true; }); }
    else void unlock();
  }
  // One-shot effects (e.g. the 울림돌 echo) share the unlocked context and the master volume.
  // The render callback schedules its own nodes; it is skipped while audio is locked.
  function playCue(render) {
    if (disposed || !context || context.state !== "running" || typeof render !== "function") return false;
    try { render(context, master); return true; }
    catch { return false; }
  }
  const onGesture = () => { void unlock(); };
  for (const type of ["pointerdown", "keydown", "touchend"]) documentLike?.addEventListener?.(type, onGesture, { passive: true });
  documentLike?.addEventListener?.("visibilitychange", onVisibility);

  return {
    unlock, setState, setVolume, setMusicProject, setMusicConfigError, setMusicVolume, playCue,
    status() {
      const profile = resolveAudioZone(desired);
      const syntheticSources = [...handles.values()].reduce((count, handle) => count + handle.sources.length, 0);
      const sampledSources = sampled?.sources.length ?? 0;
      const ambienceSources = syntheticSources + sampledSources;
      const requestedSampled = resolveAssetFactoryPreviewAmbience({
        profileId: assetFactoryPreviewId,
        zone: profile?.id ?? null,
        weather: desired.weather
      });
      const musicStatus = music.status();
      return {
        zone: profile?.id ?? null, ambience: profile?.ambience ?? null,
        exteriorMix: desired.space === "campus" && profile ? 1 : 0,
        interiorMix: profile?.id === "PERSONAL_ROOM" ? 1 : 0,
        ambienceSources,
        activeSources: ambienceSources + musicStatus.activeSources,
        context: context?.state ?? "locked", degraded, volume,
        sampledAmbience: {
          previewOnly: Boolean(assetFactoryPreviewId),
          requestedProfileId: requestedSampled?.id ?? null,
          requestedAssetIds: requestedSampled?.assets.map(asset => asset.id) ?? [],
          activeProfileId: sampled?.planId ?? null,
          activeAssetIds: sampled?.assetIds ?? [],
          status: sampled ? "active" : sampledError ? "degraded" : requestedSampled ? "loading" : "inactive",
          replacingSynthetic: Boolean(sampled && requestedSampled?.replaceSynthetic),
          error: sampledError
        },
        music: { ...musicStatus, volume: musicVolume }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const type of ["pointerdown", "keydown", "touchend"]) documentLike?.removeEventListener?.(type, onGesture);
      documentLike?.removeEventListener?.("visibilitychange", onVisibility);
      for (const id of [...handles.keys()]) stopHandle(id);
      sampledRequest += 1;
      stopSampled();
      music.dispose();
      ambienceBus?.disconnect();
      musicBus?.disconnect();
      master?.disconnect();
      void context?.close?.().catch(() => {});
      buffers.clear();
      sampledBuffers.clear();
    }
  };
}
