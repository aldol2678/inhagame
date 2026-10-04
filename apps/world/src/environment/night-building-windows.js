import * as pc from 'playcanvas';
import { FACILITIES } from '../campus-facilities.js';
import { BUILDINGS } from '../basic-campus.js';
import {
  NIGHT_WINDOW_COLORS,
  NIGHT_WINDOW_TIER_POLICY,
  nightWindowGlowFactor,
  nightWindowLayout
} from './night-window-policy.js';

function windowSources() {
  const map = new Map();
  for (const facility of FACILITIES) {
    if (facility.kind !== 'building') continue;
    map.set(facility.id, {
      id: facility.id,
      rings: facility.rings,
      height: facility.height,
      floors: facility.floors
    });
  }
  for (const building of BUILDINGS) {
    map.set(building.id, {
      id: building.id,
      rings: [building.vertices],
      height: building.height
    });
  }
  return [...map.values()];
}

function createWindowMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-night-building-windows';
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveVertexColor = true;
  material.emissiveVertexColorChannel = 'rgb';
  material.emissiveIntensity = 1.7;
  material.opacity = 0;
  material.useLighting = false;
  material.useFog = true;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function pushWindow(positions, normals, colors, indices, window) {
  const halfW = window.width / 2;
  const halfH = window.height / 2;
  const x0 = window.x - window.tx * halfW;
  const z0 = window.z - window.tz * halfW;
  const x1 = window.x + window.tx * halfW;
  const z1 = window.z + window.tz * halfW;
  const color = NIGHT_WINDOW_COLORS[window.tone] ?? NIGHT_WINDOW_COLORS.warm;
  const base = positions.length / 3;

  positions.push(
    x0, window.y - halfH, z0,
    x1, window.y - halfH, z1,
    x1, window.y + halfH, z1,
    x0, window.y + halfH, z0
  );
  for (let i = 0; i < 4; i++) {
    normals.push(window.nx, 0, window.nz);
    colors.push(color[0], color[1], color[2], 1);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function createTierEntity(root, device, material, buildings, tier) {
  const layout = nightWindowLayout(buildings, tier);
  const positions = [], normals = [], colors = [], indices = [];
  for (const window of layout) pushWindow(positions, normals, colors, indices, window);

  const mesh = pc.createMesh(device, positions, { normals, colors, indices });
  const entity = new pc.Entity(`environment_night_windows_${tier}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return { entity, count: layout.length };
}

export function createNightBuildingWindows({
  root,
  app,
  getArtificialLightFactor,
  getGraphicsTier
}) {
  const buildings = windowSources();
  const material = createWindowMaterial();
  const tiers = Object.fromEntries(
    Object.keys(NIGHT_WINDOW_TIER_POLICY).map(tier => [
      tier,
      createTierEntity(root, app.graphicsDevice, material, buildings, tier)
    ])
  );

  let tier = null;
  let glow = -1;
  let destroyed = false;

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(tiers, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entry] of Object.entries(tiers))
      entry.entity.enabled = glow > 0.01 && name === tier;
  }

  function applyGlow(nextFactor) {
    const next = nightWindowGlowFactor(nextFactor);
    if (Math.abs(next - glow) < 0.004) return;
    glow = next;
    material.opacity = next * 0.94;
    material.emissiveIntensity = 1.4 + next * 1.9;
    material.update();
    for (const [name, entry] of Object.entries(tiers))
      entry.entity.enabled = next > 0.01 && name === (tier ?? 'medium');
  }

  function update() {
    if (destroyed) return;
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyGlow(getArtificialLightFactor?.() ?? 0);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const entry = tiers[currentTier];
    return Object.freeze({
      graphicsTier: currentTier,
      buildingCount: buildings.length,
      litWindowCount: entry.count,
      maxWindowBudget: NIGHT_WINDOW_TIER_POLICY[currentTier].maxWindows,
      glowFactor: Math.max(0, glow),
      enabled: glow > 0.01,
      drawMeshes: glow > 0.01 ? 1 : 0,
      realLights: 0
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
