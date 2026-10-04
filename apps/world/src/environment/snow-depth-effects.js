import * as pc from 'playcanvas';
import { ROAD_SEGMENTS } from '../campus-road-layout.js';
import { FLAT_GROUND_MAX_Y } from '../flat-ground-surface.js';
import { GATE_DORM_SEGMENTS } from '../main-gate-road-layout.js';
import { MAIN_GATE_LEVELS } from '../main-gate-terrain-layout.js';
import { snowObjectRoofSources } from './snow-object-effects.js';
import {
  SNOW_DEPTH_MIN_ACCUMULATION,
  snowDepthOpacity,
  snowDriftBudget,
  snowEdgeLipBudget,
  snowPlowOpacity,
  snowPlowTraceBudget
} from './snow-depth-policy.js';

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

function pushQuad(positions, normals, indices, a, b, c, d, normal) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(...normal);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function pushTriangle(positions, normals, indices, a, b, c) {
  const offset = positions.length / 3;
  const normal = triangleNormal(a, b, c);
  positions.push(...a, ...b, ...c);
  normals.push(...normal, ...normal, ...normal);
  indices.push(offset, offset + 1, offset + 2);
}

function roofEdgeCandidates(roofs) {
  const candidates = [];
  for (const roof of roofs) {
    const ring = roof.polygon;
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index], b = ring[(index + 1) % ring.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.8) continue;
      candidates.push(Object.freeze({
        id: `${roof.id}:edge:${index}`,
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
  return Object.freeze([
    ...ROAD_SEGMENTS.map(segment => Object.freeze({
      id: `campus:${segment.id}`,
      frame: segment.frame,
      width: segment.road.width,
      y: FLAT_GROUND_MAX_Y + 0.004
    })),
    ...GATE_DORM_SEGMENTS
      .filter(segment => segment.road.kind !== 'PATH')
      .map(segment => Object.freeze({
        id: `gate:${segment.id}`,
        frame: segment.frame,
        width: segment.road.width,
        y: MAIN_GATE_LEVELS.zebra + 0.004
      }))
  ]);
}

function pushRoofLip(positions, normals, indices, edge) {
  const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
  const length = Math.hypot(dx, dz) || 1;
  const normal = [dz / length, 0, -dx / length];
  const bottom = edge.y + 0.006;
  const top = edge.y + 0.058;
  pushQuad(
    positions, normals, indices,
    [edge.a.x, bottom, edge.a.z],
    [edge.b.x, bottom, edge.b.z],
    [edge.b.x, top, edge.b.z],
    [edge.a.x, top, edge.a.z],
    normal
  );
}

function pushSnowDrift(positions, normals, indices, road) {
  const key = road.id;
  const u = road.frame.length * (0.18 + unit(`${key}:u`) * 0.64);
  const side = unit(`${key}:side`) < 0.5 ? -1 : 1;
  const lateral = side * Math.max(0.3, road.width / 2 - 0.08);
  const center = road.frame.at(u, lateral);
  const ahead = road.frame.at(Math.min(road.frame.length, u + 0.25), lateral);
  const dx = ahead.x - center.x, dz = ahead.z - center.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length, tz = dz / length;
  const lx = -tz, lz = tx;
  const along = 0.30 + unit(`${key}:along`) * 0.16;
  const across = 0.17 + unit(`${key}:across`) * 0.09;
  const height = 0.07 + unit(`${key}:height`) * 0.08;
  const y = road.y + 0.008;

  const a = [center.x - tx * along - lx * across, y, center.z - tz * along - lz * across];
  const b = [center.x + tx * along - lx * across, y, center.z + tz * along - lz * across];
  const c = [center.x + tx * along + lx * across, y, center.z + tz * along + lz * across];
  const d = [center.x - tx * along + lx * across, y, center.z - tz * along + lz * across];
  const apex = [center.x, y + height, center.z];

  pushTriangle(positions, normals, indices, a, b, apex);
  pushTriangle(positions, normals, indices, b, c, apex);
  pushTriangle(positions, normals, indices, c, d, apex);
  pushTriangle(positions, normals, indices, d, a, apex);
}

function pushPlowTrace(positions, normals, indices, road) {
  const half = Math.max(0.22, road.width * 0.24);
  const start = road.frame.length * 0.08;
  const end = road.frame.length * 0.92;
  const a = road.frame.at(start, -half);
  const b = road.frame.at(start, half);
  const c = road.frame.at(end, half);
  const d = road.frame.at(end, -half);
  const y = road.y + 0.012;
  pushQuad(
    positions, normals, indices,
    [a.x, y, a.z],
    [b.x, y, b.z],
    [c.x, y, c.z],
    [d.x, y, d.z],
    [0, 1, 0]
  );
}

function createSnowMaterial(name, color, gloss) {
  const material = new pc.StandardMaterial();
  material.name = name;
  material.diffuse = new pc.Color(...color);
  material.specular = new pc.Color(0.14, 0.16, 0.18);
  material.gloss = gloss;
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

function createTier(root, device, snowMaterial, plowMaterial, edgeCandidates, roads, tier) {
  const snowPositions = [], snowNormals = [], snowIndices = [];
  const selectedEdges = edgeCandidates.slice(0, snowEdgeLipBudget(tier));
  for (const edge of selectedEdges)
    pushRoofLip(snowPositions, snowNormals, snowIndices, edge);

  const orderedRoads = stableOrder(roads);
  const selectedDrifts = orderedRoads.slice(0, snowDriftBudget(tier));
  for (const road of selectedDrifts)
    pushSnowDrift(snowPositions, snowNormals, snowIndices, road);

  const plowPositions = [], plowNormals = [], plowIndices = [];
  const selectedPlows = orderedRoads
    .slice(selectedDrifts.length)
    .slice(0, snowPlowTraceBudget(tier));
  for (const road of selectedPlows)
    pushPlowTrace(plowPositions, plowNormals, plowIndices, road);

  const snowEntity = createEntity(
    root, device, `environment_snow_depth_${tier}`,
    snowMaterial, snowPositions, snowNormals, snowIndices, true
  );
  const plowEntity = createEntity(
    root, device, `environment_snow_plow_${tier}`,
    plowMaterial, plowPositions, plowNormals, plowIndices, false
  );

  return Object.freeze({
    snowEntity,
    plowEntity,
    edgeLipCount: selectedEdges.length,
    driftCount: selectedDrifts.length,
    plowTraceCount: selectedPlows.length,
    snowVertexCount: snowPositions.length / 3,
    plowVertexCount: plowPositions.length / 3
  });
}

export function createSnowDepthEffects({
  root,
  app,
  getSnowAccumulation,
  getGraphicsTier
}) {
  const roofs = snowObjectRoofSources();
  const edges = roofEdgeCandidates(roofs);
  const roads = roadSources();
  const snowMaterial = createSnowMaterial(
    'environment-snow-depth-and-drifts',
    [0.93, 0.96, 0.985],
    0.16
  );
  const plowMaterial = createSnowMaterial(
    'environment-snow-plow-traces',
    [0.20, 0.23, 0.25],
    0.30
  );
  const tiers = Object.fromEntries(
    ['low', 'medium', 'high'].map(tier => [
      tier,
      createTier(root, app.graphicsDevice, snowMaterial, plowMaterial, edges, roads, tier)
    ])
  );

  let tier = null;
  let accumulation = -1;
  let depthOpacity = -1;
  let plowOpacity = -1;
  let destroyed = false;

  function syncEntities() {
    const activeTier = tier ?? 'medium';
    for (const [name, entry] of Object.entries(tiers)) {
      if (entry.snowEntity) entry.snowEntity.enabled =
        name === activeTier && depthOpacity > 0.001;
      if (entry.plowEntity) entry.plowEntity.enabled =
        name === activeTier && plowOpacity > 0.001 && entry.plowTraceCount > 0;
    }
  }

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(tiers, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    depthOpacity = snowDepthOpacity(tier, Math.max(0, accumulation));
    plowOpacity = snowPlowOpacity(tier, Math.max(0, accumulation));
    snowMaterial.opacity = depthOpacity;
    plowMaterial.opacity = plowOpacity;
    snowMaterial.update();
    plowMaterial.update();
    syncEntities();
  }

  function applyAccumulation(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    const nextDepth = snowDepthOpacity(tier ?? 'medium', safe);
    const nextPlow = snowPlowOpacity(tier ?? 'medium', safe);
    accumulation = safe;
    if (Math.abs(nextDepth - depthOpacity) < 0.004 &&
        Math.abs(nextPlow - plowOpacity) < 0.004) return;
    depthOpacity = nextDepth;
    plowOpacity = nextPlow;
    snowMaterial.opacity = depthOpacity;
    plowMaterial.opacity = plowOpacity;
    snowMaterial.update();
    plowMaterial.update();
    syncEntities();
  }

  function update() {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyAccumulation(getSnowAccumulation?.() ?? 0);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const entry = tiers[currentTier];
    const snowActive = depthOpacity > 0.001 && !!entry.snowEntity;
    const plowActive = plowOpacity > 0.001 && entry.plowTraceCount > 0 && !!entry.plowEntity;
    return Object.freeze({
      graphicsTier: currentTier,
      snowAccumulation: Math.max(0, accumulation),
      minAccumulation: SNOW_DEPTH_MIN_ACCUMULATION,
      enabled: snowActive || plowActive,
      depthOpacity: Math.max(0, depthOpacity),
      plowOpacity: Math.max(0, plowOpacity),
      roofEdgeCandidateCount: edges.length,
      edgeLipCount: entry.edgeLipCount,
      edgeLipBudget: snowEdgeLipBudget(currentTier),
      driftCount: entry.driftCount,
      driftBudget: snowDriftBudget(currentTier),
      plowTraceCount: entry.plowTraceCount,
      plowTraceBudget: snowPlowTraceBudget(currentTier),
      snowVertexCount: entry.snowVertexCount,
      plowVertexCount: entry.plowVertexCount,
      snowDrawMeshes: snowActive ? 1 : 0,
      plowDrawMeshes: plowActive ? 1 : 0,
      drawMeshes: (snowActive ? 1 : 0) + (plowActive ? 1 : 0),
      extraRealLights: 0,
      extraShadowCasters: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of Object.values(tiers)) {
      entry.snowEntity?.destroy();
      entry.plowEntity?.destroy();
    }
    snowMaterial.destroy();
    plowMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
