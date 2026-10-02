import { normalizeMusicState, resolveMusicBinding } from "../audio/music-binding-resolver.js";

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export const normalizeMusicPreviewState = normalizeMusicState;
export const resolveMusicPreviewBinding = resolveMusicBinding;

export function createMusicPreviewRuntime({
  documentLike = globalThis.document,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  getProject = () => null,
  loadAssetBlob = async () => null,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  let context = null;
  let master = null;
  let musicBus = null;
  let desired = normalizeMusicPreviewState();
  let masterVolume = 1;
  let musicVolume = 1;
  let muted = false;
  let degraded = false;
  let lastError = null;
  let disposed = false;
  let generation = 0;
  let currentResolved = resolveMusicPreviewBinding(getProject?.(), desired);
  const handles = new Map();
  const buffers = new Map();
  const listeners = new Set();

  const status = () => Object.freeze({
    state: desired,
    targetType: currentResolved?.targetType ?? (desired.space === "campus" ? (desired.placeId ? "place" : "placeZone") : "room"),
    targetId: currentResolved?.targetId ?? (desired.space === "campus" ? (desired.placeId ?? desired.placeZoneId) : desired.space),
    bindingId: currentResolved?.binding?.id ?? null,
    cueId: currentResolved?.cue?.id ?? null,
    cueName: currentResolved?.cue?.name ?? null,
    assetId: currentResolved?.asset?.id ?? null,
    activeSources: handles.size,
    fadingSources: [...handles.values()].filter(handle => handle.timer !== null).length,
    context: context?.state ?? "locked",
    degraded,
    lastError,
    masterVolume,
    musicVolume,
    muted
  });

  function emit() {
    const snapshot = status();
    for (const listener of listeners) listener(snapshot);
  }

  function applyBusLevels() {
    if (!context || !master || !musicBus) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues?.(now);
    musicBus.gain.cancelScheduledValues?.(now);
    master.gain.setTargetAtTime?.(muted ? 0 : masterVolume, now, 0.03);
    musicBus.gain.setTargetAtTime?.(musicVolume, now, 0.03);
    if (!master.gain.setTargetAtTime) master.gain.value = muted ? 0 : masterVolume;
    if (!musicBus.gain.setTargetAtTime) musicBus.gain.value = musicVolume;
  }

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
    if (!context) return;
    if (handle.timer !== null) {
      clearTimeoutFn(handle.timer);
      handle.timer = null;
    }
    const now = context.currentTime;
    const duration = Math.max(0, Number(seconds) || 0);
    handle.gain.gain.cancelScheduledValues?.(now);
    handle.gain.gain.setValueAtTime?.(handle.gain.gain.value, now);
    if (!handle.gain.gain.setValueAtTime) handle.gain.gain.value = handle.gain.gain.value;
    if (duration === 0) {
      handle.gain.gain.setValueAtTime?.(target, now);
      handle.gain.gain.value = target;
      if (target === 0) stopHandle(handle.cueId);
      return;
    }
    handle.gain.gain.linearRampToValueAtTime?.(target, now + duration);
    if (!handle.gain.gain.linearRampToValueAtTime) handle.gain.gain.value = target;
    if (target === 0) {
      handle.timer = setTimeoutFn(() => {
        stopHandle(handle.cueId);
        emit();
      }, Math.ceil(duration * 1000) + 50);
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
    const key = `${asset.id}::${asset.uri || ""}`;
    if (buffers.has(key)) return buffers.get(key);
    const blob = await loadAssetBlob(asset);
    if (!blob) throw new Error(`E_MUSIC_PREVIEW_ASSET_BLOB_MISSING:${asset.id}`);
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    buffers.set(key, buffer);
    return buffer;
  }

  function startCue(resolved, buffer) {
    const { cue, asset } = resolved;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(musicBus);
    const handle = { cueId: cue.id, assetId: asset.id, source, gain, cue, timer: null };
    configureSource(handle, cue);
    const fadeIn = Math.max(0, Number(cue.transition?.fadeInSeconds) || 0);
    gain.gain.value = fadeIn > 0 ? 0 : cue.gain;
    handles.set(cue.id, handle);
    source.onended = () => {
      if (handles.get(cue.id) !== handle) return;
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      handles.delete(cue.id);
      emit();
    };
    source.start();
    if (fadeIn > 0) fadeHandle(handle, cue.gain, fadeIn);
    return handle;
  }

  async function apply(token) {
    if (disposed || !context || context.state !== "running") {
      currentResolved = resolveMusicPreviewBinding(getProject?.(), desired);
      emit();
      return false;
    }
    const resolved = resolveMusicPreviewBinding(getProject?.(), desired);
    if (!resolved.binding || !resolved.cue || !resolved.asset) {
      currentResolved = resolved;
      for (const handle of [...handles.values()]) {
        fadeHandle(handle, 0, handle.cue.transition?.fadeOutSeconds ?? 0);
      }
      degraded = false;
      lastError = null;
      emit();
      return true;
    }

    let buffer;
    try {
      buffer = await bufferFor(resolved.asset);
    } catch (error) {
      if (token !== generation || disposed) return false;
      currentResolved = resolved;
      degraded = true;
      lastError = error?.message || "E_MUSIC_PREVIEW_ASSET_LOAD";
      for (const handle of [...handles.values()]) {
        fadeHandle(handle, 0, handle.cue.transition?.fadeOutSeconds ?? 0);
      }
      emit();
      return false;
    }
    if (token !== generation || disposed || context.state !== "running") return false;

    currentResolved = resolved;
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
    if (!handle) handle = startCue(resolved, buffer);
    else {
      configureSource(handle, resolved.cue);
      fadeHandle(handle, resolved.cue.gain, resolved.cue.transition?.fadeInSeconds ?? 0);
    }
    emit();
    return true;
  }

  async function ensureContext() {
    if (disposed || !AudioContextClass) {
      degraded = true;
      lastError = "E_MUSIC_PREVIEW_AUDIO_UNAVAILABLE";
      emit();
      return false;
    }
    if (!context) {
      context = new AudioContextClass();
      master = context.createGain();
      musicBus = context.createGain();
      musicBus.connect(master).connect(context.destination);
      applyBusLevels();
    }
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") {
      degraded = true;
      lastError = "E_MUSIC_PREVIEW_AUDIO_LOCKED";
      emit();
      return false;
    }
    return true;
  }

  async function unlock() {
    try {
      if (!await ensureContext()) return false;
      degraded = false;
      lastError = null;
      const token = ++generation;
      await apply(token);
      return context.state === "running";
    } catch (error) {
      degraded = true;
      lastError = error?.message || "E_MUSIC_PREVIEW_UNLOCK";
      emit();
      return false;
    }
  }

  async function suspend() {
    try {
      if (!context || context.state !== "running") {
        emit();
        return context?.state === "suspended";
      }
      generation += 1;
      for (const id of [...handles.keys()]) stopHandle(id);
      await context.suspend();
      degraded = false;
      lastError = null;
      emit();
      return context.state === "suspended";
    } catch (error) {
      degraded = true;
      lastError = error?.message || "E_MUSIC_PREVIEW_SUSPEND";
      emit();
      return false;
    }
  }

  function refresh() {
    const token = ++generation;
    return apply(token);
  }

  function setState(state) {
    desired = normalizeMusicPreviewState(state);
    return refresh();
  }

  function setMasterVolume(value) {
    masterVolume = clamp01(value);
    applyBusLevels();
    emit();
  }

  function setMusicVolume(value) {
    musicVolume = clamp01(value);
    applyBusLevels();
    emit();
  }

  function setMuted(value) {
    muted = Boolean(value);
    applyBusLevels();
    emit();
  }

  function onVisibility() {
    if (!context || disposed) return;
    if (documentLike?.visibilityState === "hidden") {
      void context.suspend().then(emit).catch(error => {
        degraded = true;
        lastError = error?.message || "E_MUSIC_PREVIEW_SUSPEND";
        emit();
      });
      return;
    }
    void unlock();
  }

  documentLike?.addEventListener?.("visibilitychange", onVisibility);

  return {
    unlock,
    suspend,
    refresh,
    setState,
    setMasterVolume,
    setMusicVolume,
    setMuted,
    status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status());
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      documentLike?.removeEventListener?.("visibilitychange", onVisibility);
      for (const id of [...handles.keys()]) stopHandle(id);
      musicBus?.disconnect();
      master?.disconnect();
      void context?.close?.().catch(() => {});
      buffers.clear();
      emit();
      listeners.clear();
    }
  };
}
