import * as pc from 'playcanvas';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { FLAT_GROUND_MAX_Y } from '../flat-ground-surface.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import { snowObjectRoofSources } from './snow-object-effects.js';
import {
  meltwaterDrainBudget,
  meltwaterEaveBudget,
  meltwaterProfile,
  meltwaterRunoffBudget
} from './meltwater-policy.js';

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

function pushQuad(positions, normals, indices, a, b, c, d, normal = [0, 1, 0]) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(...normal);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function eaveCandidates() {
  const candidates = [];
  for (const roof of snowObjectRoofSources()) {
    const ring = roof.polygon;
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index], b = ring[(index + 1) % ring.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1.2) continue;
      candidates.push(Object.freeze({
        id: `${roof.id}:eave:${index}`,
        a,
        b,
        y: roof.y,
        length
      }));
    }
  }
  return Object.freeze(stableOrder(candidates));
}

function roadSources() {
  return Object.freeze(stableOrder([
    ...ROAD_SEGMENTS.map(segment => Object.freeze({
      id: `campus:${segment.id}`,
      frame: segment.frame,
      width: segment.road.width,
      y: FLAT_GROUND_MAX_Y + 0.022
    })),
    ...GATE_DORM_SEGMENTS
      .filter(segment => segment.road.kind !== 'PATH')
      .map(segment => Object.freeze({
        id: `gate:${segment.id}`,
        frame: segment.frame,
        width: segment.road.width,
        y: MAIN_GATE_LEVELS.zebra + 0.022
      }))
  ]));
}

function pushDrip(positions, normals, indices, edge) {
  const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length, tz = dz / length;
  const nx = -tz, nz = tx;
  const u = 0.22 + unit(`${edge.id}:u`) * 0.56;
  const cx = edge.a.x + dx * u + nx * 0.018;
  const cz = edge.a.z + dz * u + nz * 0.018;
  const halfWidth = 0.015 + unit(`${edge.id}:w`) * 0.010;
  const fall = 0.34 + unit(`${edge.id}:fall`) * 0.72;
  const top = edge.y - 0.018;
  const bottom = top - fall;
  pushQuad(
    positions,
    normals,
    indices,
    [cx - tx * halfWidth, top, cz - tz * halfWidth],
    [cx + tx * halfWidth, top, cz + tz * halfWidth],
    [cx + tx * halfWidth, bottom, cz + tz * halfWidth],
    [cx - tx * halfWidth, bottom, cz - tz * halfWidth],
    [nx, 0, nz]
  );
}

function pushRunoff(positions, normals, indices, road) {
  const key = road.id;
  const start = road.frame.length * (0.14 + unit(`${key}:start`) * 0.18);
  const span = road.frame.length * (0.24 + unit(`${key}:span`) * 0.28);
  const end = Math.min(road.frame.length * 0.90, start + span);
  if (end - start < 0.18) return;

  const side = unit(`${key}:side`) < 0.5 ? -1 : 1;
  const halfRoad = Math.max(0.30, road.width / 2);
  const inset = 0.04 + unit(`${key}:inset`) * 0.08;
  const width = 0.045 + unit(`${key}:width`) * 0.055;
  const v0 = side * (halfRoad - inset - width);
  const v1 = side * (halfRoad - inset);

  const a = road.frame.at(start, v0);
  const b = road.frame.at(start, v1);
  const c = road.frame.at(end, v1);
  const d = road.frame.at(end, v0);
  pushQuad(
    positions,
    normals,
    indices,
    [a.x, road.y, a.z],
    [b.x, road.y, b.z],
    [c.x, road.y, c.z],
    [d.x, road.y, d.z]
  );
}

function pushDrainMark(positions, normals, indices, road) {
  const key = road.id;
  const u = road.frame.length * (0.70 + unit(`${key}:drain-u`) * 0.18);
  const side = unit(`${key}:drain-side`) < 0.5 ? -1 : 1;
  const halfRoad = Math.max(0.30, road.width / 2);
  const centerV = side * (halfRoad - 0.08);
  const center = road.frame.at(u, centerV);
  const ahead = road.frame.at(Math.min(road.frame.length, u + 0.18), centerV);
  const dx = ahead.x - center.x, dz = ahead.z - center.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length, tz = dz / length;
  const lx = -tz, lz = tx;
  const halfLong = 0.12;
  const halfShort = 0.055;
  const y = road.y + 0.0015;

  pushQuad(
    positions,
    normals,
    indices,
    [center.x - tx * halfLong - lx * halfShort, y, center.z - tz * halfLong - lz * halfShort],
    [center.x + tx * halfLong - lx * halfShort, y, center.z + tz * halfLong - lz * halfShort],
    [center.x + tx * halfLong + lx * halfShort, y, center.z + tz * halfLong + lz * halfShort],
    [center.x - tx * halfLong + lx * halfShort, y, center.z - tz * halfLong + lz * halfShort]
  );
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

function createEntity(root, device, name, material, positions, normals, indices, receiveShadows) {
  if (!positions.length || !indices.length) return null;
  const mesh = pc.createMesh(device, positions, { normals, indices });
  const entity = new pc.Entity(name);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return entity;
}

function createTier(root, device, dripMaterial, runoffMaterial, eaves, roads, tier) {
  const dripPositions = [], dripNormals = [], dripIndices = [];
  const selectedEaves = eaves.slice(0, meltwaterEaveBudget(tier));
  for (const edge of selectedEaves)
    pushDrip(dripPositions, dripNormals, dripIndices, edge);

  const runoffPositions = [], runoffNormals = [], runoffIndices = [];
  const selectedRunoff = roads.slice(0, meltwaterRunoffBudget(tier));
  for (const road of selectedRunoff)
    pushRunoff(runoffPositions, runoffNormals, runoffIndices, road);

  const selectedDrains = roads
    .slice(selectedRunoff.length)
    .slice(0, meltwaterDrainBudget(tier));
  for (const road of selectedDrains)
    pushDrainMark(runoffPositions, runoffNormals, runoffIndices, road);

  return Object.freeze({
    dripEntity: createEntity(
      root, device, `environment_meltwater_drips_${tier}`,
      dripMaterial, dripPositions, dripNormals, dripIndices, false
    ),
    runoffEntity: createEntity(
      root, device, `environment_meltwater_runoff_${tier}`,
      runoffMaterial, runoffPositions, runoffNormals, runoffIndices, true
    ),
    dripCount: selectedEaves.length,
    runoffCount: selectedRunoff.length,
    drainCount: selectedDrains.length,
    dripVertexCount: dripPositions.length / 3,
    runoffVertexCount: runoffPositions.length / 3
  });
}

export function createMeltwaterEffects({
  root,
  app,
  getSnowAccumulation,
  getSnowIntensity,
  getWetnessFactor,
  getGraphicsTier
}) {
  const eaves = eaveCandidates();
  const roads = roadSources();

  const dripMaterial = createMaterial(
    'environment-meltwater-eave-drips',
    [0.46, 0.62, 0.72],
    [0.84, 0.91, 0.97],
    0.88,
    0.58
  );
  const runoffMaterial = createMaterial(
    'environment-meltwater-runoff',
    [0.17, 0.22, 0.25],
    [0.52, 0.60, 0.66],
    0.70,
    0.30
  );

  const tiers = Object.fromEntries(
    ['low', 'medium', 'high'].map(tier => [
      tier,
      createTier(root, app.graphicsDevice, dripMaterial, runoffMaterial, eaves, roads, tier)
    ])
  );

  let tier = null;
  let accumulation = 0;
  let snowIntensity = 0;
  let wetness = 0;
  let phase = 0;
  let profile = meltwaterProfile({ accumulation: 0, snowIntensity: 0, wetness: 0 });
  let destroyed = false;

  function syncEntities() {
    const activeTier = tier ?? 'medium';
    for (const [name, entry] of Object.entries(tiers)) {
      if (entry.dripEntity) entry.dripEntity.enabled =
        name === activeTier && profile.dripOpacity > 0.001 && entry.dripCount > 0;
      if (entry.runoffEntity) entry.runoffEntity.enabled =
        name === activeTier && profile.runoffOpacity > 0.001 &&
        (entry.runoffCount > 0 || entry.drainCount > 0);
    }
  }

  function update(dt = 0) {
    if (destroyed) return;
    const nextTier = getGraphicsTier?.() ?? 'medium';
    tier = Object.hasOwn(tiers, nextTier) ? nextTier : 'medium';
    accumulation = Math.min(1, Math.max(0, Number(getSnowAccumulation?.()) || 0));
    snowIntensity = Math.min(1, Math.max(0, Number(getSnowIntensity?.()) || 0));
    wetness = Math.min(1, Math.max(0, Number(getWetnessFactor?.()) || 0));
    phase = (phase + Math.max(0, Number.isFinite(dt) ? dt : 0) * 5.2) % (Math.PI * 2);

    profile = meltwaterProfile({
      accumulation,
      snowIntensity,
      wetness,
      tier
    });

    const pulse = 0.72 + Math.sin(phase) * 0.18 + Math.sin(phase * 1.73) * 0.10;
    dripMaterial.opacity = profile.dripOpacity * Math.max(0.45, pulse);
    runoffMaterial.opacity = profile.runoffOpacity;
    dripMaterial.update();
    runoffMaterial.update();
    syncEntities();
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const entry = tiers[currentTier] ?? tiers.medium;
    const dripActive = profile.dripOpacity > 0.001 && entry.dripCount > 0;
    const runoffActive = profile.runoffOpacity > 0.001 &&
      (entry.runoffCount > 0 || entry.drainCount > 0);
    return Object.freeze({
      graphicsTier: currentTier,
      snowAccumulation: accumulation,
      snowIntensity,
      wetness,
      enabled: dripActive || runoffActive,
      thawGate: profile.thawGate,
      dripFactor: profile.drip,
      runoffFactor: profile.runoff,
      dripOpacity: profile.dripOpacity,
      runoffOpacity: profile.runoffOpacity,
      dripCount: entry.dripCount,
      dripBudget: meltwaterEaveBudget(currentTier),
      runoffCount: entry.runoffCount,
      runoffBudget: meltwaterRunoffBudget(currentTier),
      drainCount: entry.drainCount,
      drainBudget: meltwaterDrainBudget(currentTier),
      dripVertexCount: entry.dripVertexCount,
      runoffVertexCount: entry.runoffVertexCount,
      dripDrawMeshes: dripActive ? 1 : 0,
      runoffDrawMeshes: runoffActive ? 1 : 0,
      drawMeshes: (dripActive ? 1 : 0) + (runoffActive ? 1 : 0),
      extraRealLights: 0,
      extraShadowCasters: 0,
      externalTextures: 0,
      networkRequests: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of Object.values(tiers)) {
      entry.dripEntity?.destroy();
      entry.runoffEntity?.destroy();
    }
    dripMaterial.destroy();
    runoffMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
