import * as pc from 'playcanvas';
import { BACK_ROADSIDE_ASSETS } from '../back-roadside-layout.js';
import { CAMPUS_NIGHT_LAMPS } from './night-campus-lamp-layout.js';
import { GAZEBO } from '../landmark-detail-layout.js';
import {
  NIGHT_LIGHT_BUDGET,
  NIGHT_LIGHT_MAX_DISTANCE,
  NIGHT_LIGHT_OMNI_RANGE,
  lampArmLayout,
  lampHeadPosition,
  lampPolePosition,
  nearestNightLampIndices,
  nightLightBudget
} from './night-street-light-policy.js';

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

function createGazeboGlowMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'inkyung-gazebo-night-glow';
  material.diffuse = new pc.Color(0.86, 0.58, 0.28);
  material.emissive = new pc.Color(1, 0.54, 0.16);
  material.emissiveIntensity = 0;
  material.useLighting = true;
  material.update();
  return material;
}

function createPoleMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'campus-night-lamp-pole';
  material.diffuse = new pc.Color(0.18, 0.20, 0.20);
  material.useLighting = true;
  material.update();
  return material;
}

function lampYaw(lamp) {
  return Number.isFinite(lamp?.frame?.yaw) ? lamp.frame.yaw : 0;
}

function normalizeLamp(item, source) {
  return Object.freeze({
    ...item,
    source: item.source ?? source,
    head: item.head ?? lampHeadPosition(item)
  });
}

function dedupeLamps(lamps, minDistance = 3.2) {
  const accepted = [];
  for (const lamp of lamps) {
    if (accepted.some(other =>
      Math.hypot(lamp.head.x - other.head.x, lamp.head.z - other.head.z) < minDistance
    )) continue;
    accepted.push(lamp);
  }
  return accepted;
}

function createGazeboLightAnchor() {
  const { center } = GAZEBO;
  return Object.freeze({
    id: 'inkyung_gazebo_warm',
    kind: 'lamp',
    source: 'inkyung-gazebo',
    sourceKind: 'gazebo',
    frame: Object.freeze({
      yaw: 0,
      at(u = 0, v = 0) { return { x: center.x + u, z: center.z + v }; }
    }),
    center: Object.freeze({ x: center.x, z: center.z }),
    head: Object.freeze({ x: center.x, y: 2.55, z: center.z }),
    height: 2.55
  });
}

function createGazeboGlowFixtures(root, material) {
  const fixtures = [];
  for (let i = 0; i < GAZEBO.ring.length; i++) {
    const post = GAZEBO.ring[i];
    const x = GAZEBO.center.x + (post.x - GAZEBO.center.x) * 0.66;
    const z = GAZEBO.center.z + (post.z - GAZEBO.center.z) * 0.66;
    const entity = new pc.Entity(`inkyung_gazebo_fixture_${i}`);
    entity.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
    entity.render.material = material;
    entity.setLocalPosition(x, 3.04, z);
    entity.setLocalScale(0.12, 0.05, 0.12);
    root.addChild(entity);
    fixtures.push(entity);
  }
  return fixtures;
}

function createBulb(root, lamp, material) {
  const head = lamp.head;
  const entity = new pc.Entity(`night_${lamp.id}_bulb`);
  entity.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
  entity.render.material = material;
  entity.setLocalPosition(head.x, head.y, head.z);
  entity.setLocalScale(0.22, 0.035, 0.38);
  entity.setLocalEulerAngles(0, lampYaw(lamp), 0);
  root.addChild(entity);
  return entity;
}

function createCampusLampProp(root, lamp, material) {
  const group = new pc.Entity(`night_${lamp.id}_prop`);
  const pole = lampPolePosition(lamp);
  const armLayout = lampArmLayout(lamp);

  const shaft = new pc.Entity(`night_${lamp.id}_shaft`);
  shaft.addComponent('render', { type: 'box', castShadows: true, receiveShadows: true });
  shaft.render.material = material;
  shaft.setLocalPosition(pole.x, lamp.height / 2, pole.z);
  shaft.setLocalScale(0.10, lamp.height, 0.10);
  group.addChild(shaft);

  const arm = new pc.Entity(`night_${lamp.id}_arm`);
  arm.addComponent('render', { type: 'box', castShadows: true, receiveShadows: true });
  arm.render.material = material;
  arm.setLocalPosition(armLayout.x, lamp.height + 0.01, armLayout.z);
  arm.setLocalScale(armLayout.length, 0.07, 0.07);
  arm.setLocalEulerAngles(0, armLayout.yaw, 0);
  group.addChild(arm);

  const hood = new pc.Entity(`night_${lamp.id}_hood`);
  hood.addComponent('render', { type: 'box', castShadows: true, receiveShadows: true });
  hood.render.material = material;
  hood.setLocalPosition(lamp.head.x, lamp.head.y + 0.06, lamp.head.z);
  hood.setLocalScale(0.32, 0.09, 0.58);
  hood.setLocalEulerAngles(0, lampYaw(lamp), 0);
  group.addChild(hood);

  root.addChild(group);
  return group;
}

function createOmni(root, index) {
  const entity = new pc.Entity(`night_street_omni_${index}`);
  entity.addComponent('light', {
    type: 'omni',
    color: new pc.Color(1, 0.80, 0.52),
    intensity: 0,
    range: NIGHT_LIGHT_OMNI_RANGE,
    castShadows: false
  });
  entity.enabled = false;
  root.addChild(entity);
  return entity;
}

export function createNightStreetLights({
  root,
  app,
  getPlayerPosition,
  getArtificialLightFactor,
  getGraphicsTier,
  rebalanceSeconds = 0.2
}) {
  const backLamps = BACK_ROADSIDE_ASSETS
    .filter(item => item.kind === 'lamp')
    .map(item => normalizeLamp(item, 'back-roadside'));
  const campusLamps = CAMPUS_NIGHT_LAMPS.map(item => normalizeLamp(item, 'campus'));
  const gazeboLamp = normalizeLamp(createGazeboLightAnchor(), 'inkyung-gazebo');
  const lamps = dedupeLamps([gazeboLamp, ...backLamps, ...campusLamps]);

  const glowMaterial = createGlowMaterial();
  const gazeboGlowMaterial = createGazeboGlowMaterial();
  const poleMaterial = createPoleMaterial();
  const campusProps = lamps
    .filter(lamp => lamp.source === 'campus')
    .map(lamp => createCampusLampProp(root, lamp, poleMaterial));
  const bulbs = lamps
    .filter(lamp => lamp.source !== 'inkyung-gazebo')
    .map(lamp => createBulb(root, lamp, glowMaterial));
  const gazeboFixtures = createGazeboGlowFixtures(root, gazeboGlowMaterial);
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
    glowMaterial.emissiveIntensity = safe * 4.6;
    glowMaterial.update();
    gazeboGlowMaterial.emissiveIntensity = safe * 5.8;
    gazeboGlowMaterial.update();
    for (const light of pool) light.light.intensity = safe * 1.05;
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
      entity.setLocalPosition(head.x, head.y - 0.30, head.z);
      entity.light.intensity = factor * 1.05;
      entity.enabled = true;
    }
  }

  function update(dt) {
    if (destroyed) return;
    applyFactor(getArtificialLightFactor?.() ?? 0);
    elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    const nextTier = getGraphicsTier?.() ?? 'medium';
    if (nextTier !== tier || elapsed >= rebalanceSeconds) {
      elapsed = 0;
      rebalance();
    }
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    return Object.freeze({
      lampCount: bulbs.length,
      logicalLightAnchorCount: lamps.length,
      backRoadsideLampCount: lamps.filter(lamp => lamp.source === 'back-roadside').length,
      campusLampCount: lamps.filter(lamp => lamp.source === 'campus').length,
      gazeboLightAnchorCount: lamps.filter(lamp => lamp.source === 'inkyung-gazebo').length,
      gazeboFixtureCount: gazeboFixtures.length,
      bulbCount: bulbs.length,
      campusPropCount: campusProps.length,
      graphicsTier: currentTier,
      dynamicBudget: nightLightBudget(currentTier),
      selectionRadius: NIGHT_LIGHT_MAX_DISTANCE,
      omniRange: NIGHT_LIGHT_OMNI_RANGE,
      activeDynamicLights: activeIndices.length,
      activeLampIndices: Object.freeze([...activeIndices]),
      artificialLightFactor: Math.max(0, factor)
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const prop of campusProps) prop.destroy();
    for (const bulb of bulbs) bulb.destroy();
    for (const fixture of gazeboFixtures) fixture.destroy();
    for (const light of pool) light.destroy();
    glowMaterial.destroy();
    gazeboGlowMaterial.destroy();
    poleMaterial.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
