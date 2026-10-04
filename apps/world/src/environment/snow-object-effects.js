import * as pc from 'playcanvas';
import { BUILDINGS } from '../basic-campus.js';
import { BACK_FURNITURE, BACK_BENCH_SEAT } from '../back-furniture-layout.js';
import { BACK_ROADSIDE_ASSETS } from '../back-roadside-layout.js';
import { FACILITIES, towerParts } from '../campus-facilities.js';
import { triangulatePolygon } from '../reality-adapter.js';
import { lampHeadPosition } from './night-street-light-policy.js';
import {
  SNOW_OBJECT_MIN_ACCUMULATION,
  snowObjectBenchBudget,
  snowObjectLampBudget,
  snowObjectOpacity
} from './snow-object-policy.js';

function pushQuad(positions, normals, indices, a, b, c, d) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
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

function frameRect(frame, centerU, centerV, halfU, halfV, y) {
  const a = frame.at(centerU - halfU, centerV - halfV);
  const b = frame.at(centerU + halfU, centerV - halfV);
  const c = frame.at(centerU + halfU, centerV + halfV);
  const d = frame.at(centerU - halfU, centerV + halfV);
  return [
    [a.x, y, a.z],
    [b.x, y, b.z],
    [c.x, y, c.z],
    [d.x, y, d.z]
  ];
}

function stableOrder(items) {
  const hash = value => {
    let out = 2166136261;
    for (const char of String(value)) {
      out ^= char.charCodeAt(0);
      out = Math.imul(out, 16777619);
    }
    return out >>> 0;
  };
  return [...items].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
}

function roofSources() {
  const result = [];
  const facilityIds = new Set();

  for (const facility of FACILITIES) {
    if (facility.kind !== 'building') continue;
    facilityIds.add(facility.id);
    const height = Math.max(0, Number(facility.height) || 0);
    for (let index = 0; index < facility.parts.length; index++) {
      const polygon = facility.parts[index];
      if (polygon?.length >= 3) result.push({
        id: `${facility.id}:roof:${index}`,
        polygon,
        y: height + 0.014
      });
    }
    for (const tower of towerParts(facility)) {
      if (tower.vertices?.length >= 3) result.push({
        id: `${tower.id}:roof`,
        polygon: tower.vertices,
        y: tower.height + 0.014
      });
    }
  }

  for (const building of BUILDINGS) {
    if (facilityIds.has(building.id) || building.vertices?.length < 3) continue;
    result.push({
      id: `${building.id}:roof`,
      polygon: building.vertices,
      y: building.height + 0.014
    });
  }

  return Object.freeze(result);
}

function benchSources() {
  return Object.freeze(stableOrder(
    BACK_FURNITURE.filter(item => item.kind === 'bench').map(item => ({
      id: item.id,
      frame: item.frame,
      y: BACK_BENCH_SEAT.centerY + BACK_BENCH_SEAT.slatHeight / 2 + 0.006
    }))
  ));
}

function lampSources() {
  return Object.freeze(stableOrder(
    BACK_ROADSIDE_ASSETS.filter(item => item.kind === 'lamp').map(item => ({
      id: item.id,
      item,
      head: lampHeadPosition(item)
    }))
  ));
}

function createMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-snow-object-caps';
  material.diffuse = new pc.Color(0.94, 0.965, 0.99);
  material.specular = new pc.Color(0.16, 0.18, 0.21);
  material.gloss = 0.18;
  material.opacity = 0;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useFog = true;
  material.update();
  return material;
}

function createTierEntity(root, device, material, roofs, benches, lamps, tier) {
  const positions = [], normals = [], indices = [];
  for (const roof of roofs) pushPolygon(positions, normals, indices, roof.polygon, roof.y);

  const selectedBenches = benches.slice(0, snowObjectBenchBudget(tier));
  for (const bench of selectedBenches) {
    pushQuad(
      positions, normals, indices,
      ...frameRect(bench.frame, 0, 0, 0.55, 0.20, bench.y)
    );
  }

  const selectedLamps = lamps.slice(0, snowObjectLampBudget(tier));
  for (const lamp of selectedLamps) {
    const centerV = -lamp.item.side * 0.93;
    pushQuad(
      positions, normals, indices,
      ...frameRect(lamp.item.frame, 0, centerV, 0.11, 0.18, lamp.head.y + 0.018)
    );
  }

  const mesh = pc.createMesh(device, positions, { normals, indices });
  const entity = new pc.Entity(`environment_snow_objects_${tier}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: true,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());

  return Object.freeze({
    entity,
    roofSurfaceCount: roofs.length,
    benchSurfaceCount: selectedBenches.length,
    lampSurfaceCount: selectedLamps.length,
    vertexCount: positions.length / 3,
    indexCount: indices.length
  });
}

export function createSnowObjectEffects({
  root,
  app,
  getSnowAccumulation,
  getGraphicsTier
}) {
  const roofs = roofSources();
  const benches = benchSources();
  const lamps = lampSources();
  const material = createMaterial();
  const tiers = Object.fromEntries(
    ['low', 'medium', 'high'].map(tier => [
      tier,
      createTierEntity(root, app.graphicsDevice, material, roofs, benches, lamps, tier)
    ])
  );

  let tier = null;
  let accumulation = -1;
  let opacity = -1;
  let destroyed = false;

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(tiers, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entry] of Object.entries(tiers))
      entry.entity.enabled = opacity > 0.001 && name === tier;
  }

  function applyAccumulation(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    const nextOpacity = snowObjectOpacity(tier ?? 'medium', safe);
    accumulation = safe;
    if (Math.abs(nextOpacity - opacity) < 0.004) return;
    opacity = nextOpacity;
    material.opacity = nextOpacity;
    material.update();
    for (const [name, entry] of Object.entries(tiers))
      entry.entity.enabled = nextOpacity > 0.001 && name === (tier ?? 'medium');
  }

  function update() {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyAccumulation(getSnowAccumulation?.() ?? 0);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const entry = tiers[currentTier];
    return Object.freeze({
      graphicsTier: currentTier,
      snowAccumulation: Math.max(0, accumulation),
      enabled: opacity > 0.001,
      opacity: Math.max(0, opacity),
      minAccumulation: SNOW_OBJECT_MIN_ACCUMULATION,
      roofSurfaceCount: entry.roofSurfaceCount,
      benchSurfaceCount: entry.benchSurfaceCount,
      benchBudget: snowObjectBenchBudget(currentTier),
      availableBenchCount: benches.length,
      lampSurfaceCount: entry.lampSurfaceCount,
      lampBudget: snowObjectLampBudget(currentTier),
      availableLampCount: lamps.length,
      totalSurfaceCount: entry.roofSurfaceCount + entry.benchSurfaceCount + entry.lampSurfaceCount,
      drawMeshes: opacity > 0.001 ? 1 : 0,
      vertexCount: entry.vertexCount,
      indexCount: entry.indexCount,
      extraRealLights: 0,
      extraShadowCasters: 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of Object.values(tiers)) entry.entity.destroy();
    material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
