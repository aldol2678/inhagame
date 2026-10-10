import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFirstCampusCompletion } from '../src/quest/first-campus-completion.js';
import { createToastQueue, rewardToastMessage } from '../src/events/zombie-university-2026/event-ui.js';
import { createCinematicDirector } from '../src/cinematic/cinematic-director.js';
import { MAIN_GATE_REVEAL_V01 } from '../src/cinematic/main-gate-reveal.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const between = (start, end) => {
  assert.equal(main.split(start).length, 2, `unique current-main seam: ${start}`);
  const from = main.indexOf(start) + start.length;
  const to = main.indexOf(end, from);
  assert.ok(to > from);
  return main.slice(from, to);
};
const callback = between('      onQuestReward: ', ',\n      getAiSession:');
const cinematicGate = '  if (cinematic.active) {' + between('  if (cinematic.active) {', '  // Locomotion input');
const receipt = {
  rewardId: 'reward.quest.first_campus', rewardVersion: 2, rewardTransactionId: 'synthetic-cinematic-receipt',
  status: 'SUCCESS', replayed: true, completedAt: '2026-10-07T00:00:00Z',
  entries: [{ grantType: 'EXP', targetId: 'exp.campus', requested: 100, granted: 100, status: 'GRANTED' }]
};

for (const variant of ['arrives-during-reveal', 'queued-before-reveal', 'skip-reveal']) {
  test(`current main preserves receipt presentation when ${variant}`, () => {
    const events = [], storage = new Map();
    const flow = createFirstCampusCompletion({
      storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      getFunnel: () => Object.fromEntries(['firstReward', 'rewardSeen', 'growthSeen', 'nextGoalSeen'].map(name => [name, () => events.push(name)]))
    });
    flow.setAccount('synthetic-A'); flow.begin();
    const inputFocus = createInputFocusManager();
    const cinematic = createCinematicDirector({
      camera: { camera: { fov: 62 }, getPosition: () => ({ x: 0, y: 2, z: 0 }), forward: { x: 0, y: 0, z: -1 }, setPosition() {}, lookAt() {} },
      inputFocus, root: { dataset: {} }, reducedMotion: { matches: false }
    });
    let now = 0;
    const timers = new Map();
    const element = { hidden: true, isConnected: true, parentElement: null,
      ownerDocument: { visibilityState: 'visible', defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) } },
      getClientRects: () => [{ width: 160, height: 80 }] };
    const queue = createToastQueue({ element, now: () => now,
      setTimer: (fn, delay) => { const timer = {}; timers.set(timer, { fn, at: now + delay }); return timer; },
      clearTimer: timer => timers.delete(timer) });
    const progression = { refresh(reason) { flow.growthReadback({ accountId: 'synthetic-A', reason, state: 'READY', snapshot: { level: 2, totalExp: 100 } }); } };
    const reward = new Function('firstCampusCompletion', 'core15Funnel', 'mcmEventUi', 'progression', 'wallet', 'inventory',
      'FIRST_CAMPUS_REWARD_ID', 'lobbyWorld', 'lobbyTransition', 'photoMode', 'cinematic', `return (${callback});`)(
      flow, null, { showReward(result, options = {}) { const message = rewardToastMessage(result);
        return queue.say(message.text, message.ms, null, options.isValid, options.canPresent); } }, progression,
      { refresh() { assert.fail('receipt has no currency'); } }, { refresh() {} }, receipt.rewardId,
      { active: false }, { active: false }, { active: false }, cinematic);
    const noop = () => {}, update = { update: noop }, hide = { hide: noop };
    const frame = new Function('cinematic', 'dt', 'playerActivityAudio', 'player', 'inkyungLivingMoment', 'guestbookWorldLabel',
      'shopWorldLabel', 'helicopterFlightHud', 'character', 'controller', 'streaming', 'places', 'orbit', 'minimap', 'fullMap', 'renderNavigationHud', 'after',
      cinematicGate + '\nafter();');
    function advance(ms) {
      for (let remaining = ms; remaining > 0;) {
        const step = Math.min(250, remaining); now += step; remaining -= step;
        for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); }
        frame(cinematic, step / 1000, { reset: noop }, { getLocalPosition: () => ({ x: 0, y: 0, z: 0 }) },
          { setSuppressed: noop }, hide, hide, update, { setMounted: noop, setFirstPerson: noop, update: noop, eyeHeight: 1 },
          { grounded: true }, update, update, { apply: noop }, update, update, noop,
          () => { queue.prune(); flow.observe({ growthVisible: true, nextGoalVisible: true }); });
      }
    }
    if (variant === 'queued-before-reveal') { queue.say('existing synthetic notice', 1000); reward(receipt); }
    cinematic.start(MAIN_GATE_REVEAL_V01);
    if (variant !== 'queued-before-reveal') reward(receipt);
    advance(5000);
    assert.equal(cinematic.active, true, 'real 6.4-second reveal still owns the update loop');
    assert.deepEqual(events, ['firstReward'], 'cinematic bypassed the presentation observer');
    assert.equal(queue.length, 1, 'receipt must remain queued beyond the normal 4.5-second toast duration');
    if (variant === 'skip-reveal') cinematic.skip();
    advance(2000);
    assert.equal(cinematic.active, false);
    assert.deepEqual(events, ['firstReward', 'rewardSeen', 'growthSeen', 'nextGoalSeen']);
    assert.equal(storage.has('inhagame-first-campus-presentation-v1:synthetic-A'), false);
    queue.destroy(); cinematic.destroy();
  });
}
