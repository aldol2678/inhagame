import * as pc from 'playcanvas';
import { SITE_FEATURES } from '../basic-campus.js';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { FLAT_GROUND_MAX_Y, FLAT_GROUND_Y } from '../flat-ground-surface.js';
import { MAIN_GATE_FORECOURT_QUADS } from '../main-gate-forecourt.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import { triangulatePolygon } from '../reality-adapter.js';
import {
  SNOW_DRIFT_SPEED,
  SNOW_FALL_SPEED,
  SNOW_FLAKE_BUDGET,
  SNOW_VOLUME_HEIGHT,
  snowFlakeLayout,
  snowOpacity
} from './snow-weather-policy.js';
import {
  SNOW_GROUND_DRAW_BUDGET,
  snowGroundVisibility,
  stepSnowAccumulation
} from './snow-ground-policy.js';

function pushQuad(positions, normals, indices, a, b, c, d, normal) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(...normal);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function createSnowMesh(device, tier) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (const flake of snowFlakeLayout(tier)) {
    const { x, y, z, size, stretch, twist } = flake;
    const c = Math.cos(twist), s = Math.sin(twist);
    const hx = size * stretch;
    const hy = size;
    const ax = c * hx, az = s * hx;
    const bx = -s * hx, bz = c * hx;

    pushQuad(
      positions, normals, indices,
      [x - ax, y - hy, z - az],
      [x + ax, y - hy, z + az],
      [x + ax, y + hy, z + az],
      [x - ax, y + hy, z - az],
      [0, 0, 1]
    );
    pushQuad(
      positions, normals, indices,
      [x - bx, y - hy, z - bz],
      [x + bx, y - hy, z + bz],
      [x + bx, y + hy, z + bz],
      [x - bx, y + hy, z - bz],
      [1, 0, 0]
    );
  }

  return pc.createMesh(device, positions, { normals, indices });
}

function createSnowMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-snow-flakes';
  material.diffuse = new pc.Color(0.96, 0.98, 1.0);
  material.emissive = new pc.Color(0.86, 0.91, 0.98);
  material.emissiveIntensity = 0.5;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useLighting = false;
  material.update();
  return material;
}

function createSnowTier(root, device, tier, material) {
  const mesh = createSnowMesh(device, tier);
  const entity = new pc.Entity(`environment_snow_${tier}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return entity;
}

function createGroundMaterial(name, diffuse, specular, gloss) {
  const material = new pc.StandardMaterial();
  material.name = name;
  material.diffuse = new pc.Color(...diffuse);
  material.specular = new pc.Color(...specular);
  material.gloss = gloss;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function pushPolygon(positions, normals, indices, polygon, y) {
  const ids = triangulatePolygon(polygon);
  const offset = positions.length / 3;
  for (const point of polygon) {
    positions.push(point.x, y, point.z);
    normals.push(0, 1, 0);
  }
  for (const index of ids) indices.push(offset + index);
}

function createLawnSnowEntity(root, device, material) {
  const positions = [], normals = [], indices = [];
  const y = FLAT_GROUND_Y.UNDERLAY + 0.0005;
  for (const feature of SITE_FEATURES.filter(feature => feature.kind === 'lawn'))
    pushPolygon(positions, normals, indices, feature.vertices, y);

  const mesh = pc.createMesh(device, positions, { normals, indices });
  const entity = new pc.Entity('environment_snow_ground_lawns');
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: true,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return entity;
}

function addRoadSegment(positions, normals, indices, segment, y) {
  const half = segment.road.width / 2;
  const frame = segment.frame;
  const a = frame.at(0, -half);
  const b = frame.at(0, half);
  const c = frame.at(frame.length, half);
  const d = frame.at(frame.length, -half);
  pushQuad(
    positions, normals, indices,
    [a.x, y, a.z],
    [b.x, y, b.z],
    [c.x, y, c.z],
    [d.x, y, d.z],
    [0, 1, 0]
  );
}

function createRoadSnowEntity(root, device, material) {
  const positions = [], normals = [], indices = [];
  const campusY = FLAT_GROUND_MAX_Y + 0.0005;
  const gateY = MAIN_GATE_LEVELS.zebra + 0.0005;

  for (const segment of ROAD_SEGMENTS) addRoadSegment(positions, normals, indices, segment, campusY);
  for (const segment of GATE_DORM_SEGMENTS) addRoadSegment(positions, normals, indices, segment, gateY);
  for (const quad of MAIN_GATE_FORECOURT_QUADS) {
    pushQuad(
      positions, normals, indices,
      ...quad.map(point => [point.x, gateY, point.z]),
      [0, 1, 0]
    );
  }

  const mesh = pc.createMesh(device, positions, { normals, indices });
  const entity = new pc.Entity('environment_snow_ground_roads');
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: true,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return entity;
}

export function createSnowWeatherEffects({
  root,
  app,
  getPlayerPosition,
  getSnowIntensity,
  getGraphicsTier
}) {
  const device = app.graphicsDevice;
  const snowRoot = new pc.Entity('EnvironmentSnowRoot');
  const groundRoot = new pc.Entity('EnvironmentSnowGroundRoot');
  root.addChild(snowRoot);
  root.addChild(groundRoot);

  const material = createSnowMaterial();
  const lawnMaterial = createGroundMaterial(
    'environment-snow-ground-lawns',
    [0.92, 0.95, 0.98],
    [0.14, 0.16, 0.18],
    0.2
  );
  const roadMaterial = createGroundMaterial(
    'environment-snow-ground-roads',
    [0.84, 0.88, 0.92],
    [0.18, 0.20, 0.22],
    0.26
  );
  const lawnGround = createLawnSnowEntity(groundRoot, device, lawnMaterial);
  const roadGround = createRoadSnowEntity(groundRoot, device, roadMaterial);
  const tiers = Object.fromEntries(
    Object.keys(SNOW_FLAKE_BUDGET).map(tier => [
      tier,
      createSnowTier(snowRoot, device, tier, material)
    ])
  );

  let tier = null;
  let intensity = -1;
  let accumulation = 0;
  let appliedAccumulation = -1;
  let phase = 0;
  let driftPhase = 0;
  let destroyed = false;

  function applyGround(force = false) {
    const currentTier = tier ?? 'medium';
    const visibility = snowGroundVisibility(accumulation, currentTier);
    if (!force && Math.abs(visibility.accumulation - appliedAccumulation) < 0.006) return;
    appliedAccumulation = visibility.accumulation;

    lawnMaterial.opacity = visibility.lawn;
    roadMaterial.opacity = visibility.road;
    lawnMaterial.update();
    roadMaterial.update();

    const active = visibility.accumulation > 0.01;
    groundRoot.enabled = active;
    lawnGround.enabled = active;
    roadGround.enabled = active && visibility.roadEnabled;
  }

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(SNOW_FLAKE_BUDGET, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(tiers))
      entity.enabled = intensity > 0.01 && name === tier;
    applyGround(true);
  }

  function applyIntensity(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - intensity) < 0.005) return;
    intensity = safe;
    material.opacity = safe * snowOpacity(tier ?? 'medium');
    material.update();
    snowRoot.enabled = safe > 0.01;
    if (snowRoot.enabled) {
      for (const [name, entity] of Object.entries(tiers)) entity.enabled = name === (tier ?? 'medium');
    }
  }

  function update(dt) {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyIntensity(getSnowIntensity?.() ?? 0);

    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const nextAccumulation = stepSnowAccumulation(accumulation, Math.max(0, intensity), safeDt);
    if (Math.abs(nextAccumulation - accumulation) > 1e-9) accumulation = nextAccumulation;
    applyGround();

    if (intensity <= 0.01) return;

    phase = (phase + safeDt * SNOW_FALL_SPEED) % SNOW_VOLUME_HEIGHT;
    driftPhase = (driftPhase + safeDt * SNOW_DRIFT_SPEED) % (Math.PI * 2);

    const p = getPlayerPosition?.();
    if (p) {
      const driftX = Math.sin(driftPhase) * 0.9;
      const driftZ = Math.cos(driftPhase * 0.73) * 0.55;
      snowRoot.setLocalPosition(p.x + driftX, p.y + 7 - phase, p.z + driftZ);
    }
    snowRoot.setLocalEulerAngles(0, driftPhase * 8, 0);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const visibility = snowGroundVisibility(accumulation, currentTier);
    return Object.freeze({
      graphicsTier: currentTier,
      snowIntensity: Math.max(0, intensity),
      enabled: intensity > 0.01,
      flakeBudget: SNOW_FLAKE_BUDGET[currentTier] ?? SNOW_FLAKE_BUDGET.medium,
      opacity: Math.max(0, intensity) * snowOpacity(currentTier),
      drawMeshes: intensity > 0.01 ? 1 : 0,
      groundAccumulation: visibility.accumulation,
      groundEnabled: visibility.accumulation > 0.01,
      groundLawnOpacity: visibility.lawn,
      groundRoadOpacity: visibility.road,
      groundRoadEnabled: visibility.roadEnabled,
      groundDrawMeshes: visibility.accumulation > 0.01
        ? (SNOW_GROUND_DRAW_BUDGET[currentTier] ?? SNOW_GROUND_DRAW_BUDGET.medium)
        : 0,
      extraRealLights: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    snowRoot.destroy();
    groundRoot.destroy();
    material.destroy();
    lawnMaterial.destroy();
    roadMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
