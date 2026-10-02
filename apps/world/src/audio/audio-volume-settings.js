const KEY = "inha-world-audio-volume-v1";

export function bindAudioVolumeSettings(audio, select, suppliedStorage = null) {
  if (!audio || !select) return () => {};
  let storage = suppliedStorage;
  if (!storage) { try { storage = globalThis.localStorage; } catch { /* Session-only volume. */ } }
  try {
    const saved = storage?.getItem(KEY);
    if (saved !== null && [...select.options].some(option => option.value === saved)) select.value = saved;
  } catch { /* Session-only volume. */ }
  audio.setVolume(Number(select.value));
  const onChange = () => {
    audio.setVolume(Number(select.value));
    try { storage?.setItem(KEY, select.value); } catch { /* Session-only volume. */ }
  };
  select.addEventListener("change", onChange);
  return () => select.removeEventListener("change", onChange);
}
