// QA-only deterministic inputs to the existing PlayerController. No replacement
// physics, obstacle, ground-height or keyboard implementation is installed.
import { PlayerController } from '../../src/player-controller.js';
import { OBSTACLES } from '../../src/campus-layout.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { canOccupy } from '../../src/world-collision.js';
import { TARGETS, VIEWS, frontOf } from './backgate-shopfront-qa-plan.mjs';

const DT = 1 / 60;
const point = p => ({ x: p.x, y: p.y, z: p.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pose = (p, groundY) => ({ ...p, y: groundY + roadviewGroundHeight(p.x, p.z) });
const fields = ['inputEnabled', 'velocityY', 'grounded', 'jumpQueued', 'ascendHeld',
  'descendHeld', 'touchSprint', 'assist', 'moving', 'lastGroundMove', 'groundMovementLocks'];

export function representativeRoutes(groundY) {
  return VIEWS.flatMap(view => {
    const candidates = [view.plot, ...TARGETS.filter(q => q !== view.plot &&
      (view.name === 'back-street' ? q.id.startsWith('back_street_') :
        view.name === 'culture-terminal' ? false : q.side === view.plot.side))];
    for (const q of candidates) {
      const half = Math.min(1.5, q.w / 2 - .3), front = frontOf(q);
      const a = q.frame.at(-half, front - .7), b = q.frame.at(half, front - .7);
      const clear = Array.from({ length: 61 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 60,
        z: a.z + (b.z - a.z) * i / 60 })).every(p => canOccupy(pose(p, groundY)));
      if (!clear) continue;
      return [{ start: a, target: b, direction: 'forward' }, { start: b, target: a, direction: 'reverse' }]
        .map(route => ({ ...route, area: view.name, plot: q.id, id: `${view.name}:${route.direction}`, clearanceSamples: 61 }));
    }
    throw Error(`${view.name}: no capsule-clear representative facade segment; do not skip coverage`);
  });
}

export function runShopfrontWalking(d) {
  const c = d?.controller, player = d?.player;
  if (!(c instanceof PlayerController) || c.entity !== player || c.mounted || c.space?.id !== 'campus' ||
      c.space.groundHeight !== roadviewGroundHeight || (c.space.obstacles !== undefined && c.space.obstacles !== OBSTACLES)) {
    throw Error('Actual unmounted campus PlayerController, original obstacles and ground surface required');
  }
  const saved = Object.fromEntries(fields.map(k => [k, c[k]])), original = point(player.getLocalPosition());
  const rotation = point(player.getLocalEulerAngles()), keys = [...c.keys], touch = { ...c.touchVector };
  const report = { inputMode: 'deterministic-controller-touch-vector', dt: DT, cases: [], totalTicks: 0,
    scope: 'Eight representative clear routes; not exhaustive navigation, keyboard, timing or physical-device evidence',
    fixtureSideEffect: 'Controller ticks advance the disposable local shuttle clock', passed: false };
  try {
    c.inputEnabled = true; c.groundMovementLocks = new Set(); c.keys.clear(); c.assist = null;
    c.jumpQueued = c.ascendHeld = c.descendHeld = c.touchSprint = false;
    for (const route of representativeRoutes(c.groundY)) {
      const receipt = { ...route, ticks: 0, maxFootError: 0, trace: [], passed: false };
      report.cases.push(receipt);
      const record = () => {
        const p = point(player.getLocalPosition()), ground = roadviewGroundHeight(p.x, p.z);
        receipt.maxFootError = Math.max(receipt.maxFootError, Math.abs(p.y - c.groundY - ground));
        receipt.trace.push({ ...p, tick: receipt.ticks, ground, grounded: c.grounded });
        if (![p.x, p.y, p.z].every(Number.isFinite) || !canOccupy(p) || receipt.maxFootError > 1e-6) {
          throw Error(`${route.id}: non-finite, overlapping or off-ground actor`);
        }
        return p;
      };
      c.velocityY = 0; c.grounded = true; c.jumpQueued = false;
      const start = pose(route.start, c.groundY);
      player.setLocalPosition(start.x, start.y, start.z); record();
      const limit = Math.ceil(distance(start, route.target) / c.walkSpeed / DT) + 120;
      for (let i = 0; i < limit; i++) {
        const p = player.getLocalPosition(), remaining = distance(p, route.target);
        if (remaining < .005) break;
        const scale = Math.min(1, remaining / (c.walkSpeed * DT)) / remaining;
        c.touchVector.x = (route.target.x - p.x) * scale;
        c.touchVector.y = -(route.target.z - p.z) * scale;
        c.update(DT, 0); receipt.ticks++; report.totalTicks++; record();
      }
      c.touchVector.x = c.touchVector.y = 0;
      receipt.remaining = distance(player.getLocalPosition(), route.target);
      if (receipt.ticks === 0 || receipt.remaining >= .005) throw Error(`${route.id}: route did not complete`);
      receipt.passed = true;
    }
    report.passed = report.cases.length === 8 && report.cases.every(c => c.passed);
    return report;
  } finally {
    Object.assign(c, saved); c.keys.clear(); for (const key of keys) c.keys.add(key);
    Object.assign(c.touchVector, touch);
    player.setLocalPosition(original.x, original.y, original.z);
    player.setLocalEulerAngles(rotation.x, rotation.y, rotation.z);
  }
}
