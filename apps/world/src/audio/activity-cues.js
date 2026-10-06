// Small procedural prototype cues. No asset loading, extra AudioContext or timers.
// Every source routes through worldAudio.playCue and its existing master volume.
export const MAX_ACTIVITY_SOURCES = 3;
const SURFACES = Object.freeze({
  'hard-outdoor': { duration: .12, tone: 185, noise: .26, smoothing: .32, gain: .17 },
  'soft-outdoor': { duration: .17, tone: 110, noise: .7, smoothing: .2, gain: .13 },
  'indoor-hard': { duration: .15, tone: 290, noise: .2, smoothing: .48, gain: .15 },
  'indoor-soft': { duration: .13, tone: 95, noise: .18, smoothing: .08, gain: .12 }
});
const DOORS = Object.freeze({
  wood: { duration: .28, tone: 155, noise: .25, smoothing: .13, gain: .2 },
  glass: { duration: .24, tone: 460, noise: .2, smoothing: .35, gain: .14 },
  threshold: { duration: .2, tone: 240, noise: .38, smoothing: .2, gain: .14 }
});
function makeBuffer(context, profile, variant, door) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * profile.duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 9173 + variant * 3907, smooth = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    smooth += (((seed / 4294967296) * 2 - 1) - smooth) * profile.smoothing;
    const time = i / context.sampleRate, progress = time / profile.duration;
    const envelope = Math.min(1, time / .003) * Math.exp(-progress * 7) * (1 - progress);
    const tone = Math.sin(2 * Math.PI * profile.tone * (1 + variant * .025) * time);
    // A quiet second latch impulse distinguishes a doorway from a single foot contact.
    const latchTime = time - profile.duration * .58;
    const latch = door && latchTime > 0 ? Math.sin(2 * Math.PI * profile.tone * 2.3 * latchTime) *
      Math.min(1, latchTime / .002) * Math.exp(-latchTime * 75) * .2 : 0;
    data[i] = (tone * (1 - profile.noise) + smooth * profile.noise) * envelope * .65 + latch;
  }
  return buffer;
}

export function createActivityCueRenderer({ audio } = {}) {
  const voices = new Set(), buffers = new Map();
  let disposed = false, sequence = 0;
  function release(voice, stop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* Already ended. */ } }
    voice.source.disconnect();
    voice.gain.disconnect();
  }
  function stop() { for (const voice of [...voices]) release(voice, true); }
  return {
    play(cue) {
      if (disposed) return false;
      const door = cue?.kind === 'door';
      const profile = door ? DOORS[cue.family] : cue?.kind === 'footstep' ? SURFACES[cue.surface] : null;
      if (!profile || !audio?.playCue) return false;
      if (voices.size >= MAX_ACTIVITY_SOURCES) {
        if (!door) return false;
        release([...voices].find(voice => voice.kind === 'footstep') ?? voices.values().next().value, true);
      }
      let rendered = false;
      const accepted = audio.playCue((context, output) => {
        let source = null, gain = null;
        try {
          const variant = sequence++ % 3;
          const key = `${door ? cue.family : cue.surface}:${variant}`;
          let buffer = buffers.get(key);
          if (!buffer) { buffer = makeBuffer(context, profile, variant, door); buffers.set(key, buffer); }
          source = context.createBufferSource(); gain = context.createGain();
          source.buffer = buffer;
          source.playbackRate.value = (cue.gait === 'RUN' ? 1.1 : 1) + variant * .015;
          gain.gain.value = profile.gain * (cue.gait === 'RUN' ? 1.12 : 1);
          source.connect(gain); gain.connect(output);
          const voice = { source, gain, kind: cue.kind };
          voices.add(voice);
          source.onended = () => release(voice);
          try { source.start(); } catch (error) { release(voice, true); throw error; }
          rendered = true;
        } catch {
          source?.disconnect(); gain?.disconnect();
          // Optional feedback must never interrupt movement or room transitions.
        }
      });
      return accepted === true && rendered;
    },
    stop,
    status: () => ({ activeSources: voices.size, sourceBudget: MAX_ACTIVITY_SOURCES, cachedBuffers: buffers.size }),
    dispose() { if (disposed) return; disposed = true; stop(); buffers.clear(); }
  };
}
