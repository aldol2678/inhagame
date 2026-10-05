import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSTACLES } from '../src/campus-layout.js';
import { cameraSafeFraction, canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { polygonCameraFraction, polygonOverlap } from '../src/polygon-collision.js';
import { inMainGateCameraArea, mainGatePolygonCameraFraction } from '../src/main-gate-camera-collision.js';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { MAIN_GATE_SPAWN } from '../src/campus-spawn.js';
import { GATE_FRAME } from '../src/main-gate-frame.js';
import { MAIN_GATE_CAMPUS_BIKE_COLLIDER, CAMPUS_BIKE_ID } from '../src/mounts/campus-bike-world.js';
import { MAIN_GATE_GUESTBOOK_COLLIDER } from '../src/guestbook/guestbook-world.js';
import { readFileSync } from 'node:fs';
import { createEquipmentAnchors } from '../src/appearance/equipment-anchors.js';

function fixture() {
  globalThis.document = { getElementById: () => null, body: { dataset: {} } };
  globalThis.window = { addEventListener() {} };
  const camera = { camera: { nearClip: .3 }, setPosition(...p) { this.position = p; }, lookAt(...p) { this.target = p; } };
  const orbit = new OrbitCameraController(camera, { addEventListener() {} });
  return { camera, orbit };
}
function candidate(from, distance = 3.5, yaw = 0, pitch = Math.atan2(7.3, 18.5)) {
  const horizontal = Math.cos(Math.max(.12, pitch)) * distance;
  return [from[0] + Math.sin(yaw) * (horizontal - .35),
    from[1] + Math.sin(Math.max(.12, pitch)) * distance,
    from[2] - Math.cos(yaw) * (horizontal - .35)];
}
function legacyFraction(from, to) {
  // All production obstacles in the gate repro are polygons. Explicit sets retain
  // this legacy contract, so this also records the pre-fix baseline numerically.
  return cameraSafeFraction(from, to, [...OBSTACLES]);
}

test('actual main footprint reproduces a phantom building hit on the clear gate axis', () => {
  const body = OBSTACLES.find(b => b.id === 'bldg_continuing_0');
  const from = [.5, .8, -92.6], to = candidate(from, 1.5);
  assert.ok(Math.min(...body.polygon.map(p => p.x)) > 24);
  assert.equal(polygonOverlap(from[0], from[2], body.polygon, .35), false);
  assert.equal(canOccupy({ x: from[0], y: 1.15, z: from[2] }), true);
  assert.equal(polygonCameraFraction(from, to, body), .06, 'baseline incorrectly pulls the camera into the avatar');
  assert.equal(mainGatePolygonCameraFraction(from, to, body), 1);
  assert.equal(cameraSafeFraction(from, to), 1);
  assert.equal(legacyFraction(from, to), .06, 'explicit obstacle sets preserve their existing contract');
});

test('finite outline sweep keeps real walls, rounded corners and vertical slabs solid', () => {
  const body = { polygon: [{ x: 2, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 1 }, { x: 2, z: 1 }], minY: 0, maxY: 2 };
  assert.ok(Math.abs(mainGatePolygonCameraFraction([0, 1, 0], [4, 1, 0], body) - (.4125 - .025)) < 1e-9);
  assert.equal(mainGatePolygonCameraFraction([0, 3, 0], [4, 3, 0], body), 1);
  assert.equal(mainGatePolygonCameraFraction([0, 1, 2], [4, 1, 2], body), 1);
  assert.ok(mainGatePolygonCameraFraction([0, 1, 1.2], [4, 1, 1.2], body) < 1, 'vertex discs cover the near corner');
  assert.equal(mainGatePolygonCameraFraction([2.5, 1, 0], [2.5, 4, 0], body), .06);
  assert.equal(mainGatePolygonCameraFraction([2.5, 4, 0], [2.5, 1, 0], body) < 1, true);
  const reversed = { ...body, polygon: [...body.polygon].reverse() };
  assert.equal(mainGatePolygonCameraFraction([0, 1, 0], [4, 1, 0], body), mainGatePolygonCameraFraction([0, 1, 0], [4, 1, 0], reversed));
});

test('concave setback stays empty instead of being filled by a triangulation envelope', () => {
  const body = { polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 4 }, { x: 0, z: 4 }], minY: 0, maxY: 3 };
  assert.equal(mainGatePolygonCameraFraction([2, 1, 2], [3, 1, 3], body), 1);
  assert.ok(mainGatePolygonCameraFraction([2, 1, 2], [.5, 1, 2], body) < 1);
});

test('spawn to inner road and return stay clear across walk/RUN, pitch/yaw and zoom matrix', () => {
  const { orbit, camera } = fixture();
  let samples = 0;
  for (const step of [.15, .3]) for (const direction of [1, -1]) {
    let p = { ...MAIN_GATE_SPAWN, z: direction === 1 ? MAIN_GATE_SPAWN.z : -76 };
    while (direction === 1 ? p.z < -76 : p.z > MAIN_GATE_SPAWN.z) {
      const dz = direction * Math.min(step, Math.abs(p.z - (direction === 1 ? -76 : MAIN_GATE_SPAWN.z)));
      const next = moveAroundObstacles(p, 0, dz);
      assert.ok(Math.abs(next.z - (p.z + dz)) < 1e-7);
      p = { ...next, y: MAIN_GATE_SPAWN.y };
      for (const distance of [1.5, 3.5, 7]) for (const pitch of [-1.25, .12, Math.atan2(7.3, 18.5), 1.2]) for (const yaw of [-.3, 0, .3]) {
        orbit.distance = distance; orbit.pitch = pitch; orbit.yaw = yaw;
        orbit.apply(p, -.35);
        assert.ok(camera.position.every(Number.isFinite));
        assert.equal(cameraSafeFraction([p.x, .8, p.z], candidate([p.x, .8, p.z], distance, yaw, pitch)), 1);
        assert.equal(orbit.localVisualOccluded, false, 'clear route never hides the local avatar');
        samples++;
      }
    }
  }
  assert.ok(samples > 15000, `${samples} camera/movement samples`);
});

test('bike and guestbook keep their gameplay collision and camera occlusion', () => {
  for (const body of [MAIN_GATE_CAMPUS_BIKE_COLLIDER, MAIN_GATE_GUESTBOOK_COLLIDER]) {
    const x = body.polygon.reduce((s, p) => s + p.x, 0) / body.polygon.length;
    const z = body.polygon.reduce((s, p) => s + p.z, 0) / body.polygon.length;
    assert.equal(canOccupy({ x, y: 1.15, z }), false);
    assert.ok(mainGatePolygonCameraFraction([x - 2, .5, z], [x + 2, .5, z], body) < 1);
  }
});

test('real close gate wall masks local visuals without changing perspective, zoom or nearClip', () => {
  const { orbit, camera } = fixture();
  const p = { ...GATE_FRAME.at(10, .86), y: 1.15 };
  assert.equal(canOccupy(p), true);
  orbit.distance = 3.5;
  orbit.apply(p, -.35);
  assert.equal(orbit.localVisualOccluded, true);
  assert.equal(orbit.firstPerson, false);
  assert.equal(orbit.distance, 3.5);
  assert.equal(camera.camera.nearClip, .3);
  orbit.apply(MAIN_GATE_SPAWN, -.35);
  assert.equal(orbit.localVisualOccluded, false);
  orbit.togglePerspective(); orbit.apply(p, -.35);
  assert.equal(orbit.localVisualOccluded, false);
  assert.equal(camera.camera.nearClip, .05);
});

test('indoor, flight and exterior camera sets preserve the legacy authority', () => {
  const { orbit, camera } = fixture();
  const from = [.5, .8, -92.6], to = candidate(from);
  assert.equal(inMainGateCameraArea([0, 3.25, -90]), false);
  assert.equal(inMainGateCameraArea([0, .8, 0]), false);
  const farFrom = [-50, .8, -50], farTo = [-48, 2, -54];
  assert.equal(cameraSafeFraction(farFrom, farTo), legacyFraction(farFrom, farTo));
  assert.equal(cameraSafeFraction([0, 3.25, -90], [0, 12, -108]), legacyFraction([0, 3.25, -90], [0, 12, -108]));
  orbit.setIndoor({ obstacles: OBSTACLES });
  orbit.apply({ x: from[0], y: 1.15, z: from[2] }, -.35);
  // Explicit indoor sets may even be the campus array: orbit must preserve the
  // indoor policy rather than let array identity select a gate-specific override.
  assert.equal(orbit.localVisualOccluded, false);
  const indoorEye = [from[0], .8, from[2]];
  const indoorCandidate = candidate(indoorEye, orbit.distance, orbit.yaw, orbit.pitch);
  const fraction = legacyFraction(indoorEye, indoorCandidate);
  assert.ok(Math.abs(camera.position[0] - (indoorEye[0] + (indoorCandidate[0] - indoorEye[0]) * fraction)) < 1e-9);
  assert.ok(Math.abs(-camera.position[2] - (indoorEye[2] + (indoorCandidate[2] - indoorEye[2]) * fraction)) < 1e-9);
  orbit.setIndoor(null);
  document.body.dataset.mountId = CAMPUS_BIKE_ID;
  orbit.setMounted(true); assert.equal(orbit.mounted, false);
  orbit.apply(MAIN_GATE_SPAWN, -.04);
  assert.ok(camera.position.every(Number.isFinite));
  document.body.dataset.mountId = 'mount.annyongi';
  orbit.setMounted(true); assert.equal(orbit.mounted, true);
  orbit.apply(MAIN_GATE_SPAWN, -.35);
  assert.equal(orbit.localVisualOccluded, false);
  assert.equal(cameraSafeFraction(from, to, []), 1);
});

test('local visibility guard follows GLB loading, equipment, bike, helicopter and first-person transitions', async () => {
  class Entity {
    constructor(name) { this.name = name; this.children = []; this.enabled = true; }
    addChild(child) { this.children.push(child); child.parent = this; }
    addComponent() { this.render = {}; }
    setLocalPosition() {} setLocalScale() {} setLocalEulerAngles() {}
    getLocalEulerAngles() { return { x: 0, y: 0, z: 0 }; }
    findByName(name) { return this.name === name ? this : this.children.map(c => c.findByName(name)).find(Boolean); }
    destroy() { this.enabled = false; }
  }
  class Material { update() {} }
  const pending = new Map();
  const pc = { Entity, StandardMaterial: Material, Color: class {} };
  const text = readFileSync(new URL('../src/character-model.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function createCharacter', 'function createCharacter');
  const prototypeDefinitions = [
    ['CAMPUS_KICKBOARD_ID', 'mount.campus_kickboard.prototype', 'createCampusKickboard'],
    ['CAMPUS_KART_ID', 'mount.campus_kart.prototype', 'createCampusKart'],
    ['DUCK_BOAT_ID', 'mount.inkyung_duckboat.prototype', 'createDuckBoat'],
    ['CAMPUS_SHUTTLE_ID', 'mount.campus_shuttle.prototype', 'createCampusShuttle'],
    ['CAMPUS_BALLOON_ID', 'mount.campus_balloon.prototype', 'createCampusBalloon']
  ];
  const prototypes = Object.fromEntries(prototypeDefinitions.flatMap(([constant, id, factory]) => [
    [constant, id], [factory, player => { const e = new Entity(id); player.addChild(e); return e; }]
  ]));
  const createCharacter = new Function('pc', 'composeEmotePose', 'emoteOffsets', 'REST_OFFSETS', 'SIT_OFFSETS',
    'HUMAN_HEIGHT', 'PLAYER_ORIGIN_Y', 'CAMPUS_BIKE_ID', 'attachRiderBike', 'CAMPUS_HELICOPTER_ID', 'attachRiderHelicopter', 'createEquipmentAnchors', 'prototypes',
    `const {${Object.keys(prototypes).join(',')}} = prototypes;\n${text};return createCharacter;`)
    (pc, p => p, () => ({}), {}, {}, .875, 1.15, CAMPUS_BIKE_ID,
      player => { const e = new Entity('RiderBike'); player.addChild(e); return e; }, 'mount.campus_helicopter',
      player => { const root = new Entity('RiderHelicopter'); player.addChild(root); return { root, update(_dt, {active}) { root.enabled = active; } }; }, createEquipmentAnchors, prototypes);
  const player = new Entity('Player');
  const character = createCharacter({ assets: { loadFromUrl(url, _kind, cb) { pending.set(url, cb); } } }, player);
  character.setCameraOccluded(true);
  assert.equal(player.findByName('Public_QA_Avatar').enabled, false);
  assert.equal(character.equipmentVisible, false);
  const duck = new Entity('loadedDuck'), dragon = new Entity('loadedDragon');
  for (const name of ['DuckWing_L', 'DuckWing_R', 'DuckLeg_L', 'DuckLeg_R']) duck.addChild(new Entity(name));
  for (const name of ['DragonWing_L', 'DragonWing_R']) dragon.addChild(new Entity(name));
  pending.get('/assets/induck-v3.glb')(null, { resource: { instantiateRenderEntity: () => duck } });
  pending.get('/assets/annyongi-flight-v1.glb')(null, { resource: { instantiateRenderEntity: () => dragon } });
  assert.equal(await character.ready, 'glb');
  assert.equal(duck.enabled, false, 'late-loaded GLB respects the current camera guard');
  character.setCameraOccluded(false);
  assert.equal(duck.enabled, true); assert.equal(character.equipmentVisible, true);
  player.mountKind = CAMPUS_BIKE_ID; character.setMounted(true);
  assert.equal(player.findByName('RiderBike').enabled, true);
  character.setCameraOccluded(true);
  assert.equal(player.findByName('RiderBike').enabled, false);
  character.setFirstPerson(true); character.setCameraOccluded(false);
  assert.equal(duck.enabled, false); assert.equal(character.equipmentVisible, false);
  character.setFirstPerson(false);
  assert.equal(duck.enabled, true); assert.equal(character.equipmentVisible, true);
  assert.equal(player.findByName('RiderBike').enabled, true);
  player.mountKind = 'mount.campus_helicopter'; character.setMounted(true);
  assert.equal(player.findByName('RiderHelicopter').enabled, true);
  assert.equal(player.findByName('RiderBike').enabled, false);
  character.setCameraOccluded(true);
  character.update(.016, { mounted: true, moving: false, grounded: false });
  assert.equal(player.findByName('RiderHelicopter').enabled, false);
  character.setCameraOccluded(false);
  assert.equal(player.findByName('RiderHelicopter').enabled, true);
  character.setFirstPerson(true);
  assert.equal(player.findByName('RiderHelicopter').enabled, false);
  character.setFirstPerson(false);
  for (const [, id] of prototypeDefinitions) {
    player.mountKind = id; character.setMounted(true);
    assert.equal(player.findByName(id).enabled, true, `${id} is visible when ridden`);
    assert.equal(player.findByName('RiderHelicopter').enabled, false);
    character.setCameraOccluded(true);
    character.update(.016, {mounted:true,moving:false,grounded:true});
    assert.equal(player.findByName(id).enabled, false, `${id} respects camera occlusion`);
    character.setCameraOccluded(false);
    assert.equal(player.findByName(id).enabled, true);
    character.setFirstPerson(true);
    assert.equal(player.findByName(id).enabled, false, `${id} respects first-person mode`);
    character.setFirstPerson(false);
  }
  player.mountKind = 'mount.annyongi'; character.setMounted(true);
  assert.equal(dragon.enabled, true);
  character.setFirstPerson(true); assert.equal(dragon.enabled, false);
});

