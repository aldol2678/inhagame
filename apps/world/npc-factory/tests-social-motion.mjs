import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { createPurposefulSocialMotion, SOCIAL_PAIR_IDS } from './purposeful-social-motion.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url)));

function scenario() {
  const navigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, navigator, { speed: 8 });
  const social = createPurposefulSocialMotion(batch, roster, navigator);
  const states = () => SOCIAL_PAIR_IDS.map(id => roster.get(id).controller.status(false));
  let maxSeparation = 0;
  function step(dt = .1, conversationId = null) {
    for (const [id, { controller }] of roster) {
      if (id === conversationId || social.shouldPauseForConversation(id, conversationId) ||
          social.shouldHoldForJoin(id)) controller.pause();
      else controller.resume();
      controller.tick(dt);
    }
    const result = social.tick(dt, conversationId);
    if (result.phase === 'WALK_TOGETHER') {
      const [a, b] = states();
      maxSeparation = Math.max(maxSeparation, Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z));
    }
    return result;
  }
  function until(phase, limit = 1200) {
    for (let i = 0; i < limit; i++) {
      if (step().phase === phase) return;
    }
    assert.fail(`Social motion never reached ${phase}: ${social.status().phase}`);
  }
  return { roster, social, states, step, until, get maxSeparation() { return maxSeparation; } };
}

const first = scenario();
first.social.setPeriod('class_time');
for (const { controller } of first.roster.values()) controller.setScheduleIndex(1);
assert.equal(first.social.status().phase, 'WAIT');
assert.ok(first.states().every(state => state.phase === 'MOVING' && !state.interrupted));
first.until('JOIN');
first.until('WALK_TOGETHER');
assert.ok(first.states().every(state => state.interrupted && state.currentGoal === 'WALK_TOGETHER'));
for (let i = 0; i < 12; i++) first.step();
const beforePause = first.states().map(state => state.position);
for (let i = 0; i < 30; i++) first.step(.1, SOCIAL_PAIR_IDS[0]);
assert.equal(first.social.status().phase, 'WALK_TOGETHER');
assert.deepEqual(first.states().map(state => state.position), beforePause,
  'a player conversation must pause both walkers without losing the route');
assert.ok(first.states().every(state => state.paused));
first.until('SEPARATE');
assert.ok(first.maxSeparation <= 3, `paired walk spread ${first.maxSeparation.toFixed(1)} m apart`);
first.until('COMPLETE');
for (const id of SOCIAL_PAIR_IDS) {
  const { controller, schedule } = first.roster.get(id);
  const state = controller.status();
  assert.equal(state.destination, schedule[1].destination, `${id} did not resume its schedule`);
  assert.equal(state.phase, 'ACTING');
  assert.equal(state.scheduleIndex, 1);
  assert.equal(state.interrupted, false);
  assert.equal(state.failures, 0);
  assert.ok(state.history.some(item => item.event === 'INTERRUPT'));
  assert.ok(state.history.some(item => item.event === 'RESUME'));
}
const [separatedA, separatedB] = first.states();
assert.ok(Math.hypot(separatedA.position.x - separatedB.position.x,
  separatedA.position.z - separatedB.position.z) > 10, 'coworkers did not take separate class-time routes');
for (let i = 0; i < 100; i++) first.step();
assert.equal(first.social.status().phase, 'COMPLETE', 'one pair walk per class-time band');

const changed = scenario();
changed.social.setPeriod('class_time');
for (const { controller } of changed.roster.values()) controller.setScheduleIndex(1);
changed.until('WALK_TOGETHER');
changed.social.setPeriod('lunch');
for (const { controller } of changed.roster.values()) controller.setScheduleIndex(2);
assert.equal(changed.social.status().phase, 'INACTIVE');
assert.ok(changed.states().every(state => state.scheduleIndex === 2 && !state.interrupted));
for (let i = 0; i < 600; i++) changed.step();
assert.ok(changed.states().every(state => state.phase === 'ACTING' && state.failures === 0));
console.log('NPC social motion: wait, join, paired walk, conversation pause/resume, separate, clock override: PASS');
