import * as pc from 'playcanvas';
import {
  SNOW_DRIFT_SPEED,
  SNOW_FALL_SPEED,
  SNOW_FLAKE_BUDGET,
  SNOW_VOLUME_HEIGHT,
  snowFlakeLayout,
  snowOpacity
} from './snow-weather-policy.js';

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

export function createSnowWeatherEffects({
  root,
  app,
  getPlayerPosition,
  getSnowIntensity,
  getGraphicsTier
}) {
  const device = app.graphicsDevice;
  const snowRoot = new pc.Entity('EnvironmentSnowRoot');
  root.addChild(snowRoot);

  const material = createSnowMaterial();
  const tiers = Object.fromEntries(
    Object.keys(SNOW_FLAKE_BUDGET).map(tier => [
      tier,
      createSnowTier(snowRoot, device, tier, material)
    ])
  );

  let tier = null;
  let intensity = -1;
  let phase = 0;
  let driftPhase = 0;
  let destroyed = false;

  function applyTier(nextTier) {
    const resolved = Object.hasOwn(SNOW_FLAKE_BUDGET, nextTier) ? nextTier : 'medium';
    if (resolved === tier) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(tiers))
      entity.enabled = intensity > 0.01 && name === tier;
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
    if (intensity <= 0.01) return;

    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
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
    return Object.freeze({
      graphicsTier: currentTier,
      snowIntensity: Math.max(0, intensity),
      enabled: intensity > 0.01,
      flakeBudget: SNOW_FLAKE_BUDGET[currentTier] ?? SNOW_FLAKE_BUDGET.medium,
      opacity: Math.max(0, intensity) * snowOpacity(currentTier),
      drawMeshes: intensity > 0.01 ? 1 : 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    snowRoot.destroy();
    material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
