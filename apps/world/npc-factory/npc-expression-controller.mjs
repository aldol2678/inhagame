export const NPC_EXPRESSION_NAMES = Object.freeze([
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised'
]);

const PRESETS = Object.freeze({
  neutral: Object.freeze({ eyeX: 1, eyeY: 1, browY: 0, browTilt: 0, mouthX: 1, mouthY: 1, mouthYPos: 0 }),
  happy: Object.freeze({ eyeX: 1.03, eyeY: .78, browY: .018, browTilt: -2, mouthX: 1.45, mouthY: .72, mouthYPos: .018 }),
  sad: Object.freeze({ eyeX: .97, eyeY: .90, browY: .024, browTilt: -11, mouthX: 1.12, mouthY: .72, mouthYPos: -.018 }),
  angry: Object.freeze({ eyeX: 1.04, eyeY: .68, browY: -.012, browTilt: 12, mouthX: .88, mouthY: .72, mouthYPos: -.012 }),
  surprised: Object.freeze({ eyeX: 1.12, eyeY: 1.42, browY: .045, browTilt: 0, mouthX: .78, mouthY: 2.35, mouthYPos: -.012 })
});

const SIDES = Object.freeze([-1, 1]);
const CHANNELS = Object.freeze(Object.keys(PRESETS.neutral));

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function snapshot(node) {
  const position = node.getLocalPosition();
  const scale = node.getLocalScale();
  const euler = node.getLocalEulerAngles();
  return {
    position: { x: position.x, y: position.y, z: position.z },
    scale: { x: scale.x, y: scale.y, z: scale.z },
    euler: { x: euler.x, y: euler.y, z: euler.z }
  };
}

function validateFace(face) {
  if (!face || !face.mouth || !Array.isArray(face.eyes) || face.eyes.length !== 2 ||
      !Array.isArray(face.brows) || face.brows.length !== 2)
    throw new Error('NPC_EXPRESSION_FACE_REQUIRED');
  for (const node of [...face.eyes, ...face.brows, face.mouth]) {
    if (!node || typeof node.getLocalPosition !== 'function' || typeof node.getLocalScale !== 'function' ||
        typeof node.getLocalEulerAngles !== 'function' || typeof node.setLocalPosition !== 'function' ||
        typeof node.setLocalScale !== 'function' || typeof node.setLocalEulerAngles !== 'function')
      throw new Error('NPC_EXPRESSION_FACE_NODE_INVALID');
  }
}

function targetFor(emotion, intensity) {
  const neutral = PRESETS.neutral;
  const preset = PRESETS[emotion];
  const amount = clamp01(intensity);
  return Object.fromEntries(CHANNELS.map(channel => [
    channel,
    neutral[channel] + (preset[channel] - neutral[channel]) * amount
  ]));
}

function applyFace(base, face, state) {
  face.eyes.forEach((eye, index) => {
    const initial = base.eyes[index];
    eye.setLocalScale(initial.scale.x * state.eyeX, initial.scale.y * state.eyeY, initial.scale.z);
  });
  face.brows.forEach((brow, index) => {
    const initial = base.brows[index];
    brow.setLocalPosition(initial.position.x, initial.position.y + state.browY, initial.position.z);
    brow.setLocalEulerAngles(initial.euler.x, initial.euler.y, initial.euler.z + SIDES[index] * state.browTilt);
  });
  face.mouth.setLocalPosition(
    base.mouth.position.x,
    base.mouth.position.y + state.mouthYPos,
    base.mouth.position.z
  );
  face.mouth.setLocalScale(
    base.mouth.scale.x * state.mouthX,
    base.mouth.scale.y * state.mouthY,
    base.mouth.scale.z
  );
}

export function npcExpressionPreset(emotion, intensity = 1) {
  if (!NPC_EXPRESSION_NAMES.includes(emotion)) throw new Error(`NPC_EXPRESSION_UNKNOWN:${emotion}`);
  return Object.freeze(targetFor(emotion, intensity));
}

export function createNpcExpressionController(face, { smoothness = 8 } = {}) {
  validateFace(face);
  if (!Number.isFinite(smoothness) || smoothness <= 0) throw new Error('NPC_EXPRESSION_SMOOTHNESS_INVALID');

  const base = {
    eyes: face.eyes.map(snapshot),
    brows: face.brows.map(snapshot),
    mouth: snapshot(face.mouth)
  };
  let emotion = 'neutral';
  let intensity = 0;
  let target = targetFor(emotion, intensity);
  let current = { ...target };

  const apply = () => applyFace(base, face, current);

  function setEmotion(nextEmotion, nextIntensity = 1, { immediate = false } = {}) {
    if (!NPC_EXPRESSION_NAMES.includes(nextEmotion)) throw new Error(`NPC_EXPRESSION_UNKNOWN:${nextEmotion}`);
    emotion = nextEmotion;
    intensity = clamp01(nextIntensity);
    target = targetFor(emotion, intensity);
    if (immediate) {
      current = { ...target };
      apply();
    }
    return status();
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('NPC_EXPRESSION_DT_INVALID');
    if (dt === 0) return status();
    const alpha = 1 - Math.exp(-smoothness * dt);
    for (const channel of CHANNELS) current[channel] += (target[channel] - current[channel]) * alpha;
    apply();
    return status();
  }

  function status() {
    return {
      emotion,
      intensity,
      current: { ...current },
      target: { ...target }
    };
  }

  apply();
  return {
    setEmotion,
    update,
    status,
    reset: ({ immediate = false } = {}) => setEmotion('neutral', 0, { immediate })
  };
}
