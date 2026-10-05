import * as pc from 'playcanvas';
import { box, surface } from '../campus-render-kit.js';
import {
  advanceDuckFollowState,
  createDuckFollowState,
  isActiveDuckCompanion
} from './duck-companion-follow-state.js';

function createDuckVisual(parent) {
  const root = new pc.Entity('ActiveDuckCompanion');
  parent.addChild(root);

  const white = surface('#f4f2e8');
  const orange = surface('#e7a14b');
  const dark = surface('#2c2d2d');

  box(root, 'companion_duck_body', [0, .14, 0], [.42, .23, .29], white, 0, 'sphere');
  box(root, 'companion_duck_neck', [0, .22, .17], [.13, .22, .13], white, 0, 'sphere');
  const head = box(root, 'companion_duck_head', [0, .32, .24], [.18, .18, .18], white, 0, 'sphere');
  box(root, 'companion_duck_beak', [0, .30, .35], [.12, .055, .11], orange);
  const leftWing = box(root, 'companion_duck_wing_l', [-.16, .18, -.01], [.08, .055, .23], white, 0, 'sphere');
  const rightWing = box(root, 'companion_duck_wing_r', [.16, .18, -.01], [.08, .055, .23], white, 0, 'sphere');
  box(root, 'companion_duck_eye_l', [-.07, .36, .31], [.025, .025, .025], dark, 0, 'sphere');
  box(root, 'companion_duck_eye_r', [.07, .36, .31], [.025, .025, .025], dark, 0, 'sphere');

  return { root, head, wings: [leftWing, rightWing] };
}

export function createDuckCompanionFollow({
  root,
  player,
  getSnapshot = () => null,
  getGroundHeight = () => 0,
  getVisible = () => true
} = {}) {
  if (!root || !player) throw new Error('Duck Companion Follow requires root and player');

  const visual = createDuckVisual(root);
  visual.root.enabled = false;

  let state = null;
  let elapsed = 0;
  let wasVisible = false;
  let yaw = 0;

  function resetNearPlayer() {
    const pos = player.getLocalPosition();
    state = createDuckFollowState({ x: pos.x, z: pos.z });
    const y = Number(getGroundHeight(state.x, state.z)) || 0;
    visual.root.setLocalPosition(state.x, y + 0.02, state.z);
    yaw = Math.atan2(state.headingX, state.headingZ) * 180 / Math.PI;
    visual.root.setLocalEulerAngles(0, yaw, 0);
  }

  return Object.freeze({
    update(dt) {
      const snapshot = getSnapshot?.();
      const visible = getVisible?.() !== false && isActiveDuckCompanion(snapshot);
      visual.root.enabled = visible;

      if (!visible) {
        wasVisible = false;
        return false;
      }

      if (!state || !wasVisible) resetNearPlayer();
      wasVisible = true;

      const pos = player.getLocalPosition();
      advanceDuckFollowState(state, {
        player: { x: pos.x, z: pos.z },
        dt
      });

      if (state.moving) {
        const dx = state.x - visual.root.getLocalPosition().x;
        const dz = state.z - visual.root.getLocalPosition().z;
        if (Math.hypot(dx, dz) > 0.001) yaw = Math.atan2(dx, dz) * 180 / Math.PI;
      }

      elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
      const y = (Number(getGroundHeight(state.x, state.z)) || 0) + 0.02;
      const bob = state.moving ? Math.abs(Math.sin(elapsed * 9)) * 0.035 : Math.sin(elapsed * 2.1) * 0.008;
      visual.root.setLocalPosition(state.x, y + bob, state.z);
      visual.root.setLocalEulerAngles(0, yaw, 0);

      const flap = state.moving ? Math.sin(elapsed * 9) * 10 : 0;
      visual.wings[0].setLocalEulerAngles(0, 0, flap);
      visual.wings[1].setLocalEulerAngles(0, 0, -flap);
      visual.head.setLocalEulerAngles(0, 0, state.moving ? Math.sin(elapsed * 7) * 3 : 0);
      return true;
    },
    status() {
      return Object.freeze({
        visible: visual.root.enabled === true,
        active: isActiveDuckCompanion(getSnapshot?.()),
        moving: state?.moving === true,
        teleported: state?.teleported === true,
        x: state?.x ?? null,
        z: state?.z ?? null
      });
    },
    destroy() {
      visual.root.destroy?.();
      state = null;
    }
  });
}
