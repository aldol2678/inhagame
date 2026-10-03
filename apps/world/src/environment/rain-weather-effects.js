import * as pc from 'playcanvas';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_FORECOURT_QUADS } from '../main-gate-forecourt.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import { FLAT_GROUND_Y } from '../flat-ground-surface.js';
import {
  RAIN_FALL_SPEED,
  RAIN_OPACITY,
  RAIN_STREAK_BUDGET,
  RAIN_VOLUME_HEIGHT,
  WET_ROAD_OPACITY,
  rainOpacity,
  rainStreakLayout,
  wetRoadOpacity
} from './rain-weather-policy.js';

function pushQuad(positions, normals, indices, a, b, c, d, normal) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(...normal);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function createRainMesh(device, tier) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (const drop of rainStreakLayout(tier)) {
    const { x, y, z, length, width, slant } = drop;
    pushQuad(
      positions, normals, indices,
      [x - width, y, z],
      [x + width, y, z],
      [x + width + slant, y - length, z],
      [x - width + slant, y - length, z],
      [0, 0, 1]
    );
    pushQuad(
      positions, normals, indices,
      [x, y, z - width],
      [x, y, z + width],
      [x + slant, y - length, z + width],
      [x + slant, y - length, z - width],
      [1, 0, 0]
    );
  }

  return pc.createMesh(device, positions, { normals, indices });
}

function createRainMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-rain-streaks';
  material.diffuse = new pc.Color(0.70, 0.82, 0.92);
  material.emissive = new pc.Color(0.34, 0.46, 0.58);
  material.emissiveIntensity = 0.35;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useLighting = false;
  material.update();
  return material;
}

function createRainTierEntity(root, device, tier, material) {
  const mesh = createRainMesh(device, tier);
  const entity = new pc.Entity(`environment_rain_${tier}`);
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

function wetRoadGeometry() {
  const positions = [];
  const normals = [];
  const indices = [];

  const addSegment = (segment, y) => {
    const h = segment.road.width / 2;
    const f = segment.frame;
    const a = f.at(0, -h);
    const b = f.at(0, h);
    const c = f.at(f.length, h);
    const d = f.at(f.length, -h);
    pushQuad(
      positions, normals, indices,
      [a.x, y, a.z], [b.x, y, b.z], [c.x, y, c.z], [d.x, y, d.z],
      [0, 1, 0]
    );
  };

  for (const segment of ROAD_SEGMENTS) addSegment(segment, FLAT_GROUND_Y.DETAIL + 0.001);

  for (const segment of GATE_DORM_SEGMENTS) {
    if (segment.road.kind === 'PATH') continue;
    addSegment(segment, MAIN_GATE_LEVELS.road + 0.002);
  }

  for (const quad of MAIN_GATE_FORECOURT_QUADS) {
    pushQuad(
      positions, normals, indices,
      ...quad.map(p => [p.x, MAIN_GATE_LEVELS.road + 0.002, p.z]),
      [0, 1, 0]
    );
  }

  return { positions, normals, indices };
}

function createWetRoadMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-wet-road-sheen';
  material.diffuse = new pc.Color(0.05, 0.07, 0.09);
  material.specular = new pc.Color(0.82, 0.88, 0.92);
  material.gloss = 0.92;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function createWetRoadEntity(root, device, material) {
  const data = wetRoadGeometry();
  const mesh = pc.createMesh(device, data.positions, { normals: data.normals, indices: data.indices });
  const entity = new pc.Entity('environment_wet_roads');
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

export function createRainWeatherEffects({
  root,
  app,
  getPlayerPosition,
  getRainIntensity,
  getWetnessFactor,
  getGraphicsTier
}) {
  const device = app.graphicsDevice;
  const rainMaterial = createRainMaterial();
  const wetMaterial = createWetRoadMaterial();
  const rainRoot = new pc.Entity('EnvironmentRainRoot');
  root.addChild(rainRoot);

  const tiers = Object.fromEntries(
    Object.keys(RAIN_STREAK_BUDGET).map(tier => [
      tier,
      createRainTierEntity(rainRoot, device, tier, rainMaterial)
    ])
  );
  const wetRoad = createWetRoadEntity(root, device, wetMaterial);

  let tier = null;
  let rain = -1;
  let wetness = -1;
  let phase = 0;
  let destroyed = false;

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(RAIN_STREAK_BUDGET, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(tiers))
      entity.enabled = rain > 0.01 && name === tier;
  }

  function applyRain(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - rain) < 0.005) return;
    rain = safe;
    rainMaterial.opacity = safe * rainOpacity(tier ?? 'medium');
    rainMaterial.update();
    rainRoot.enabled = safe > 0.01;
    if (rainRoot.enabled) {
      for (const [name, entity] of Object.entries(tiers)) entity.enabled = name === (tier ?? 'medium');
    }
  }

  function applyWetness(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - wetness) < 0.005) return;
    wetness = safe;
    wetMaterial.opacity = safe * wetRoadOpacity(tier ?? 'medium');
    wetMaterial.update();
    wetRoad.enabled = safe > 0.01;
  }

  function update(dt) {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyRain(getRainIntensity?.() ?? 0);
    applyWetness(getWetnessFactor?.() ?? 0);

    if (rain <= 0.01) return;
    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    phase = (phase + safeDt * RAIN_FALL_SPEED) % RAIN_VOLUME_HEIGHT;
    const p = getPlayerPosition?.();
    if (p) rainRoot.setLocalPosition(p.x, p.y + 8 - phase, p.z);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    return Object.freeze({
      graphicsTier: currentTier,
      rainIntensity: Math.max(0, rain),
      wetness: Math.max(0, wetness),
      rainEnabled: rain > 0.01,
      wetGroundEnabled: wetness > 0.01,
      streakBudget: RAIN_STREAK_BUDGET[currentTier] ?? RAIN_STREAK_BUDGET.medium,
      rainOpacity: Math.max(0, rain) * (RAIN_OPACITY[currentTier] ?? RAIN_OPACITY.medium),
      wetRoadOpacity: Math.max(0, wetness) * (WET_ROAD_OPACITY[currentTier] ?? WET_ROAD_OPACITY.medium),
      rainDrawMeshes: rain > 0.01 ? 1 : 0,
      wetRoadDrawMeshes: wetness > 0.01 ? 1 : 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    rainRoot.destroy();
    wetRoad.destroy();
    rainMaterial.destroy();
    wetMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
