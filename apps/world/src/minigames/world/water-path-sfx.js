// PA-G2B-R1 · water-path sound effects. Pure synthesis through the shared World audio layer
// (worldAudio.playCue): no audio files, the master volume applies, locked audio is skipped silently.
// Optional feedback only: every failure is swallowed and a voice budget bounds overlapping sounds.
export const WATER_PATH_CUES = Object.freeze(['start', 'rotate', 'flow', 'clear']);
const MAX_VOICES = 6;

// [type, start Hz, end Hz, delay s, length s, peak gain]
const NOTES = Object.freeze({
  start: [['sine', 520, 300, 0, 0.14, 0.12], ['sine', 780, 460, 0.07, 0.12, 0.07]],
  rotate: [['triangle', 190, 110, 0, 0.09, 0.14], ['sine', 880, 700, 0, 0.04, 0.05]],
  flow: [['sine', 520, 700, 0, 0.12, 0.1], ['sine', 700, 940, 0.08, 0.14, 0.1]],
  clear: [['triangle', 523.25, 523.25, 0, 0.28, 0.12], ['triangle', 659.25, 659.25, 0.11, 0.28, 0.12],
    ['triangle', 783.99, 783.99, 0.22, 0.28, 0.12], ['sine', 1046.5, 1046.5, 0.33, 0.7, 0.14]]
});

export function createWaterPathSfx({ audio } = {}) {
  let voices = 0, disposed = false, played = 0;
  function play(name) {
    const notes = NOTES[name];
    if (disposed || !notes || typeof audio?.playCue !== 'function') return false;
    if (voices + notes.length > MAX_VOICES) return false;
    let scheduled = 0;
    const accepted = audio.playCue((context, output) => {
      const now = context.currentTime;
      for (const [type, from, to, delay, length, peak] of notes) {
        let osc = null, gain = null;
        try {
          osc = context.createOscillator();
          gain = context.createGain();
          osc.type = type;
          const at = now + delay;
          osc.frequency.setValueAtTime(from, at);
          if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
          osc.connect(gain);
          gain.connect(output);
          voices++;
          scheduled++;
          osc.onended = () => { voices = Math.max(0, voices - 1); osc.disconnect(); gain.disconnect(); };
          osc.start(at);
          osc.stop(at + length + 0.03);
        } catch {
          osc?.disconnect?.();
          gain?.disconnect?.();
        }
      }
    });
    if (accepted === true && scheduled > 0) { played++; return true; }
    return false;
  }
  return Object.freeze({
    play,
    status: () => ({ voices, played, voiceBudget: MAX_VOICES }),
    dispose() { disposed = true; }
  });
}
