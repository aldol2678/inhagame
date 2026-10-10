// QA fixture only. Call in the offline actual-campus harness after app.off('update').
// The real actor is placed ONLY at each independent case's start; every subsequent
// position/height comes from the existing PlayerController.update(dt, 0).
// These are deterministic controller inputs, not real keyboard events or an FPS test.
// No network, renderer, layout, collision or physics implementation is changed.
import { PlayerController } from '../../src/player-controller.js';
import { OBSTACLES } from '../../src/campus-layout.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { canOccupy } from '../../src/world-collision.js';
import { WALK_SHAPE } from '../../src/player-dimensions.js';
import { GARDEN_ENTRANCES } from '../../src/library-garden-layout.js';
import { STANDS, SPORTS_SIDE_ENTRIES } from '../../src/stadium-stands-layout.js';
import { BACK_ALLEY_BLOCKS, BACK_ALLEY_COLLIDERS } from '../../src/back-alley-layout.js';

const DT = 1 / 60;
const point = p => ({ x: p.x, y: p.y, z: p.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pose = (p, groundY) => ({ ...p, y: groundY + roadviewGroundHeight(p.x, p.z) });
const inputFields = ['inputEnabled', 'velocityY', 'grounded', 'jumpQueued', 'ascendHeld',
  'descendHeld', 'touchSprint', 'assist', 'moving', 'lastGroundMove', 'groundMovementLocks'];

function entranceCases() {
  const routes = [
    ...GARDEN_ENTRANCES.map(q => ({ id: q.id, area: 'garden', type: q.steps ? 'stairs' : 'ramp',
      a: q.frame.at(q.u, -1), b: q.frame.at(q.u, q.run + .6) })),
    ...STANDS.aisles.map((u, i) => ({ id: `stadium_aisle_${i}`, area: 'stadium', type: 'aisle',
      a: STANDS.frame.at(u, STANDS.run + 1), b: STANDS.frame.at(u, -.6) })),
    ...SPORTS_SIDE_ENTRIES.map(q => ({ id: q.id, area: 'stadium', type: 'side-entry',
      a: q.frame.at(q.u, 1), b: q.frame.at(q.u, -q.run - .6) }))
  ];
  return routes.flatMap(({ a, b, ...route }) => [
    { ...route, id: `${route.id}:in`, direction: 'in', start: a, target: b },
    { ...route, id: `${route.id}:out`, direction: 'out', start: b, target: a }
  ]);
}

// Select an explicitly capsule-clear representative street-side segment. This
// does not select or omit any required garden/stadium route or alley collider.
function clearAlleyCases(groundY) {
  for (const q of BACK_ALLEY_BLOCKS) {
    const a = q.frame.at(-q.w / 2 - .5, -.8), b = q.frame.at(q.w / 2 + .5, -.8);
    if (!Array.from({ length: 101 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 100,
      z: a.z + (b.z - a.z) * i / 100 })).every(p => canOccupy(pose(p, groundY)))) continue;
    return [{ id: `${q.id}:outside:forward`, start: a, target: b, direction: 'forward' },
      { id: `${q.id}:outside:reverse`, start: b, target: a, direction: 'reverse' }]
      .map(c => ({ ...c, area: 'alley', type: 'clear-alley-route' }));
  }
  throw Error('No capsule-clear representative alley street segment found');
}

function barrierCases(groundY) {
  return BACK_ALLEY_BLOCKS.map((q, i) => {
    const collider = BACK_ALLEY_COLLIDERS[i], center = q.center;
    // Prefer the visible street facade, then another clear face if adjacent
    // existing campus furniture prevents a valid street-side starting capsule.
    const faces = [[q.frame.at(0, 0), q.frame.at(0, -1)],
      [q.frame.at(0, q.d), q.frame.at(0, q.d + 1)],
      [q.frame.at(-q.w / 2, q.d / 2), q.frame.at(-q.w / 2 - 1, q.d / 2)],
      [q.frame.at(q.w / 2, q.d / 2), q.frame.at(q.w / 2 + 1, q.d / 2)]];
    const selected = faces.find(([, start]) => canOccupy(pose(start, groundY)));
    return { id: `${q.id}:wall`, area: 'alley', type: 'barrier', direction: 'into-wall',
      collider, faceIndex: selected ? faces.indexOf(selected) : -1,
      start: selected?.[1] ?? faces[0][1], target: center };
  });
}

export function runWalking(d) {
  const c = d?.controller, player = d?.player;
  if (!(c instanceof PlayerController) || c.entity !== player) throw Error('Actual campus PlayerController and its actor are required');
  if (c.mounted) throw Error('Walking QA requires an unmounted offline fixture');
  if (c.space?.id !== 'campus' || c.space.groundHeight !== roadviewGroundHeight ||
      (c.space.obstacles !== undefined && c.space.obstacles !== OBSTACLES)) {
    throw Error('Walking QA must use existing campus obstacles and roadviewGroundHeight');
  }
  const saved = Object.fromEntries(inputFields.map(k => [k, c[k]]));
  const originalPosition = point(player.getLocalPosition());
  const originalRotation = player.getLocalEulerAngles ? point(player.getLocalEulerAngles()) : null;
  const keys = c.keys, keyValues = [...keys], touch = c.touchVector, touchValues = { ...touch };
  const report = { inputMode: 'deterministic-controller-touch-vector', dt: DT,
    scope: 'offline fixture; actual PlayerController, full campus OBSTACLES and roadviewGroundHeight; not keyboard/FPS/device validation',
    // Player/input state is restored. Normal controller ticks also advance the
    // disposable offline fixture's local shuttle clock, which has no reset API.
    fixtureSideEffect: 'local shuttle simulation clock advances', cases: [], totalTicks: 0, passed: false };
  try {
    c.inputEnabled = true; c.groundMovementLocks = new Set();
    keys.clear(); touch.x = 0; touch.y = 0;
    c.jumpQueued = false; c.ascendHeld = false; c.descendHeld = false;
    c.touchSprint = false; c.assist = null;
    const cases = [...entranceCases(), ...clearAlleyCases(c.groundY), ...barrierCases(c.groundY)];
    for (const spec of cases) {
      const { collider, ...description } = spec;
      const receipt = { ...description, ticks: 0, trace: [], maxFootError: 0, travelled: 0, passed: false };
      report.cases.push(receipt);
      const record = () => {
        const p = point(player.getLocalPosition()), ground = roadviewGroundHeight(p.x, p.z);
        const footY = p.y - c.groundY, footError = Math.abs(footY - ground);
        receipt.maxFootError = Math.max(receipt.maxFootError, footError);
        receipt.trace.push({ tick: receipt.ticks, ...p, footY, ground, grounded: c.grounded });
        return p;
      };
      try {
        c.velocityY = 0; c.grounded = true; c.jumpQueued = false;
        const start = pose(spec.start, c.groundY);
        player.setLocalPosition(start.x, start.y, start.z);
        record();
        if (!canOccupy(start)) throw Error('Starting capsule overlaps an existing campus obstacle');
        let stalled = 0;
        const limit = spec.type === 'barrier' ? 100 : Math.ceil(distance(start, spec.target) / c.walkSpeed / DT) + 180;
        for (let i = 0; i < limit; i++) {
          const before = point(player.getLocalPosition()), remaining = distance(before, spec.target);
          if (remaining < .005) break;
          touch.x = (spec.target.x - before.x) / remaining;
          touch.y = -(spec.target.z - before.z) / remaining;
          // Keep a fixed 60 Hz step; throttle the final touch magnitude instead
          // of teleporting to the endpoint or changing controller speed/physics.
          const throttle = Math.min(1, remaining / (c.walkSpeed * DT));
          touch.x *= throttle; touch.y *= throttle;
          c.update(DT, 0); receipt.ticks++; report.totalTicks++;
          const after = record(), progress = distance(before, after);
          receipt.travelled += progress;
          if (![after.x, after.y, after.z].every(Number.isFinite)) throw Error('Actor position became non-finite');
          if (receipt.maxFootError > 1e-6) throw Error('Actor feet left the existing ground-height surface');
          if (!canOccupy(after)) throw Error('Actor capsule entered an existing campus obstacle');
          stalled = progress < 1e-6 ? stalled + 1 : 0;
          if (stalled >= 20) break;
        }
        receipt.end = point(player.getLocalPosition());
        receipt.remaining = distance(receipt.end, spec.target);
        if (spec.type === 'barrier') {
          if (receipt.travelled < .1 || receipt.remaining < .5) throw Error('Wall probe did not approach and stop outside the shell');
          const len = receipt.remaining;
          const next = { ...receipt.end, x: receipt.end.x + (spec.target.x - receipt.end.x) / len * .15,
            z: receipt.end.z + (spec.target.z - receipt.end.z) / len * .15 };
          if (canOccupy(next, WALK_SHAPE, [collider])) throw Error('Probe stopped before reaching the intended visible alley collider');
          receipt.blockedBy = collider.id;
        } else if (receipt.remaining >= .005) throw Error(`Route blocked ${receipt.remaining.toFixed(4)} units before its endpoint`);
        receipt.passed = true;
      } catch (error) {
        receipt.end = point(player.getLocalPosition());
        receipt.error = String(error.message || error);
        receipt.overlapping = OBSTACLES.filter(o => !canOccupy(receipt.end, WALK_SHAPE, [o])).map(o => o.id);
      } finally { touch.x = 0; touch.y = 0; }
    }
    report.passed = report.cases.every(c => c.passed);
    return report;
  } finally {
    Object.assign(c, saved);
    keys.clear(); for (const key of keyValues) keys.add(key);
    Object.assign(touch, touchValues);
    player.setLocalPosition(originalPosition.x, originalPosition.y, originalPosition.z);
    if (originalRotation) player.setLocalEulerAngles(originalRotation.x, originalRotation.y, originalRotation.z);
  }
}
