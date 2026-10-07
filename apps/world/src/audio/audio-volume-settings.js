import { getSetting, setSetting } from '../settings-registry.js';


export function bindAudioVolumeSettings(audio, select, suppliedStorage = null) {
  if (!audio || !select) return () => {};
  let storage = suppliedStorage;
  if (!storage) { try { storage = globalThis.localStorage; } catch { /* Session-only volume. */ } }
  const saved = getSetting(storage, 'audio.ambient');
  if (Number.isFinite(Number(saved))) {
    const candidates = [...select.options].map(option => Number(option.value)).filter(Number.isFinite);
    const closest = candidates.reduce((best, value) =>
      Math.abs(value - Number(saved)) < Math.abs(best - Number(saved)) ? value : best, candidates[0] ?? 0.7);
    select.value = String(closest);
  }
  audio.setVolume(Number(select.value));
  const onChange = () => {
    audio.setVolume(Number(select.value));
    setSetting(storage, 'audio.ambient', Number(select.value));
  };
  select.addEventListener("change", onChange);
  return () => select.removeEventListener("change", onChange);
}
