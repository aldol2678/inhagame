import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNpcExpressionController,
  NPC_EXPRESSION_NAMES,
  npcExpressionPreset
} from '../npc-factory/npc-expression-controller.mjs';

class FakeNode {
  constructor({ position = [0, 0, 0], scale = [1, 1, 1], euler = [0, 0, 0] } = {}) {
    this.position = { x: position[0], y: position[1], z: position[2] };
    this.scale = { x: scale[0], y: scale[1], z: scale[2] };
    this.euler = { x: euler[0], y: euler[1], z: euler[2] };
  }
  getLocalPosition() { return { ...this.position }; }
  getLocalScale() { return { ...this.scale }; }
  getLocalEulerAngles() { return { ...this.euler }; }
  setLocalPosition(x, y, z) { this.position = { x, y, z }; }
  setLocalScale(x, y, z) { this.scale = { x, y, z }; }
  setLocalEulerAngles(x, y, z) { this.euler = { x, y, z }; }
}

function face() {
  return {
    eyes: [
      new FakeNode({ position: [-.09, 1.94, .287], scale: [.037, .046, .024] }),
      new FakeNode({ position: [.09, 1.94, .287], scale: [.037, .046, .024] })
    ],
    brows: [
      new FakeNode({ position: [-.09, 2.025, .288], scale: [.1, .018, .025] }),
      new FakeNode({ position: [.09, 2.025, .288], scale: [.1, .018, .025] })
    ],
    mouth: new FakeNode({ position: [0, 1.72, .292], scale: [.09, .021, .022] })
  };
}

test('expression contract stays at the five POC emotions', () => {
  assert.deepEqual(NPC_EXPRESSION_NAMES, ['neutral', 'happy', 'sad', 'angry', 'surprised']);
  assert.equal(npcExpressionPreset('surprised').mouthY, 2.35);
  assert.equal(npcExpressionPreset('happy', .5).mouthX, 1.225);
});

test('immediate happy expression modifies only the procedural face controls', () => {
  const parts = face();
  const controller = createNpcExpressionController(parts);
  controller.setEmotion('happy', 1, { immediate: true });

  assert.equal(parts.eyes[0].scale.y, .046 * .78);
  assert.equal(parts.eyes[1].scale.y, .046 * .78);
  assert.equal(parts.brows[0].position.y, 2.025 + .018);
  assert.equal(parts.brows[0].euler.z, 2);
  assert.equal(parts.brows[1].euler.z, -2);
  assert.equal(parts.mouth.scale.x, .09 * 1.45);
  assert.equal(parts.mouth.position.y, 1.72 + .018);
  assert.equal(controller.status().emotion, 'happy');
});

test('expression transition eases toward the target instead of snapping', () => {
  const parts = face();
  const controller = createNpcExpressionController(parts, { smoothness: 8 });
  controller.setEmotion('angry', 1);
  const before = parts.eyes[0].scale.y;
  controller.update(.1);
  const after = parts.eyes[0].scale.y;
  const target = .046 * .68;

  assert.ok(after < before);
  assert.ok(after > target);
  assert.ok(controller.status().current.eyeY < 1);
  assert.ok(controller.status().current.eyeY > .68);
});

test('intensity is clamped and reset restores the captured neutral face', () => {
  const parts = face();
  const controller = createNpcExpressionController(parts);
  controller.setEmotion('surprised', 7, { immediate: true });
  assert.equal(controller.status().intensity, 1);
  assert.equal(parts.mouth.scale.y, .021 * 2.35);

  controller.reset({ immediate: true });
  assert.equal(controller.status().emotion, 'neutral');
  assert.equal(controller.status().intensity, 0);
  assert.deepEqual(parts.eyes[0].scale, { x: .037, y: .046, z: .024 });
  assert.deepEqual(parts.brows[0].position, { x: -.09, y: 2.025, z: .288 });
  assert.deepEqual(parts.brows[0].euler, { x: 0, y: 0, z: 0 });
  assert.deepEqual(parts.mouth.scale, { x: .09, y: .021, z: .022 });
  assert.deepEqual(parts.mouth.position, { x: 0, y: 1.72, z: .292 });
});

test('invalid input fails closed', () => {
  const controller = createNpcExpressionController(face());
  assert.throws(() => controller.setEmotion('confused'), /NPC_EXPRESSION_UNKNOWN/);
  assert.throws(() => controller.update(-.1), /NPC_EXPRESSION_DT_INVALID/);
  assert.throws(() => createNpcExpressionController({}), /NPC_EXPRESSION_FACE_REQUIRED/);
});
