// Deterministic, quiet prototype cues. No external sound assets or music.
const SAMPLE_SECONDS = 8;
const pulse = (time, center, width) => {
  const distance = Math.abs(time - center);
  return distance >= width ? 0 : (1 + Math.cos(Math.PI * distance / width)) / 2;
};

export function makeAmbienceBuffer(context, kind) {
  const rate = context.sampleRate;
  const length = Math.round(rate * SAMPLE_SECONDS);
  const buffer = context.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let seed = ({ traffic: 19, arrival: 37, water: 73, air: 101, room: 131, window: 157 })[kind] ?? 1;
  let low = 0;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const time = i / rate;
    const phase = 2 * Math.PI * time / SAMPLE_SECONDS;
    // Every exterior layer leaves breathing room; none carries broadband hiss.
    low += (noise - low) * (kind === "air" ? 0.003 : kind === "room" ? 0.012 : kind === "window" ? 0.075 : 0.025);
    let sample;
    if (kind === "traffic") {
      const passing = 0.12 + 0.88 * pulse(time, 3.8, 2.9);
      sample = passing * (0.22 * Math.sin(2 * Math.PI * 72 * time)
        + 0.09 * Math.sin(2 * Math.PI * 91 * time) + 0.35 * low);
    } else if (kind === "arrival") {
      const steps = pulse(time, 1.1, 0.11) + pulse(time, 1.55, 0.11)
        + pulse(time, 5.1, 0.11) + pulse(time, 5.55, 0.11);
      sample = steps * (0.45 * low + 0.12 * Math.sin(2 * Math.PI * 170 * time));
    } else if (kind === "water") {
      const laps = pulse(time, 1.3, 0.8) + pulse(time, 4.1, 0.9) + pulse(time, 6.6, 0.7);
      sample = (0.03 + 0.8 * laps) * low;
    } else if (kind === "air") {
      sample = (0.12 + 0.07 * Math.sin(phase)) * low;
    } else {
      // Preserve the small indoor bed while changing the outdoor signatures.
      sample = low * (0.5 + 0.08 * Math.sin(phase * 3)) * 2.4;
    }
    data[i] = Math.max(-1, Math.min(1, sample));
  }
  // Match both ends so the eight-second buffer loops without a click.
  const edge = Math.min(Math.round(rate * 0.12), length / 4);
  const seam = (data[0] + data[length - 1]) / 2;
  for (let i = 0; i < edge; i++) {
    const blend = (1 - Math.cos(Math.PI * i / edge)) / 2;
    data[i] = seam * (1 - blend) + data[i] * blend;
    data[length - 1 - i] = seam * (1 - blend) + data[length - 1 - i] * blend;
  }
  return buffer;
}
