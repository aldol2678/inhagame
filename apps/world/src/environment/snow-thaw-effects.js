import * as pc from 'playcanvas';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { FLAT_GROUND_MAX_Y } from '../flat-ground-surface.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import {
  snowIceBudget,
  snowSlushBudget,
  snowThawProfile
} from './snow-thaw-policy.js';

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(value) {
  return hashString(value) / 0xffffffff;
}

function stableOrder(items) {
  return [...items].sort((a, b) =>
    hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id)
  );
}

function pushQuad(positions, normals, indices, a, b, c, d) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function roadSources() {
  return Object.freeze(stableOrder([
    ...ROAD_SEGMENTS.map(segment => Object.freeze({
      id: `campus:${segment.id}`,
      frame: segment.frame,
      width: segment.road.width,
      y: FLAT_GROUND_MAX_Y + 0.018
    })),
    ...GATE_DORM_SEGMENTS
      .filter(segment => segment.road.kind !== 'PATH')
      .map(segment => Object.freeze({
        id: `gate:${segment.id}`,
        frame: segment.frame,
        width: segment.road.width,
        y: MAIN_GATE_LEVELS.zebra + 0.018
      }))
  ]));
}

function pushSlushStrip(positions, normals, indices, road) {
  const key = road.id;
  const start = road.frame.length * (0.12 + unit(`${key}:start`) * 0.16);
  const span = road.frame.length * (0.34 + unit(`${key}:span`) * 0.32);
  const end = Math.min(road.frame.length * 0.92, start + span);
  if (end - start < 0.2) return;

  const side = unit(`${key}:side`) < 0.5 ? -1 : 1;
  const halfRoad = Math.max(0.35, road.width / 2);
  const inset = 0.10 + unit(`${key}:inset`) * 0.12;
  const stripWidth = 0.12 + unit(`${key}:width`) * 0.15;
  const v0 = side * (halfRoad - inset - stripWidth);
  const v1 = side * (halfRoad - inset);

  const a = road.frame.at(start, v0);
  const b = road.frame.at(start, v1);
  const c = road.frame.at(end, v1);
  const d = road.frame.at(end, v0);
  pushQuad(
    positions, normals, indices,
    [a.x, road.y, a.z],
    [b.x, road.y, b.z],
    [c.x, road.y, c.z],
    [d.x, road.y, d.z]
  );
}

function pushIcePatch(positions, normals, indices, road) {
  const key = road.id;
  const u = road.frame.length * (0.20 + unit(`${key}:u`) * 0.60);
  const lateral = (unit(`${key}:lateral`) - 0.5) * Math.max(0.2, road.width * 0.28);
  const center = road.frame.at(u, lateral);
  const a = road.frame.at(Math.max(0, u - 0.22), lateral);
  const b = road.frame.at(Math.min(road.frame.length, u + 0.22), lateral);
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length, tz = dz / length;
  const lx = -tz, lz = tx;
  const longRadius = 0.28 + unit(`${key}:long`) * 0.34;
  const shortRadius = 0.12 + unit(`${key}:short`) * 0.14;
  const segments = 10;
  const centerIndex = positions.length / 3;

  positions.push(center.x, road.y + 0.0015, center.z);
  normals.push(0, 1, 0);

  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const along = Math.cos(angle) * longRadius;
    const across = Math.sin(angle) * shortRadius;
    positions.push(
      center.x + tx * along + lx * across,
      road.y + 0.0015,
      center.z + tz * along + lz * across
    );
    normals.push(0, 1, 0);
  }

  for (let i = 0; i < segments; i++) {
    const current = centerIndex + 1 + i;
    const next = centerIndex + 1 + ((i + 1) % segments);
    indices.push(centerIndex, current, next);
  }
}

function createMaterial(name, diffuse, specular, gloss, reflectivity = 0) {
  const material = new pc.StandardMaterial();
  material.name = name;
  material.diffuse = new pc.Color(...diffuse);
  material.specular = new pc.Color(...specular);
  material.gloss = gloss;
  material.reflectivity = reflectivity;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useFog = true;
  material.update();
  return material;
}

function createEntity(root, device, name, material, positions, normals, indices) {
  if (!positions.length || !indices.length) return null;
  const mesh = pc.createMesh(device, positions, { normals, indices });
  const entity = new pc.Entity(name);
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

function createTier(root, device, slushMaterial, iceMaterial, roads, tier) {
  const slushPositions = [], slushNormals = [], slushIndices = [];
  const selectedSlush = roads.slice(0, snowSlushBudget(tier));
  for (const road of selectedSlush)
    pushSlushStrip(slushPositions, slushNormals, slushIndices, road);

  const icePositions = [], iceNormals = [], iceIndices = [];
  const selectedIce = roads
    .slice(selectedSlush.length)
    .slice(0, snowIceBudget(tier));
  for (const road of selectedIce)
    pushIcePatch(icePositions, iceNormals, iceIndices, road);

  return Object.freeze({
    slushEntity: createEntity(
      root, device, `environment_snow_slush_${tier}`,
      slushMaterial, slushPositions, slushNormals, slushIndices
    ),
    iceEntity: createEntity(
      root, device, `environment_snow_ice_${tier}`,
      iceMaterial, icePositions, iceNormals, iceIndices
    ),
    slushCount: selectedSlush.length,
    iceCount: selectedIce.length,
    slushVertexCount: slushPositions.length / 3,
    iceVertexCount: icePositions.length / 3
  });
}

export function createSnowThawEffects({
  root,
  app,
  getSnowAccumulation,
  getSnowIntensity,
  getWetnessFactor,
  getGraphicsTier
}) {
  const roads = roadSources();
  const slushMaterial = createMaterial(
    'environment-snow-slush',
    [0.25, 0.29, 0.31],
    [0.42, 0.46, 0.50],
    0.56,
    0.18
  );
  const iceMaterial = createMaterial(
    'environment-snow-thin-ice',
    [0.52, 0.63, 0.70],
    [0.88, 0.93, 0.98],
    0.94,
    0.72
  );

  const tiers = Object.fromEntries(
    ['low', 'medium', 'high'].map(tier => [
      tier,
      createTier(root, app.graphicsDevice, slushMaterial, iceMaterial, roads, tier)
    ])
  );

  let tier = null;
  let accumulation = 0;
  let snowIntensity = 0;
  let wetness = 0;
  let profile = snowThawProfile({ accumulation: 0, snowIntensity: 0, wetness: 0 });
  let destroyed = false;

  function syncEntities() {
    const activeTier = tier ?? 'medium';
    for (const [name, entry] of Object.entries(tiers)) {
      if (entry.slushEntity) entry.slushEntity.enabled =
        name === activeTier && profile.slushOpacity > 0.001 && entry.slushCount > 0;
      if (entry.iceEntity) entry.iceEntity.enabled =
        name === activeTier && profile.iceOpacity > 0.001 && entry.iceCount > 0;
    }
  }

  function update() {
    if (destroyed) return;
    tier = Object.hasOwn(tiers, getGraphicsTier?.() ?? 'medium')
      ? getGraphicsTier()
      : 'medium';
    accumulation = Math.min(1, Math.max(0, Number(getSnowAccumulation?.()) || 0));
    snowIntensity = Math.min(1, Math.max(0, Number(getSnowIntensity?.()) || 0));
    wetness = Math.min(1, Math.max(0, Number(getWetnessFactor?.()) || 0));

    profile = snowThawProfile({
      accumulation,
      snowIntensity,
      wetness,
      tier
    });
    slushMaterial.opacity = profile.slushOpacity;
    iceMaterial.opacity = profile.iceOpacity;
    slushMaterial.update();
    iceMaterial.update();
    syncEntities();
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const entry = tiers[currentTier] ?? tiers.medium;
    const slushActive = profile.slushOpacity > 0.001 && entry.slushCount > 0;
    const iceActive = profile.iceOpacity > 0.001 && entry.iceCount > 0;
    return Object.freeze({
      graphicsTier: currentTier,
      snowAccumulation: accumulation,
      snowIntensity,
      wetness,
      enabled: slushActive || iceActive,
      thawGate: profile.thawGate,
      slushFactor: profile.slush,
      iceFactor: profile.ice,
      slushOpacity: profile.slushOpacity,
      iceOpacity: profile.iceOpacity,
      slushCount: entry.slushCount,
      slushBudget: snowSlushBudget(currentTier),
      iceCount: entry.iceCount,
      iceBudget: snowIceBudget(currentTier),
      slushVertexCount: entry.slushVertexCount,
      iceVertexCount: entry.iceVertexCount,
      slushDrawMeshes: slushActive ? 1 : 0,
      iceDrawMeshes: iceActive ? 1 : 0,
      drawMeshes: (slushActive ? 1 : 0) + (iceActive ? 1 : 0),
      extraRealLights: 0,
      extraShadowCasters: 0,
      externalTextures: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of Object.values(tiers)) {
      entry.slushEntity?.destroy();
      entry.iceEntity?.destroy();
    }
    slushMaterial.destroy();
    iceMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
