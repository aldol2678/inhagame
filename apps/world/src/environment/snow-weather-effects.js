import * as pc from 'playcanvas';
import { SITE_FEATURES } from '../basic-campus.js';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { FLAT_GROUND_MAX_Y, FLAT_GROUND_Y } from '../flat-ground-surface.js';
import { PLAYER_ORIGIN_Y } from '../player-dimensions.js';
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
  SNOW_FOOTPRINT_BUDGET,
  SNOW_FOOTPRINT_MIN_ACCUMULATION,
  SNOW_FOOTPRINT_SPACING,
  SNOW_FOOTPRINT_TELEPORT_RESET_DISTANCE,
  SNOW_GROUND_DRAW_BUDGET,
  snowFootprintBudget,
  snowFootprintOpacity,
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


function createFootprintMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-snow-footprints';
  material.diffuse = new pc.Color(0.18, 0.23, 0.28);
  material.emissive = new pc.Color(0.035, 0.045, 0.055);
  material.emissiveIntensity = 0.12;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useLighting = false;
  material.update();
  return material;
}

function pushFootprint(positions, normals, indices, mark) {
  const segments = 8;
  const center = positions.length / 3;
  positions.push(mark.x, mark.y, mark.z);
  normals.push(0, 1, 0);

  const lx = -mark.tz, lz = mark.tx;
  const halfLength = 0.14;
  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const along = Math.cos(angle) * halfLength;
    const toeFactor = 1 + Math.max(0, Math.cos(angle)) * 0.22;
    const across = Math.sin(angle) * 0.062 * toeFactor;
    positions.push(
      mark.x + mark.tx * along + lx * across,
      mark.y,
      mark.z + mark.tz * along + lz * across
    );
    normals.push(0, 1, 0);
  }

  for (let i = 0; i < segments; i++) {
    const current = center + 1 + i;
    const next = center + 1 + ((i + 1) % segments);
    indices.push(center, next, current);
  }
}

function createFootprintTrail(root, device, material) {
  const maxMarks = Math.max(...Object.values(SNOW_FOOTPRINT_BUDGET));
  const verticesPerMark = 9;
  const indicesPerMark = 24;
  const mesh = new pc.Mesh(device);
  mesh.clear(true, true, maxMarks * verticesPerMark, maxMarks * indicesPerMark);

  // Keep a valid dynamic buffer allocated while the entity starts disabled.
  mesh.setPositions([0, -1000, 0, 0, -1000, 0, 0, -1000, 0]);
  mesh.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  mesh.setIndices([0, 1, 2]);
  mesh.update();

  const entity = new pc.Entity('environment_snow_footprints');
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());

  function update(marks) {
    if (!marks.length) {
      entity.enabled = false;
      return;
    }
    const positions = [], normals = [], indices = [];
    for (const mark of marks) pushFootprint(positions, normals, indices, mark);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setIndices(indices);
    mesh.update();
    entity.enabled = true;
  }

  function clear() {
    entity.enabled = false;
  }

  return Object.freeze({ entity, update, clear });
}

export function createSnowWeatherEffects({
  root,
  app,
  getPlayerPosition,
  getSnowIntensity,
  getGraphicsTier,
  getFootprintsEnabled = () => true
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
  const footprintMaterial = createFootprintMaterial();
  const lawnGround = createLawnSnowEntity(groundRoot, device, lawnMaterial);
  const roadGround = createRoadSnowEntity(groundRoot, device, roadMaterial);
  const footprintTrail = createFootprintTrail(groundRoot, device, footprintMaterial);
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
  let footprints = [];
  let lastFootprintPosition = null;
  let footprintDistance = 0;
  let footprintSide = -1;
  let footprintMeshUpdates = 0;
  let destroyed = false;

  function applyGround(force = false) {
    const currentTier = tier ?? 'medium';
    const visibility = snowGroundVisibility(accumulation, currentTier);
    if (!force && Math.abs(visibility.accumulation - appliedAccumulation) < 0.006) return;
    appliedAccumulation = visibility.accumulation;

    lawnMaterial.opacity = visibility.lawn;
    roadMaterial.opacity = visibility.road;
    footprintMaterial.opacity = snowFootprintOpacity(currentTier, visibility.accumulation);
    lawnMaterial.update();
    roadMaterial.update();
    footprintMaterial.update();

    if (visibility.accumulation <= SNOW_FOOTPRINT_MIN_ACCUMULATION && footprints.length) {
      footprints = [];
      footprintTrail.clear();
      footprintDistance = 0;
    }

    const active = visibility.accumulation > 0.01;
    groundRoot.enabled = active;
    lawnGround.enabled = active;
    roadGround.enabled = active && visibility.roadEnabled;
    footprintTrail.entity.enabled = footprints.length > 0 && footprintMaterial.opacity > 0;
  }

  function rebuildFootprintTrail() {
    const budget = snowFootprintBudget(tier ?? 'medium');
    if (footprints.length > budget) footprints = footprints.slice(-budget);
    footprintTrail.update(footprints);
    footprintTrail.entity.enabled = footprints.length > 0 && footprintMaterial.opacity > 0;
    footprintMeshUpdates += 1;
  }

  function resetFootprintSampling(position = null) {
    lastFootprintPosition = position
      ? { x: Number(position.x) || 0, z: Number(position.z) || 0 }
      : null;
    footprintDistance = 0;
  }

  function updateFootprints(position) {
    if (!position) {
      resetFootprintSampling();
      return;
    }

    const current = { x: Number(position.x) || 0, z: Number(position.z) || 0 };
    const enabled = getFootprintsEnabled?.() !== false;
    if (!enabled || accumulation <= SNOW_FOOTPRINT_MIN_ACCUMULATION) {
      resetFootprintSampling(current);
      return;
    }

    if (!lastFootprintPosition) {
      resetFootprintSampling(current);
      return;
    }

    const dx = current.x - lastFootprintPosition.x;
    const dz = current.z - lastFootprintPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance > SNOW_FOOTPRINT_TELEPORT_RESET_DISTANCE) {
      resetFootprintSampling(current);
      return;
    }
    if (distance <= 1e-5) return;

    footprintDistance += distance;
    if (footprintDistance >= SNOW_FOOTPRINT_SPACING) {
      const tx = dx / distance, tz = dz / distance;
      const lx = -tz, lz = tx;
      const baseY = Number.isFinite(position.y) ? position.y - PLAYER_ORIGIN_Y : 0;
      const sideOffset = footprintSide * 0.095;
      footprints.push(Object.freeze({
        x: current.x + lx * sideOffset,
        y: baseY + FLAT_GROUND_MAX_Y + 0.0015,
        z: current.z + lz * sideOffset,
        tx,
        tz
      }));
      footprintSide *= -1;
      footprintDistance %= SNOW_FOOTPRINT_SPACING;
      rebuildFootprintTrail();
    }

    lastFootprintPosition = current;
  }

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(SNOW_FLAKE_BUDGET, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(tiers))
      entity.enabled = intensity > 0.01 && name === tier;
    const budget = snowFootprintBudget(tier);
    if (footprints.length > budget) {
      footprints = footprints.slice(-budget);
      rebuildFootprintTrail();
    }
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

    const p = getPlayerPosition?.();
    updateFootprints(p);

    if (intensity <= 0.01) return;

    phase = (phase + safeDt * SNOW_FALL_SPEED) % SNOW_VOLUME_HEIGHT;
    driftPhase = (driftPhase + safeDt * SNOW_DRIFT_SPEED) % (Math.PI * 2);

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
    const lawnGroundVertexCount = SITE_FEATURES
      .filter(feature => feature.kind === 'lawn')
      .reduce((sum, feature) => sum + feature.vertices.length, 0);
    const roadGroundVertexCount =
      (ROAD_SEGMENTS.length + GATE_DORM_SEGMENTS.length + MAIN_GATE_FORECOURT_QUADS.length) * 4;
    const flakeBudget = SNOW_FLAKE_BUDGET[currentTier] ?? SNOW_FLAKE_BUDGET.medium;
    return Object.freeze({
      graphicsTier: currentTier,
      snowIntensity: Math.max(0, intensity),
      enabled: intensity > 0.01,
      flakeBudget,
      flakeVertexCount: intensity > 0.01 ? flakeBudget * 8 : 0,
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
      groundLawnVertexCount: visibility.accumulation > 0.01 ? lawnGroundVertexCount : 0,
      groundRoadVertexCount: visibility.accumulation > 0.01 && visibility.roadEnabled
        ? roadGroundVertexCount
        : 0,
      footprintEnabled: visibility.accumulation > SNOW_FOOTPRINT_MIN_ACCUMULATION &&
        getFootprintsEnabled?.() !== false,
      footprintCount: footprints.length,
      footprintBudget: snowFootprintBudget(currentTier),
      footprintVertexCount: footprints.length * 9,
      footprintVertexBudget: snowFootprintBudget(currentTier) * 9,
      footprintOpacity: snowFootprintOpacity(currentTier, visibility.accumulation),
      footprintSpacing: SNOW_FOOTPRINT_SPACING,
      footprintDrawMeshes: footprints.length > 0 && footprintMaterial.opacity > 0 ? 1 : 0,
      footprintMeshUpdates,
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
    footprintMaterial.destroy();
  }

  return Object.freeze({ update, status, getAccumulation: () => Math.max(0, accumulation), destroy });
}
