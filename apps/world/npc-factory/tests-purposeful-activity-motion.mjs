import assert from 'node:assert/strict';
import { purposefulActivityPose } from './purposeful-activity-motion.mjs';

const reading = purposefulActivityPose('READING', { phase: 0, motionEnergy: 1 });
assert.deepEqual(reading.armPitch, [-18, -18]);
assert.deepEqual(reading.armRoll, [-5, 5]);

const phone = purposefulActivityPose('PHONE', { phase: 0, motionEnergy: 1 });
assert.ok(phone.armPitch[0] < phone.armPitch[1], 'phone pose should be asymmetric');

const photo = purposefulActivityPose('PHOTO', { phase: 0, motionEnergy: 1 });
assert.ok(photo.armPitch.every(value => value < -40), 'photo pose should lift both arms');

const coffeeA = purposefulActivityPose('COFFEE', { phase: 0, motionEnergy: 1 });
const coffeeB = purposefulActivityPose('COFFEE', { phase: Math.PI, motionEnergy: 1 });
assert.notDeepEqual(coffeeA.armPitch, coffeeB.armPitch, 'coffee pose should have a slow hand motion');

const musicA = purposefulActivityPose('MUSIC', { phase: Math.PI / 2, motionEnergy: 0.7 });
const musicB = purposefulActivityPose('MUSIC', { phase: Math.PI / 2, motionEnergy: 1.2 });
assert.ok(Math.abs(musicB.armPitch[0]) > Math.abs(musicA.armPitch[0]),
  'behavior energy should scale music motion');

const seated = purposefulActivityPose('RESTING', { sitting: true });
assert.deepEqual(seated.legPitch, [-40, -40]);
assert.deepEqual(seated.armPitch, [-12, -12]);

for (const activity of ['WAITING', 'TRANSIT', 'CLUB', 'ACADEMIC', 'WALK_BREAK', 'MUSIC', undefined]) {
  const result = purposefulActivityPose(activity, { phase: 1.1, motionEnergy: 1 });
  assert.equal(result.armPitch.length, 2);
  assert.equal(result.armYaw.length, 2);
  assert.equal(result.armRoll.length, 2);
  assert.equal(result.legPitch.length, 2);
  for (const value of [...result.armPitch, ...result.armYaw, ...result.armRoll, ...result.legPitch])
    assert.ok(Number.isFinite(value), `${activity ?? 'default'} returned a non-finite pose`);
}

console.log('Purposeful activity motion: reading/coffee/photo/phone/music/wait/rest poses: PASS');
