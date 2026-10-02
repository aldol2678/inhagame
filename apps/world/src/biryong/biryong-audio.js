// 울림돌 shout + echo, synthesized with Web Audio (no microphone, no recorded assets).
// A short formant "voice" is played once and re-triggered by the echo taps, each quieter and
// duller, which fakes the stones' spatial reflection.
import { echoSchedule } from './biryong-state.js';

// Rough vowel formants per shout line keep lines distinguishable without speech synthesis.
const VOWELS = Object.freeze({
  a: [800, 1150], i: [300, 2300], o: [450, 850], u: [350, 900], e: [480, 1850]
});
const vowelsFor = line => {
  const map = { '아': 'a', '하': 'a', '라': 'a', '가': 'a', '인': 'i', '기': 'i', '시': 'i', '니': 'i',
    '누': 'u', '구': 'u', '요': 'o', '어': 'o', '없': 'o', '져': 'o', '험': 'o', '거': 'o', '비': 'i', '룡': 'o', '들': 'u', '리': 'i' };
  const out = [...String(line)].map(ch => map[ch]).filter(Boolean);
  return out.length ? out.slice(0, 5) : ['a', 'a'];
};

function voice(context, destination, startAt, { gain, vowels, dullness }) {
  const syllable = 0.16;
  const duration = syllable * vowels.length + 0.12;
  const osc = context.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(210, startAt);
  osc.frequency.linearRampToValueAtTime(250, startAt + duration * 0.35);
  osc.frequency.linearRampToValueAtTime(185, startAt + duration);

  const out = context.createGain();
  out.gain.setValueAtTime(0.0001, startAt);
  out.gain.exponentialRampToValueAtTime(0.22 * gain, startAt + 0.03);
  out.gain.setValueAtTime(0.22 * gain, startAt + duration - 0.1);
  out.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4200 - dullness * 2600;
  const nodes = [osc, out, tone];
  for (const index of [0, 1]) {
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 7;
    vowels.forEach((vowel, i) => band.frequency.setValueAtTime(VOWELS[vowel][index], startAt + i * syllable));
    const level = context.createGain();
    level.gain.value = index ? 0.6 : 1;
    osc.connect(band).connect(level).connect(tone);
    nodes.push(band, level);
  }
  tone.connect(out).connect(destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
  osc.onended = () => { for (const node of nodes) { try { node.disconnect(); } catch { /* Already gone. */ } } };
  return duration;
}

export function playEchoStoneCue(worldAudio, line) {
  if (!worldAudio?.playCue) return false;
  const vowels = vowelsFor(line);
  return worldAudio.playCue((context, destination) => {
    const start = context.currentTime + 0.02;
    echoSchedule(line).forEach((tap, i) => {
      voice(context, destination, start + tap.delayMs / 1000, { gain: tap.gain, vowels, dullness: i / 2 });
    });
  });
}
