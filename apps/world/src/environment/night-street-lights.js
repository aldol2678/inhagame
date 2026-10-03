import * as pc from 'playcanvas';
import { BACK_ROADSIDE_ASSETS } from '../back-roadside-layout.js';

export const NIGHT_LIGHT_BUDGET = Object.freeze({
  low: 0,
  medium: 2,
  high: 4
});

export const NIGHT_LIGHT_MAX_DISTANCE = 38;

export function nightLightBudget(tier) {
  return Object.hasOwn(NIGHT_LIGHT_BUDGET, tier) ? NIGHT_LIGHT_BUDGET[tier] : NIGHT_LIGHT_BUDGET.medium;
}

export function lampHeadPosition(lamp) {
  const p = lamp.frame.at(0, -lamp.side * 0.93);
  return Object.freeze({ x: p.x, y: lamp.height + 0.055, z: p.z });
}

export function nearestNightLampIndices(lamps, position, limit, maxDistance = NIGHT_LIGHT_MAX_DISTANCE) {
  const count = Math.max(0, Math.floor(limit));
  if (!count || !position) return [];
  const maxD2 = maxDistance * maxDistance;
  return lamps
    .map((lamp, index) => {
      const head = lamp.head ?? lampHeadPosition(lamp);
      const dx = head.x - position.x;
      const dz = head.z - position.z;
      return { index, d2: dx * dx + dz * dz };
    })
    .filter(item => item.d2 <= maxD2)
    .sort((a, b) => a.d2 - b.d2 || a.index - b.index)
    .slice(0, count)
    .map(item => item.index);
}

function createGlowMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'street-lamp-night-glow';
  material.diffuse = new pc.Color(0.78, 0.75, 0.64);
  material.emissive = new pc.Color(1, 0.82, 0.52);
  material.emissiveIntensity = 0;
  material.useLighting = true;
  material.update();
  return material;
}

function createBulb(root, lamp, material) {
  const head = lamp.head;
  const e = new pc.Entity(`night_${lamp.id}_bulb`);
  e.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
  e.render.material = material;
  e.setLocalPosition(head.x, head.y, head.z);
  e.setLocalScale(0.18, 0.025, 0.32);
  e.setLocalEulerAngles(0, lamp.frame.yaw, 0);
  root.addChild(e);
  return e;
}

function createOmni(root, index) {
  const e = new pc.Entity(`night_street_omni_${index}`);
  e.addComponent('light', {
    type: 'omni',
    color: new pc.Color(1, 0.80, 0.52),
    intensity: 0,
    range: 9.5,
    castShadows: false
  });
  e.enabled = false;
  root.addChild(e);
  return e;
}

export function createNightStreetLights({
  root,
  app,
  getPlayerPosition,
  getEnvironment,
  getGraphicsTier,
  rebalanceSeconds = 0.2
}) {
  const lamps = BACK_ROADSIDE_ASSETS
    .filter(item => item.kind === 'lamp')
    .map(item => Object.freeze({ ...item, head: lampHeadPosition(item) }));

  const material = createGlowMaterial();
  const bulbs = lamps.map(lamp => createBulb(root, lamp, material));
  const pool = Array.from({ length: NIGHT_LIGHT_BUDGET.high }, (_, i) => createOmni(root, i));

  let elapsed = rebalanceSeconds;
  let factor = -1;
  let tier = null;
  let activeIndices = [];
  let destroyed = false;

  function applyFactor(next) {
    const safe = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
    if (Math.abs(safe - factor) < 0.002) return;
    factor = safe;
    material.emissiveIntensity = safe * 3.2;
    material.update();
    for (const light of pool) light.light.intensity = safe * 0.82;
    if (safe <= 0.002) {
      activeIndices = [];
      for (const light of pool) light.enabled = false;
    }
  }

  function rebalance() {
    tier = getGraphicsTier?.() ?? 'medium';
    const budget = factor > 0.02 ? nightLightBudget(tier) : 0;
    const selected = nearestNightLampIndices(lamps, getPlayerPosition?.(), budget);
    activeIndices = selected;

    for (let i = 0; i < pool.length; i++) {
      const entity = pool[i];
      const lampIndex = selected[i];
      if (lampIndex === undefined) {
        entity.enabled = false;
        continue;
      }
      const head = lamps[lampIndex].head;
      entity.setLocalPosition(head.x, head.y - 0.28, head.z);
      entity.light.intensity = factor * 0.82;
      entity.enabled = true;
    }
  }

  function update(dt) {
    if (destroyed) return;
    const env = getEnvironment?.();
    applyFactor(env?.artificialLightFactor ?? 0);
    elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    const nextTier = getGraphicsTier?.() ?? 'medium';
    if (nextTier !== tier || elapsed >= rebalanceSeconds) {
      elapsed = 0;
      rebalance();
    }
  }

  function status() {
    return Object.freeze({
      lampCount: lamps.length,
      bulbCount: bulbs.length,
      graphicsTier: tier ?? (getGraphicsTier?.() ?? 'medium'),
      dynamicBudget: nightLightBudget(tier ?? (getGraphicsTier?.() ?? 'medium')),
      activeDynamicLights: activeIndices.length,
      activeLampIndices: Object.freeze([...activeIndices]),
      artificialLightFactor: Math.max(0, factor)
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const bulb of bulbs) bulb.destroy();
    for (const light of pool) light.destroy();
    material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
