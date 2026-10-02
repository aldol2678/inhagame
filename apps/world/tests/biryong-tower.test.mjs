import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIRYONG_BENCHES, BIRYONG_CENTER, BIRYONG_COLLIDERS, BIRYONG_EVENT_NPC, BIRYONG_IDLE_NODES,
  BIRYONG_PLACE_ID, BIRYONG_PLATFORM, BIRYONG_PLAZA_PATHS, BIRYONG_AXIS, ECHO_CENTER, ECHO_CENTER_RADIUS,
  ECHO_STONES, biryongGroundHeight, isAtEchoCenter, isNearBiryong
} from '../src/biryong/biryong-layout.js';
import {
  BIRYONG_STORAGE_KEY, BR01_STEP, CAMPUS_LORE, ECHO_TAPS, FIRST_SHOUT, SHOUT_LINES, SHOUT_POSE,
  createBiryongProgress, dbToGain, echoSchedule, echoText, mergeBiryongSnapshots, pickShoutLine, shoutPoseOffsets
} from '../src/biryong/biryong-state.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { CAMPUS_ROADS } from '../src/campus-road-layout.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { canOccupy } from '../src/world-collision.js';
import { getCanonicalLandmark, projectPolygon } from '../src/reality-adapter.js';
import { createCampusNavigation } from '../src/navigation/campus-navigation.js';
import { PlayerController } from '../src/player-controller.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { MAP_DISCOVERY_STATE, MAP_POI_PRESENTATION, MAP_SURFACE } from '../src/minimap/minimap-poi-registry.js';
import { LANDMARKS } from '../src/campus-layout.js';

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { getElementById() { return null; } };

const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), map };
};
const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};

function actor(p) {
  let position = { ...p, y: 1.15 + roadviewGroundHeight(p.x, p.z) };
  const entity = { getLocalPosition: () => ({ ...position }), setLocalPosition(x, y, z) { position = { x, y, z }; }, setLocalEulerAngles() {} };
  return { entity, controller: new PlayerController(entity) };
}
function walk(a, target, steps = 900) {
  for (let i = 0; i < steps; i++) {
    const p = a.entity.getLocalPosition(), dx = target.x - p.x, dz = target.z - p.z, len = Math.hypot(dx, dz);
    if (len < .02) { a.controller.touchVector = { x: 0, y: 0 }; return true; }
    a.controller.touchVector = { x: dx / len, y: -dz / len };
    a.controller.update(Math.min(1 / 60, len / 7));
    const next = a.entity.getLocalPosition();
    assert.ok(Math.abs(next.y - 1.15 - roadviewGroundHeight(next.x, next.z)) < 1e-6, 'feet follow the plaza ramp');
  }
  return false;
}

test('울림돌 is 18 stones: two brackets of nine, symmetric about the echo centre', () => {
  assert.equal(ECHO_STONES.length, 18);
  assert.equal(ECHO_STONES.filter(s => s.side === 'left').length, 9);
  assert.equal(ECHO_STONES.filter(s => s.side === 'right').length, 9);
  const radii = ECHO_STONES.map(s => Math.hypot(s.x - ECHO_CENTER.x, s.z - ECHO_CENTER.z));
  assert.ok(radii.every(r => Math.abs(r - radii[0]) < 1e-9), 'stones share one ring');
  // Each stone faces a mirror stone across the centre.
  for (const stone of ECHO_STONES.filter(s => s.side === 'left')) {
    const mirror = { x: 2 * ECHO_CENTER.x - stone.x, z: 2 * ECHO_CENTER.z - stone.z };
    assert.ok(ECHO_STONES.some(s => s.side === 'right' && Math.hypot(s.x - mirror.x, s.z - mirror.z) < 1e-6), stone.id);
  }
  for (let i = 0; i < ECHO_STONES.length; i++) for (let j = i + 1; j < ECHO_STONES.length; j++) {
    const a = ECHO_STONES[i], b = ECHO_STONES[j];
    assert.ok(!a.polygon.some(p => polygonOverlap(p.x, p.z, b.polygon, 0)), `${a.id} overlaps ${b.id}`);
  }
});

test('bracket gaps face the tower and the lawn so the centre is walkable', () => {
  const { toEcho } = BIRYONG_AXIS;
  for (let t = -3.2; t <= 3.2; t += 0.1) {
    const p = { x: ECHO_CENTER.x + toEcho.x * t, z: ECHO_CENTER.z + toEcho.z * t };
    assert.ok(canOccupy({ ...p, y: 1.15 + roadviewGroundHeight(p.x, p.z) }), `axis blocked at ${t.toFixed(1)}`);
  }
  assert.ok(isAtEchoCenter(ECHO_CENTER));
  assert.ok(!isAtEchoCenter({ x: ECHO_CENTER.x + ECHO_CENTER_RADIUS + 0.01, z: ECHO_CENTER.z }));
});

test('plaza fits beside the pond, service road and 우남호 without touching them', () => {
  const pond = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
  const ours = new Set(BIRYONG_COLLIDERS.map(c => c.id));
  const others = OBSTACLES.filter(o => !ours.has(o.id));
  for (const c of BIRYONG_COLLIDERS) {
    for (const p of c.polygon) {
      assert.ok(!polygonOverlap(p.x, p.z, pond, 0.3), `${c.id} in the pond`);
      assert.ok(!others.some(o => polygonOverlap(p.x, p.z, o.polygon, 0.3)), `${c.id} overlaps an existing collider`);
      for (const road of CAMPUS_ROADS) for (let i = 1; i < road.vertices.length; i++) {
        assert.ok(segmentDistance(p, road.vertices[i - 1], road.vertices[i]) > road.width / 2, `${c.id} on ${road.id}`);
      }
    }
  }
  for (const point of [BIRYONG_EVENT_NPC.position, ...BIRYONG_IDLE_NODES.filter(n => n.kind !== 'bench').map(n => n.at)]) {
    assert.ok(canOccupy({ ...point, y: 1.15 + roadviewGroundHeight(point.x, point.z) }), 'NPC nodes are standable');
  }
});

test('all Biryong colliders are registered in the shared campus obstacle list', () => {
  const ids = new Set(OBSTACLES.map(o => o.id));
  for (const c of BIRYONG_COLLIDERS) assert.ok(ids.has(c.id), c.id);
  assert.equal(BIRYONG_COLLIDERS.filter(c => c.id.startsWith('echo_stone_')).length, 18);
  assert.equal(BIRYONG_BENCHES.length, 2);
  assert.ok(BIRYONG_COLLIDERS.find(c => c.id === 'biryong_main_pillar').maxY > 15, 'column blocks flight too');
});

test('stepped base uses one gentle invisible ramp instead of stair colliders', () => {
  const { height, topRadius, footRadius } = BIRYONG_PLATFORM;
  assert.equal(biryongGroundHeight(BIRYONG_CENTER.x + footRadius + 0.01, BIRYONG_CENTER.z), 0);
  assert.equal(biryongGroundHeight(BIRYONG_CENTER.x + topRadius - 0.01, BIRYONG_CENTER.z), height);
  let previous = 0;
  for (let r = footRadius; r >= topRadius; r -= 0.01) {
    const h = biryongGroundHeight(BIRYONG_CENTER.x, BIRYONG_CENTER.z - r);
    assert.ok(h >= previous - 1e-12, 'monotonic rise toward the column');
    assert.ok(h - previous <= 0.01 * 0.45, 'slope stays walkable');
    previous = h;
  }
  assert.equal(roadviewGroundHeight(BIRYONG_CENTER.x, BIRYONG_CENTER.z - 2), height, 'campus ground includes the base');
});

test('a walker climbs the base, is stopped by the column, and walks into the echo centre', () => {
  const start = { x: BIRYONG_CENTER.x, z: BIRYONG_CENTER.z - 4.6 };
  const a = actor(start);
  assert.equal(walk(a, { x: BIRYONG_CENTER.x, z: BIRYONG_CENTER.z - 1.3 }), true);
  assert.ok(Math.abs(a.entity.getLocalPosition().y - 1.15 - BIRYONG_PLATFORM.height) < 1e-6, 'standing on the platform');
  assert.equal(walk(a, BIRYONG_CENTER, 240), false, 'the main column is solid');
  const path = BIRYONG_PLAZA_PATHS[0].points;
  const b = actor(path[3]);
  assert.equal(walk(b, ECHO_CENTER), true, 'tower-side gap leads into the ring');
  assert.ok(isAtEchoCenter(b.entity.getLocalPosition()));
});

test('Auto Move can route from the main gate to the echo centre and the tower forecourt', () => {
  const nav = createCampusNavigation();
  for (const poiId of ['poi.biryong-echo-stone', 'poi.biryong-tower']) {
    const target = nav.poiTarget({ poiId, x: ECHO_CENTER.x, z: ECHO_CENTER.z, title: poiId });
    const route = nav.solver.solve(LANDMARKS.gate, target.approach);
    assert.equal(route.ok, true, poiId);
    const end = route.points.at(-1);
    assert.ok(Math.hypot(end.x - target.approach.x, end.z - target.approach.z) < 0.5, `${poiId} ends at its approach`);
  }
  const echo = nav.poiTarget({ poiId: 'poi.biryong-echo-stone', x: 0, z: 0 });
  assert.ok(echo.arrivalRadius < ECHO_CENTER_RADIUS, 'arrival lands inside the echo trigger');
});

test('discovery radius is 18 m around the tower', () => {
  assert.ok(isNearBiryong({ x: BIRYONG_CENTER.x + 8.9, z: BIRYONG_CENTER.z }));
  assert.ok(!isNearBiryong({ x: BIRYONG_CENTER.x + 9.1, z: BIRYONG_CENTER.z }));
});

test('BR01 progress discovers once, moves only forward and survives reload', () => {
  const storage = memoryStorage();
  let clock = 1000;
  const p = createBiryongProgress({ storage, now: () => clock++ });
  assert.equal(p.discovered, false);
  assert.equal(p.advance(BR01_STEP.FIND_CENTER), false, 'no event before discovery');
  assert.equal(p.discover(), true);
  assert.equal(p.discover(), false);
  assert.equal(p.advance(BR01_STEP.FIND_CENTER), true);
  assert.equal(p.advance(BR01_STEP.INTRO), false, 'never backwards');
  assert.equal(p.advance(BR01_STEP.REACTION), true);
  const reloaded = createBiryongProgress({ storage });
  assert.equal(reloaded.step, BR01_STEP.SHOUT, 'mid-dialogue resumes at the shout objective');
  assert.equal(reloaded.addLore(CAMPUS_LORE.BIRYONG_TOWER.id), true);
  assert.equal(reloaded.addLore(CAMPUS_LORE.BIRYONG_TOWER.id), false);
  assert.equal(reloaded.advance(BR01_STEP.COMPLETE), true);
  assert.equal(reloaded.advance(BR01_STEP.COMPLETE), false);
  const again = createBiryongProgress({ storage });
  assert.equal(again.complete, true);
  assert.deepEqual(again.lore, ['CAMPUS_LORE_BIRYONG_01']);
});

test('account snapshots merge monotonically and legacy local progress is adopted only once', () => {
  const local = {
    discoveredAt: 2000, step: BR01_STEP.FIND_CENTER, lore: [CAMPUS_LORE.BIRYONG_TOWER.id],
    shouts: 2, completedAt: null
  };
  const remote = {
    discoveredAt: 1000, step: BR01_STEP.COMPLETE,
    lore: [CAMPUS_LORE.ECHO_STONE.id], shouts: 1, completedAt: 4000
  };
  const merged = mergeBiryongSnapshots(local, remote);
  assert.equal(merged.step, BR01_STEP.COMPLETE);
  assert.equal(merged.discoveredAt, 1000);
  assert.equal(merged.completedAt, 4000);
  assert.equal(merged.shouts, 2);
  assert.deepEqual(new Set(merged.lore), new Set([CAMPUS_LORE.BIRYONG_TOWER.id, CAMPUS_LORE.ECHO_STONE.id]));

  const storage = memoryStorage();
  const p = createBiryongProgress({ storage, now: () => 5000 });
  p.discover();
  p.advance(BR01_STEP.COMPLETE);
  const first = p.setScope('account:user-a', { adoptLegacy: true });
  assert.equal(first.migrated, true);
  assert.equal(p.complete, true);
  const same = p.setScope('account:user-a', { adoptLegacy: true });
  assert.equal(same.changed, false);
  const switched = p.setScope('account:user-b', { adoptLegacy: true });
  assert.equal(switched.reset, true);
  assert.equal(p.complete, false, 'another account never inherits the first account local cache');
});

test('corrupt or missing storage never breaks the event', () => {
  const bad = { getItem: () => '{not json', setItem() { throw new Error('quota'); } };
  const p = createBiryongProgress({ storage: bad });
  assert.equal(p.discovered, false);
  assert.equal(p.discover(), true);
  assert.equal(createBiryongProgress().step, BR01_STEP.INTRO);
  const storage = memoryStorage();
  storage.setItem(BIRYONG_STORAGE_KEY, JSON.stringify({ step: 'HACKED', shouts: -3, lore: [1, 'x'] }));
  const q = createBiryongProgress({ storage });
  assert.equal(q.step, BR01_STEP.INTRO);
  assert.equal(q.shouts, 0);
  assert.deepEqual(q.lore, ['x']);
});

test('echo is a fake spatial reflection: +180 ms at -6 dB, then +260 ms at -12 dB', () => {
  assert.deepEqual(ECHO_TAPS.map(t => t.delayMs), [180, 440]);
  const schedule = echoSchedule(FIRST_SHOUT);
  assert.deepEqual(schedule.map(t => t.kind), ['shout', 'echo', 'echo']);
  assert.equal(schedule[1].delayMs - schedule[0].delayMs, 180);
  assert.equal(schedule[2].delayMs - schedule[1].delayMs, 260);
  assert.ok(Math.abs(schedule[1].gain - dbToGain(-6)) < 1e-12 && schedule[1].gain > schedule[2].gain);
  assert.equal(echoText('아아!'), '…아아… 아아…');
  assert.equal(echoText('시험 없어져라!'), '…없어져라… 져라…');
  assert.equal(echoText('인하!'), '…인하… 인하…');
});

test('free shouts rotate through campus lines without repeating back-to-back', () => {
  assert.ok(SHOUT_LINES.includes('시험 없어져라!') && SHOUT_LINES.length >= 4);
  for (const r of [0, 0.2, 0.5, 0.99, 1, -1, NaN]) {
    const line = pickShoutLine(() => r, '인하!');
    assert.ok(SHOUT_LINES.includes(line));
    assert.notEqual(line, '인하!');
  }
});

test('shout pose runs look-around → hand to mouth → shout → reaction, then ends', () => {
  assert.equal(shoutPoseOffsets(-1), null);
  assert.equal(shoutPoseOffsets(SHOUT_POSE.durationMs), null);
  assert.ok(Math.abs(shoutPoseOffsets(SHOUT_POSE.lookAroundMs / 4).bodyYaw) > 5, 'looks around');
  const shouting = shoutPoseOffsets(SHOUT_POSE.handMs + 200);
  assert.ok(shouting.bodyPitch < -10 && shouting.wingR[2] > 40, 'wings cupped while shouting');
  const reacting = shoutPoseOffsets(SHOUT_POSE.shoutMs + 500);
  assert.ok(reacting.bodyRoll > 3 && reacting.wingR[2] < shouting.wingR[2]);
});

test('비룡탑 and 울림돌 map POIs stay 미발견 until the place is discovered', () => {
  let discovered = false;
  const data = createMiniMapDataSource({ isPlaceDiscovered: id => id === BIRYONG_PLACE_ID && discovered });
  const registry = data.poiRegistry();
  const tower = registry.get('poi.biryong-tower');
  assert.equal(tower.discoveryState, MAP_DISCOVERY_STATE.UNDISCOVERED);
  assert.equal(tower.presentation, MAP_POI_PRESENTATION.UNDISCOVERED);
  assert.deepEqual({ x: tower.x, z: tower.z }, { x: BIRYONG_CENTER.x, z: BIRYONG_CENTER.z });
  discovered = true;
  assert.equal(registry.get('poi.biryong-tower').presentation, MAP_POI_PRESENTATION.NORMAL);
  const echo = registry.get('poi.biryong-echo-stone');
  assert.equal(echo.presentation, MAP_POI_PRESENTATION.NORMAL);
  assert.deepEqual({ x: echo.x, z: echo.z }, { x: ECHO_CENTER.x, z: ECHO_CENTER.z });
  assert.ok(!registry.list({ surface: MAP_SURFACE.MINIMAP }).some(p => p.poiId === 'poi.biryong-echo-stone'), 'echo POI is Full Map only');
  // Other POIs have no discovery gate.
  assert.equal(registry.get('poi.main-gate').presentation, MAP_POI_PRESENTATION.NORMAL);
});
