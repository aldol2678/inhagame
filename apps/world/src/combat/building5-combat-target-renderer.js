import * as pc from 'playcanvas';
import { box, surface } from '../campus-render-kit.js';

export function createBuilding5CombatTargetRenderer({
  app,
  parent,
  training,
  getGroundHeight = () => 0
} = {}) {
  if (!app || !parent || !training?.subscribe || !training?.snapshot) {
    throw new TypeError('Building 5 Combat target renderer dependencies required');
  }

  const root = new pc.Entity('Building5CombatTrainingTarget');
  const metal = surface('#536b7a');
  const dark = surface('#1c2d38');
  const coreMat = surface('#6fe7ff');
  const breakMat = surface('#ffd56a');
  const warnMat = surface('#ff9d55');
  const urgentMat = surface('#ff5d62');
  const impactMat = surface('#ff6f6f');
  const perfectMat = surface('#7cf4ff');

  const body = box(root, 'building5_training_drone_body', [0, 1.05, 0], [1.25, 1.8, 1.25], metal, 0, 'cylinder');
  const head = box(root, 'building5_training_drone_head', [0, 2.05, 0], [1.0, .55, 1.0], dark, 0, 'cylinder');
  const core = box(root, 'building5_training_drone_core', [0, 1.35, -.66], [.34, .34, .18], coreMat, 0, 'sphere');
  const ring = box(root, 'building5_training_drone_break_ring', [0, .24, 0], [1.5, .04, 1.5], breakMat, 0, 'cylinder');
  const telegraphBeam = box(root, 'building5_training_drone_telegraph_beam', [0, .08, 0], [.12, .025, 1], warnMat);
  const telegraphMarker = box(root, 'building5_training_drone_telegraph_marker', [0, .05, 0], [1.15, .025, 1.15], warnMat, 0, 'cylinder');
  const impactMarker = box(root, 'building5_training_drone_impact_marker', [0, .07, 0], [.9, .03, .9], impactMat, 0, 'cylinder');
  const muzzleFlash = box(root, 'building5_training_drone_muzzle_flash', [0, 1.35, -.82], [.18, .18, .18], impactMat, 0, 'sphere');
  ring.enabled = false;
  telegraphBeam.enabled = false;
  telegraphMarker.enabled = false;
  impactMarker.enabled = false;
  muzzleFlash.enabled = false;
  root.enabled = false;
  parent.addChild(root);

  let hitPulse = 0;
  let impactPulse = 0;
  let impactPerfect = false;
  let impactX = 0, impactZ = 0;
  let lastHitSerial = 0;
  let lastBreakSerial = 0;
  let lastPlayerHitSerial = 0;
  let lastEnemyAttackSerial = 0;

  const place = state => {
    const target = state?.target;
    if (!target) return;
    const ground = Number(getGroundHeight(target.x, target.z));
    root.setLocalPosition(target.x, Number.isFinite(ground) ? ground : 0, target.z);
  };

  const updateTelegraph = state => {
    const attack = state?.enemyAttack;
    const target = state?.target;
    if (!target || attack?.phase !== 'WINDUP' || !Number.isFinite(attack.aimX) || !Number.isFinite(attack.aimZ)) {
      telegraphBeam.enabled = false;
      telegraphMarker.enabled = false;
      return;
    }

    const dx = attack.aimX - target.x;
    const dz = attack.aimZ - target.z;
    const length = Math.max(.01, Math.hypot(dx, dz));
    const yaw = Math.atan2(dx, dz) * 180 / Math.PI;
    const urgent = attack.remainingMs <= 240;
    const material = urgent ? urgentMat : warnMat;
    telegraphBeam.render.material = material;
    telegraphMarker.render.material = material;
    telegraphBeam.enabled = true;
    telegraphMarker.enabled = true;
    telegraphBeam.setLocalPosition(dx / 2, .08, dz / 2);
    telegraphBeam.setLocalScale(.10 + attack.progress * .10, .025, length);
    telegraphBeam.setLocalEulerAngles(0, yaw, 0);
    telegraphMarker.setLocalPosition(dx, .05, dz);
    const markerScale = .85 + attack.progress * .55;
    telegraphMarker.setLocalScale(markerScale, .025, markerScale);
  };

  const apply = state => {
    place(state);
    root.enabled = state?.active === true;
    body.enabled = state?.active === true && !state.defeated;
    head.enabled = body.enabled;
    core.enabled = body.enabled;
    ring.enabled = body.enabled && state.broken;
    updateTelegraph(state);

    if ((state?.hitSerial ?? 0) !== lastHitSerial) {
      lastHitSerial = state.hitSerial;
      hitPulse = Math.max(hitPulse, .16);
    }
    if ((state?.breakSerial ?? 0) !== lastBreakSerial) {
      lastBreakSerial = state.breakSerial;
      hitPulse = Math.max(hitPulse, .30);
    }
    if ((state?.player?.hitSerial ?? 0) !== lastPlayerHitSerial) {
      lastPlayerHitSerial = state.player.hitSerial;
      hitPulse = Math.max(hitPulse, .12);
    }
    const attack = state?.lastEnemyAttack;
    if ((attack?.serial ?? 0) !== lastEnemyAttackSerial) {
      lastEnemyAttackSerial = attack?.serial ?? lastEnemyAttackSerial;
      impactPulse = .16;
      impactPerfect = attack?.outcome === 'PERFECT_DODGE';
      impactX = Number(attack?.aimX) || 0;
      impactZ = Number(attack?.aimZ) || 0;
    }
  };

  const unsubscribe = training.subscribe(apply, { emitCurrent: true });

  function update(dt = 0) {
    const state = training.snapshot();
    root.enabled = state.active === true;
    body.enabled = state.active === true && !state.defeated;
    head.enabled = body.enabled;
    core.enabled = body.enabled;
    ring.enabled = body.enabled && state.broken;
    updateTelegraph(state);
    if (!state.active) return;
    place(state);
    const seconds = Math.max(0, Math.min(.05, Number(dt) || 0));
    ring.rotateLocal(0, seconds * 150, 0);
    telegraphMarker.rotateLocal(0, seconds * 90, 0);
    hitPulse = Math.max(0, hitPulse - seconds);
    impactPulse = Math.max(0, impactPulse - seconds);
    const scale = state.broken ? 1.28 : hitPulse > 0 ? 1.12 : 1;
    core.setLocalScale(.34 * scale, .34 * scale, .18 * scale);
    impactMarker.enabled = impactPulse > 0;
    muzzleFlash.enabled = impactPulse > 0;
    if (impactPulse > 0) {
      const target = state.target;
      const dx = impactX - target.x, dz = impactZ - target.z;
      const p = impactPulse / .16;
      const impactScale = .65 + (1 - p) * .95;
      const material = impactPerfect ? perfectMat : impactMat;
      impactMarker.render.material = material;
      muzzleFlash.render.material = material;
      impactMarker.setLocalPosition(dx, .07, dz);
      impactMarker.setLocalScale(impactScale, .03, impactScale);
      muzzleFlash.setLocalScale(.18 + p * .24, .18 + p * .24, .18 + p * .24);
    }
  }

  return Object.freeze({
    root,
    update,
    status: () => training.snapshot(),
    destroy: () => {
      unsubscribe();
      root.destroy();
    }
  });
}
