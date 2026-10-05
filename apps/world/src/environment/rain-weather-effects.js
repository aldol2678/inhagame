import * as pc from 'playcanvas';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_FORECOURT_QUADS } from '../main-gate-forecourt.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import { FLAT_GROUND_Y } from '../flat-ground-surface.js';
import { pondWaterMaterial } from '../pond-water.js';
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
import {
  RAIN_PUDDLE_BUDGET,
  RAIN_PUDDLE_OPACITY,
  RAIN_SPLASH_GROUPS,
  RAIN_SPLASH_MARKS,
  RAIN_SPLASH_OPACITY,
  rainGroundVisibility,
  rainPuddleLayout,
  rainPuddleOpacity,
  rainSplashGroups,
  rainSplashLayout,
  rainSplashOpacity
} from './rain-ground-policy.js';

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

function pushSplashRing(positions, normals, indices, mark) {
  const segments = 8;
  const outer = mark.radius;
  const inner = outer * 0.54;
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * Math.PI * 2;
    const a1 = (i + 1) / segments * Math.PI * 2;
    const ringPoint = (angle, radius) => [
      mark.x + Math.cos(angle) * radius,
      0,
      mark.z + Math.sin(angle) * radius * mark.squash
    ];
    pushQuad(
      positions, normals, indices,
      ringPoint(a0, inner),
      ringPoint(a0, outer),
      ringPoint(a1, outer),
      ringPoint(a1, inner),
      [0, 1, 0]
    );
  }
}

function createSplashMaterial(tier, groupIndex) {
  const material = new pc.StandardMaterial();
  material.name = `environment-rain-splash-${tier}-${groupIndex}`;
  material.diffuse = new pc.Color(0.55, 0.70, 0.80);
  material.emissive = new pc.Color(0.34, 0.48, 0.58);
  material.emissiveIntensity = 0.46;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useLighting = false;
  material.update();
  return material;
}

function createSplashTier(root, device, tier) {
  const tierRoot = new pc.Entity(`environment_rain_splashes_${tier}`);
  tierRoot.enabled = false;
  root.addChild(tierRoot);
  const groups = [];

  for (let groupIndex = 0; groupIndex < rainSplashGroups(tier); groupIndex++) {
    const positions = [], normals = [], indices = [];
    const layout = rainSplashLayout(tier, groupIndex);
    for (const mark of layout) pushSplashRing(positions, normals, indices, mark);
    const mesh = pc.createMesh(device, positions, { normals, indices });
    const material = createSplashMaterial(tier, groupIndex);
    const entity = new pc.Entity(`environment_rain_splash_${tier}_${groupIndex}`);
    entity.addComponent('render', {
      type: 'asset',
      castShadows: false,
      receiveShadows: false,
      meshInstances: [new pc.MeshInstance(mesh, material)]
    });
    tierRoot.addChild(entity);
    entity.on('destroy', () => mesh.destroy());
    groups.push({ entity, material, markCount: layout.length });
  }

  return { entity: tierRoot, groups };
}

function puddleSegments() {
  return [
    ...ROAD_SEGMENTS.map(segment => ({
      id: `campus:${segment.id}`,
      length: segment.frame.length,
      width: segment.road.width,
      y: FLAT_GROUND_Y.DETAIL + 0.006,
      at: (u, v) => segment.frame.at(u, v)
    })),
    ...GATE_DORM_SEGMENTS
      .filter(segment => segment.road.kind !== 'PATH')
      .map(segment => ({
        id: `gate:${segment.id}`,
        length: segment.frame.length,
        width: segment.road.width,
        y: MAIN_GATE_LEVELS.road + 0.008,
        at: (u, v) => segment.frame.at(u, v)
      }))
  ];
}

function pushPuddle(positions, normals, uvs, indices, puddle) {
  const segments = 12;
  const jitter = puddle.rotationJitter;
  const c = Math.cos(jitter), s = Math.sin(jitter);
  const tx = puddle.tx * c - puddle.tz * s;
  const tz = puddle.tx * s + puddle.tz * c;
  const nx = -tz, nz = tx;
  const centerIndex = positions.length / 3;
  positions.push(puddle.x, puddle.y, puddle.z);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);

  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const along = Math.cos(angle) * puddle.radiusLong;
    const across = Math.sin(angle) * puddle.radiusShort;
    positions.push(
      puddle.x + tx * along + nx * across,
      puddle.y,
      puddle.z + tz * along + nz * across
    );
    normals.push(0, 1, 0);
    uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
  }

  for (let i = 0; i < segments; i++)
    indices.push(centerIndex, centerIndex + 1 + i, centerIndex + 2 + i);
}

function createPuddleMaterial(device) {
  const material = pondWaterMaterial(device, 0.72, 'rain-puddle-source').clone();
  material.name = 'environment-rain-puddles';
  material.diffuse = new pc.Color(0.055, 0.075, 0.09);
  material.specular = new pc.Color(0.78, 0.84, 0.90);
  material.gloss = 0.95;
  material.reflectivity = 0.78;
  material.bumpiness = 0.18;
  material.normalMapTiling.set(1.8, 1.8);
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function createPuddleTier(root, device, material, segments, tier) {
  const layout = rainPuddleLayout(segments, tier);
  const positions = [], normals = [], uvs = [], indices = [];
  for (const puddle of layout) pushPuddle(positions, normals, uvs, indices, puddle);
  const mesh = pc.createMesh(device, positions, { normals, uvs, indices });
  const entity = new pc.Entity(`environment_rain_puddles_${tier}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: true,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return { entity, count: layout.length };
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
  const puddleMaterial = createPuddleMaterial(device);
  const rainRoot = new pc.Entity('EnvironmentRainRoot');
  const splashRoot = new pc.Entity('EnvironmentRainSplashRoot');
  root.addChild(rainRoot);
  root.addChild(splashRoot);

  const tiers = Object.fromEntries(
    Object.keys(RAIN_STREAK_BUDGET).map(tier => [
      tier,
      createRainTierEntity(rainRoot, device, tier, rainMaterial)
    ])
  );
  const splashTiers = Object.fromEntries(
    Object.keys(RAIN_SPLASH_GROUPS).map(tier => [
      tier,
      createSplashTier(splashRoot, device, tier)
    ])
  );
  const wetRoad = createWetRoadEntity(root, device, wetMaterial);
  const roadSegments = puddleSegments();
  const puddleTiers = Object.fromEntries(
    Object.keys(RAIN_PUDDLE_BUDGET).map(tier => [
      tier,
      createPuddleTier(root, device, puddleMaterial, roadSegments, tier)
    ])
  );

  let tier = null;
  let rain = -1;
  let wetness = -1;
  let phase = 0;
  let splashClock = 0;
  let splashAccumulator = 0;
  let destroyed = false;

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(RAIN_STREAK_BUDGET, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(tiers))
      entity.enabled = rain > 0.01 && name === tier;
    for (const [name, entry] of Object.entries(splashTiers))
      entry.entity.enabled = rain > 0.02 && name === tier;
    for (const [name, entry] of Object.entries(puddleTiers))
      entry.entity.enabled = wetness > 0.02 && name === tier;

    // A graphics-tier change must immediately adopt the tier's opacity policy
    // even when the weather scalar itself did not change this frame.
    if (rain >= 0) {
      rainMaterial.opacity = rain * rainOpacity(tier);
      rainMaterial.update();
    }
    if (wetness >= 0) {
      wetMaterial.opacity = wetness * wetRoadOpacity(tier);
      const visibility = rainGroundVisibility(rain, wetness);
      puddleMaterial.opacity = visibility.puddle * rainPuddleOpacity(tier);
      wetMaterial.update();
      puddleMaterial.update();
    }
  }

  function applyRain(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - rain) < 0.005) return;
    rain = safe;
    rainMaterial.opacity = safe * rainOpacity(tier ?? 'medium');
    rainMaterial.update();
    rainRoot.enabled = safe > 0.01;
    splashRoot.enabled = safe > 0.02;
    if (rainRoot.enabled) {
      for (const [name, entity] of Object.entries(tiers)) entity.enabled = name === (tier ?? 'medium');
    }
    for (const [name, entry] of Object.entries(splashTiers))
      entry.entity.enabled = splashRoot.enabled && name === (tier ?? 'medium');
  }

  function applyWetness(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - wetness) < 0.005) return;
    wetness = safe;
    const activeTier = tier ?? 'medium';
    const visibility = rainGroundVisibility(rain, safe);
    wetMaterial.opacity = safe * wetRoadOpacity(activeTier);
    wetMaterial.update();
    wetRoad.enabled = safe > 0.01;
    puddleMaterial.opacity = visibility.puddle * rainPuddleOpacity(activeTier);
    puddleMaterial.update();
    for (const [name, entry] of Object.entries(puddleTiers))
      entry.entity.enabled = safe > 0.02 && name === activeTier;
  }

  function updateSplashes(dt) {
    if (rain <= 0.02) return;
    splashAccumulator += dt;
    if (splashAccumulator < 0.05) return;
    const step = splashAccumulator;
    splashAccumulator = 0;
    splashClock = (splashClock + step * 1.9) % 1;

    const activeTier = tier ?? 'medium';
    const groups = splashTiers[activeTier].groups;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const phaseOffset = index / Math.max(1, groups.length);
      const localPhase = (splashClock + phaseOffset) % 1;
      const pulse = Math.pow(1 - localPhase, 1.65);
      group.material.opacity = rain * rainSplashOpacity(activeTier) * pulse;
      group.material.emissiveIntensity = 0.34 + pulse * 0.38;
      group.material.update();
      group.entity.setLocalPosition(0, localPhase * 0.012, 0);
    }
  }

  function update(dt) {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyRain(getRainIntensity?.() ?? 0);
    applyWetness(getWetnessFactor?.() ?? 0);

    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const p = getPlayerPosition?.();
    if (p) splashRoot.setLocalPosition(p.x, p.y + 0.035, p.z);
    updateSplashes(safeDt);

    if (rain <= 0.01) return;
    phase = (phase + safeDt * RAIN_FALL_SPEED) % RAIN_VOLUME_HEIGHT;
    if (p) rainRoot.setLocalPosition(p.x, p.y + 8 - phase, p.z);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const visibility = rainGroundVisibility(rain, wetness);
    const splashGroups = rainSplashGroups(currentTier);
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
      wetRoadDrawMeshes: wetness > 0.01 ? 1 : 0,
      splashEnabled: rain > 0.02,
      splashGroups,
      splashMarksPerGroup: RAIN_SPLASH_MARKS[currentTier] ?? RAIN_SPLASH_MARKS.medium,
      splashOpacity: visibility.splash * (RAIN_SPLASH_OPACITY[currentTier] ?? RAIN_SPLASH_OPACITY.medium),
      splashDrawMeshes: rain > 0.02 ? splashGroups : 0,
      puddleEnabled: wetness > 0.02,
      puddleCount: puddleTiers[currentTier].count,
      puddleBudget: RAIN_PUDDLE_BUDGET[currentTier],
      puddleOpacity: visibility.puddle * (RAIN_PUDDLE_OPACITY[currentTier] ?? RAIN_PUDDLE_OPACITY.medium),
      puddleReflectivity: 0.78,
      puddleDrawMeshes: wetness > 0.02 ? 1 : 0,
      extraRealLights: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    rainRoot.destroy();
    splashRoot.destroy();
    wetRoad.destroy();
    for (const entry of Object.values(puddleTiers)) entry.entity.destroy();
    rainMaterial.destroy();
    wetMaterial.destroy();
    puddleMaterial.destroy();
    for (const splashTier of Object.values(splashTiers))
      for (const group of splashTier.groups) group.material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
