// PlayCanvas presentation for the Main Gate / Dormitory 1 junction signals.
//
// Poles, brackets and housings are static dark boxes; only the lens material of a head changes, and
// only when the shared controller's state changes (phase change or one pedestrian blink frame).
// An active lens uses an emissive "on" material, an inactive one a dark tinted "off" material, so
// colour stays readable in daylight and no real omni light is added (night light budget untouched).
import * as pc from 'playcanvas';
import { TRAFFIC_SIGNAL_DIMENSIONS, TRAFFIC_SIGNAL_INTERSECTION } from './traffic-signal-layout.js';
import { createTrafficSignalController, trafficSignalConflicts } from './traffic-signal-policy.js';

const LENS_COLORS = Object.freeze({
  red: { on: [1, 0.14, 0.1], off: [0.2, 0.035, 0.035] },
  amber: { on: [1, 0.72, 0.1], off: [0.22, 0.15, 0.03] },
  green: { on: [0.14, 1, 0.42], off: [0.03, 0.18, 0.07] }
});
const LENS_EMISSIVE_INTENSITY = 2.4;
const VEHICLE_LENS_ORDER = Object.freeze(['red', 'amber', 'green']);

function createStandardMaterial(name, diffuse, emissive = null, emissiveIntensity = 0) {
  const material = new pc.StandardMaterial();
  material.name = name;
  material.diffuse = new pc.Color(...diffuse);
  if (emissive) {
    material.emissive = new pc.Color(...emissive);
    material.emissiveIntensity = emissiveIntensity;
  }
  material.useLighting = true;
  material.update();
  return material;
}

function createLensMaterials() {
  const materials = {};
  for (const [name, colors] of Object.entries(LENS_COLORS)) {
    materials[name] = {
      on: createStandardMaterial(`traffic-signal-${name}-on`, colors.on, colors.on, LENS_EMISSIVE_INTENSITY),
      off: createStandardMaterial(`traffic-signal-${name}-off`, colors.off)
    };
  }
  return materials;
}

function addBox(parent, name, material, position, scale, yaw = 0, { shadows = false } = {}) {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type: 'box', castShadows: shadows, receiveShadows: shadows });
  entity.render.material = material;
  entity.setLocalPosition(position.x, position.y, position.z);
  entity.setLocalScale(scale.x, scale.y, scale.z);
  entity.setLocalEulerAngles(0, yaw, 0);
  parent.addChild(entity);
  return entity;
}

// A head faces its local +X axis; the entity yaw maps that axis onto the layout's facing vector.
function createHead(parent, name, mount, size, lensRows, materials, housingMaterial) {
  const d = TRAFFIC_SIGNAL_DIMENSIONS;
  const head = new pc.Entity(name);
  head.setLocalPosition(mount.position.x, mount.position.y, mount.position.z);
  head.setLocalEulerAngles(0, mount.yaw, 0);
  parent.addChild(head);
  addBox(head, `${name}_housing`, housingMaterial, { x: 0, y: 0, z: 0 },
    { x: size.depth, y: size.height, z: size.width });
  const lenses = [];
  const spacing = size.height / lensRows.length;
  lensRows.forEach((row, index) => {
    const y = size.height / 2 - spacing * (index + 0.5);
    const entity = addBox(head, `${name}_lens_${row.id}`, materials[row.lamp].off,
      { x: size.depth / 2 + 0.008, y, z: 0 },
      { x: 0.04, y: d.lensSize, z: d.lensSize });
    lenses.push({ entity, lamp: row.lamp, key: row.key, on: false });
  });
  return lenses;
}

export function createTrafficSignals({
  root,
  intersection = TRAFFIC_SIGNAL_INTERSECTION,
  controller = createTrafficSignalController(),
  // Monotonic seconds. The cycle follows this clock rather than summed frame deltas, so a slow or
  // stalled frame rate (PlayCanvas clamps dt) can never stretch or skip signal phases.
  clock = () => globalThis.performance.now() / 1000
}) {
  const startSeconds = clock();
  const d = TRAFFIC_SIGNAL_DIMENSIONS;
  const lensMaterials = createLensMaterials();
  const poleMaterial = createStandardMaterial('traffic-signal-pole', [0.17, 0.19, 0.19]);
  const housingMaterial = createStandardMaterial('traffic-signal-housing', [0.05, 0.055, 0.055]);
  const group = new pc.Entity(`traffic_signals_${intersection.id}`);
  root.addChild(group);

  const vehicleLenses = [];
  const pedestrianLenses = [];
  let vehicleHeadCount = 0;
  let pedestrianHeadCount = 0;

  for (const pole of intersection.poles) {
    const prefix = `traffic_signal_${pole.id}`;
    addBox(group, `${prefix}_pole`, poleMaterial,
      { x: pole.pole.x, y: pole.height / 2, z: pole.pole.z },
      { x: d.poleSize, y: pole.height, z: d.poleSize }, 0, { shadows: true });

    if (pole.vehicle) {
      const arm = pole.vehicle.arm;
      const dx = arm.position.x - pole.pole.x;
      const dz = arm.position.z - pole.pole.z;
      const reach = Math.hypot(dx, dz);
      addBox(group, `${prefix}_arm`, poleMaterial,
        { x: pole.pole.x + dx / 2, y: arm.position.y + d.vehicleHeadSize.height / 2 + 0.04, z: pole.pole.z + dz / 2 },
        { x: reach, y: 0.07, z: 0.07 }, -Math.atan2(dz, dx) * 180 / Math.PI);
      const lenses = createHead(group, `${prefix}_vehicle`, arm, d.vehicleHeadSize,
        VEHICLE_LENS_ORDER.map(lamp => ({ id: lamp, lamp, key: pole.vehicle.group })), lensMaterials, housingMaterial);
      vehicleLenses.push(...lenses);
      vehicleHeadCount++;
    }

    if (pole.pedestrian) {
      const lenses = createHead(group, `${prefix}_pedestrian`, pole.pedestrian.head, d.pedestrianHeadSize, [
        { id: 'stop', lamp: 'red', key: 'stop' },
        { id: 'walk', lamp: 'green', key: 'walk' }
      ], lensMaterials, housingMaterial);
      pedestrianLenses.push(...lenses);
      pedestrianHeadCount++;
    }
  }

  let appliedKey = null;
  let destroyed = false;
  let lastState = controller.state();

  function apply(state) {
    const key = `${state.phaseIndex}:${state.pedestrianLens.stop ? 1 : 0}`;
    lastState = state;
    if (key === appliedKey) return;
    appliedKey = key;
    for (const lens of vehicleLenses) {
      const on = state.vehicle[lens.key] === lens.lamp;
      if (on === lens.on) continue;
      lens.on = on;
      lens.entity.render.material = lensMaterials[lens.lamp][on ? 'on' : 'off'];
    }
    for (const lens of pedestrianLenses) {
      const on = state.pedestrianLens[lens.key];
      if (on === lens.on) continue;
      lens.on = on;
      lens.entity.render.material = lensMaterials[lens.lamp][on ? 'on' : 'off'];
    }
  }

  apply(lastState);

  function update() {
    if (destroyed) return;
    apply(controller.seek(clock() - startSeconds));
  }

  function status() {
    return Object.freeze({
      intersectionId: intersection.id,
      poleCount: intersection.poles.length,
      vehicleHeadCount,
      pedestrianHeadCount,
      lensCount: vehicleLenses.length + pedestrianLenses.length,
      phaseId: lastState.phaseId,
      phaseRemaining: lastState.phaseRemaining,
      cycleSeconds: lastState.cycleSeconds,
      vehicle: lastState.vehicle,
      pedestrian: lastState.pedestrian,
      pedestrianLens: lastState.pedestrianLens,
      conflicts: Object.freeze(trafficSignalConflicts(lastState)),
      litLenses: Object.freeze({
        vehicle: vehicleLenses.filter(lens => lens.on).length,
        pedestrian: pedestrianLenses.filter(lens => lens.on).length
      })
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    group.destroy();
    for (const pair of Object.values(lensMaterials)) {
      pair.on.destroy();
      pair.off.destroy();
    }
    poleMaterial.destroy();
    housingMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
