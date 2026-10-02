import { normalizeMusicState, resolveMusicBinding } from "./music-binding-resolver.js";

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export function createRuntimeMusicLayer({
  getContext,
  getOutput,
  loadAssetArrayBuffer = async asset => {
    const uri = String(asset?.uri || "");
    if (!uri || uri.startsWith("project://")) throw new Error(`E_MUSIC_RUNTIME_ASSET_URI:${asset?.id || "unknown"}`);
    const response = await fetch(uri, { cache: "force-cache" });
    if (!response.ok) throw new Error(`E_MUSIC_RUNTIME_ASSET_HTTP:${response.status}`);
    return response.arrayBuffer();
  },
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  let project = null;
  let desired = normalizeMusicState();
  let generation = 0;
  let volume = 1;
  let degraded = false;
  let lastError = null;
  let configState = "unloaded";
  let configProjectId = null;
  let disposed = false;
  let currentResolved = resolveMusicBinding(project, desired);
  const handles = new Map();
  const buffers = new Map();

  function context() { return getContext?.() ?? null; }
  function output() { return getOutput?.() ?? null; }

  function stopHandle(id) {
    const handle = handles.get(id);
    if (!handle) return false;
    if (handle.timer !== null) clearTimeoutFn(handle.timer);
    handle.timer = null;
    handle.source.onended = null;
    try { handle.source.stop(); } catch {}
    handle.source.disconnect();
    handle.gain.disconnect();
    handles.delete(id);
    return true;
  }

  function fadeHandle(handle, target, seconds) {
    const ctx = context();
    if (!ctx) return;
    if (handle.timer !== null) {
      clearTimeoutFn(handle.timer);
      handle.timer = null;
    }
    const now = ctx.currentTime;
    const duration = Math.max(0, Number(seconds) || 0);
    handle.gain.gain.cancelScheduledValues?.(now);
    handle.gain.gain.setValueAtTime?.(handle.gain.gain.value, now);
    if (duration === 0) {
      handle.gain.gain.setValueAtTime?.(target, now);
      handle.gain.gain.value = target;
      if (target === 0) stopHandle(handle.cueId);
      return;
    }
    handle.gain.gain.linearRampToValueAtTime?.(target, now + duration);
    if (!handle.gain.gain.linearRampToValueAtTime) handle.gain.gain.value = target;
    if (target === 0) {
      handle.timer = setTimeoutFn(() => stopHandle(handle.cueId), Math.ceil(duration * 1000) + 50);
    }
  }

  function configureSource(handle, cue) {
    handle.cue = cue;
    handle.source.loop = cue.loop?.enabled === true;
    if (handle.source.loop) {
      handle.source.loopStart = Math.max(0, Number(cue.loop.startSeconds) || 0);
      handle.source.loopEnd = Math.max(handle.source.loopStart, Number(cue.loop.endSeconds) || 0);
    }
  }

  async function bufferFor(asset) {
    const ctx = context();
    const key = `${asset.id}::${asset.uri || ""}`;
    if (buffers.has(key)) return buffers.get(key);
    const bytes = await loadAssetArrayBuffer(asset);
    const arrayBuffer = bytes instanceof ArrayBuffer ? bytes : await bytes?.arrayBuffer?.();
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error(`E_MUSIC_RUNTIME_ASSET_BYTES:${asset.id}`);
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    buffers.set(key, buffer);
    return buffer;
  }

  function startCue(resolved, buffer) {
    const ctx = context();
    const bus = output();
    const { cue, asset } = resolved;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(bus);
    const handle = { cueId: cue.id, assetId: asset.id, source, gain, cue, timer: null };
    configureSource(handle, cue);
    const fadeIn = Math.max(0, Number(cue.transition?.fadeInSeconds) || 0);
    const target = clamp01(volume) * Number(cue.gain ?? 1);
    gain.gain.value = fadeIn > 0 ? 0 : target;
    handles.set(cue.id, handle);
    source.onended = () => {
      if (handles.get(cue.id) !== handle) return;
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      handles.delete(cue.id);
    };
    source.start();
    if (fadeIn > 0) fadeHandle(handle, target, fadeIn);
    return handle;
  }

  async function apply(token = ++generation) {
    const ctx = context();
    if (disposed || !ctx || ctx.state !== "running" || !output()) {
      currentResolved = resolveMusicBinding(project, desired);
      return false;
    }

    const resolved = resolveMusicBinding(project, desired);
    currentResolved = resolved;
    if (!project || !resolved.binding || !resolved.cue || !resolved.asset) {
      for (const handle of [...handles.values()]) {
        fadeHandle(handle, 0, handle.cue.transition?.fadeOutSeconds ?? 0);
      }
      if (configState !== "degraded") {
        degraded = false;
        lastError = null;
      }
      return true;
    }

    let buffer;
    try { buffer = await bufferFor(resolved.asset); }
    catch (error) {
      if (token !== generation || disposed) return false;
      degraded = true;
      lastError = error?.message || "E_MUSIC_RUNTIME_ASSET_LOAD";
      for (const handle of [...handles.values()]) {
        fadeHandle(handle, 0, handle.cue.transition?.fadeOutSeconds ?? 0);
      }
      return false;
    }
    if (token !== generation || disposed || context()?.state !== "running") return false;

    degraded = false;
    lastError = null;
    for (const handle of [...handles.values()]) {
      if (handle.cueId !== resolved.cue.id) {
        fadeHandle(handle, 0, handle.cue.transition?.fadeOutSeconds ?? 0);
      }
    }

    let handle = handles.get(resolved.cue.id);
    if (handle && handle.assetId !== resolved.asset.id) {
      stopHandle(handle.cueId);
      handle = null;
    }
    const target = clamp01(volume) * Number(resolved.cue.gain ?? 1);
    if (!handle) handle = startCue(resolved, buffer);
    else {
      configureSource(handle, resolved.cue);
      fadeHandle(handle, target, resolved.cue.transition?.fadeInSeconds ?? 0);
    }
    return true;
  }

  function setProject(next) {
    project = next ?? null;
    configState = project ? "ready" : "unloaded";
    configProjectId = project?.projectId ?? null;
    degraded = false;
    lastError = null;
    buffers.clear();
    generation += 1;
    return apply(generation);
  }

  function setConfigError(error) {
    project = null;
    configState = "degraded";
    configProjectId = null;
    degraded = true;
    lastError = error?.message || String(error || "E_MUSIC_RUNTIME_CONFIG");
    generation += 1;
    return apply(generation);
  }

  function setState(state) {
    desired = normalizeMusicState(state);
    return apply(++generation);
  }

  function setVolume(value) {
    volume = clamp01(value);
    const ctx = context();
    if (!ctx) return;
    for (const handle of handles.values()) {
      const target = volume * Number(handle.cue?.gain ?? 1);
      fadeHandle(handle, target, 0.05);
    }
  }

  function status() {
    return Object.freeze({
      configState,
      configProjectId,
      targetType: currentResolved?.targetType ?? (desired.space === "campus" ? "placeZone" : "room"),
      targetId: currentResolved?.targetId ?? (desired.space === "campus" ? desired.placeZoneId : desired.space),
      bindingId: currentResolved?.binding?.id ?? null,
      cueId: currentResolved?.cue?.id ?? null,
      cueName: currentResolved?.cue?.name ?? null,
      assetId: currentResolved?.asset?.id ?? null,
      activeSources: handles.size,
      fadingSources: [...handles.values()].filter(handle => handle.timer !== null).length,
      degraded,
      lastError,
      volume
    });
  }

  return {
    setProject,
    setConfigError,
    setState,
    setVolume,
    refresh: () => apply(++generation),
    status,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const id of [...handles.keys()]) stopHandle(id);
      buffers.clear();
    }
  };
}
