import { AUDIO_TRANSITION, resolveAudioZone } from "./audio-zones.js";
import { makeAmbienceBuffer } from "./synth-ambience.js";
import { createRuntimeMusicLayer } from "./music-runtime.js";

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

export function createWorldAudio({
  documentLike = globalThis.document,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fadeSeconds = AUDIO_TRANSITION.fadeSeconds,
  musicAssetLoader = undefined,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  let context = null;
  let master = null;
  let ambienceBus = null;
  let musicBus = null;
  let desired = { space: "campus", placeZoneId: null, placeId: null };
  let volume = 1;
  let musicVolume = 1;
  let degraded = false;
  let disposed = false;
  const handles = new Map();
  const buffers = new Map();
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

  function apply() {
    if (!context || context.state !== "running" || disposed) return;
    const profile = resolveAudioZone(desired);
    for (const [id, handle] of handles) {
      if (id !== profile?.id && !handle.timer) fade(handle, 0);
    }
    if (profile) {
      const handle = handles.get(profile.id) ?? startProfile(profile);
      if (handle.timer || handle.gain.gain.value < 1) fade(handle, 1);
    }
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
    desired = { space: state?.space ?? "campus", placeZoneId: state?.placeZoneId ?? null, placeId: state?.placeId ?? null };
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
      const ambienceSources = [...handles.values()].reduce((count, handle) => count + handle.sources.length, 0);
      const musicStatus = music.status();
      return {
        zone: profile?.id ?? null, ambience: profile?.ambience ?? null,
        exteriorMix: desired.space === "campus" && profile ? 1 : 0,
        interiorMix: profile?.id === "PERSONAL_ROOM" ? 1 : 0,
        ambienceSources,
        activeSources: ambienceSources + musicStatus.activeSources,
        context: context?.state ?? "locked", degraded, volume,
        music: { ...musicStatus, volume: musicVolume }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const type of ["pointerdown", "keydown", "touchend"]) documentLike?.removeEventListener?.(type, onGesture);
      documentLike?.removeEventListener?.("visibilitychange", onVisibility);
      for (const id of [...handles.keys()]) stopHandle(id);
      music.dispose();
      ambienceBus?.disconnect();
      musicBus?.disconnect();
      master?.disconnect();
      void context?.close?.().catch(() => {});
      buffers.clear();
    }
  };
}
