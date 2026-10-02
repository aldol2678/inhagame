// Local/remote helicopter presentation attached to the player root.
// Flight authority lives in PlayerController; this module only presents body bank and spinning rotors.
import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";

export function attachRiderHelicopter(player) {
  const root = new pc.Entity("Rider_CampusHelicopter");
  player.addChild(root);
  root.setLocalPosition(0, -PLAYER_ORIGIN_Y, 0);
  root.enabled = false;

  const navy = surface("#203952");
  const glass = surface("#91d5ed");
  const orange = surface("#f3a431");
  const dark = surface("#172430");
  const steel = surface("#aeb7c2");

  box(root, "helicopter_body", [0, 0.58, 0], [1.45, 0.62, 1.9], navy);
  box(root, "helicopter_cockpit", [0, 0.72, 0.56], [1.22, 0.4, 0.72], glass);
  box(root, "helicopter_tail_boom", [0, 0.6, -1.42], [0.28, 0.28, 1.7], navy);
  box(root, "helicopter_tail_fin", [0, 0.86, -2.22], [0.08, 0.72, 0.52], navy);
  box(root, "helicopter_nose", [0, 0.57, 0.98], [0.44, 0.16, 0.16], orange);

  for (const side of [-1, 1]) {
    box(root, `skid_${side}`, [side * 0.55, 0.1, 0.02], [0.08, 0.07, 1.5], dark);
    box(root, `skid_strut_front_${side}`, [side * 0.48, 0.27, 0.34], [0.05, 0.38, 0.05], steel, side * -20);
    box(root, `skid_strut_rear_${side}`, [side * 0.48, 0.27, -0.34], [0.05, 0.38, 0.05], steel, side * 20);
  }

  box(root, "rotor_mast", [0, 1.21, 0], [0.09, 0.28, 0.09], steel);
  const mainRotor = new pc.Entity("main_rotor");
  mainRotor.setLocalPosition(0, 1.35, 0);
  root.addChild(mainRotor);
  box(mainRotor, "main_rotor_x", [0, 0, 0], [4.9, 0.045, 0.1], dark);
  box(mainRotor, "main_rotor_z", [0, 0.01, 0], [0.1, 0.045, 4.9], dark);

  const tailRotor = new pc.Entity("tail_rotor");
  tailRotor.setLocalPosition(-0.16, 0.82, -2.46);
  root.addChild(tailRotor);
  box(tailRotor, "tail_rotor_vertical", [0, 0, 0], [0.04, 0.78, 0.08], dark);
  box(tailRotor, "tail_rotor_horizontal", [0, 0, 0], [0.04, 0.08, 0.78], dark);

  let mainAngle = 0;
  let tailAngle = 0;
  return {
    root,
    update(dt, { active = false, pitch = 0, roll = 0 } = {}) {
      root.enabled = active === true;
      if (!root.enabled) return;
      const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
      mainAngle = (mainAngle + step * 900) % 360;
      tailAngle = (tailAngle + step * 1350) % 360;
      mainRotor.setLocalEulerAngles(0, mainAngle, 0);
      tailRotor.setLocalEulerAngles(tailAngle, 0, 0);
      root.setLocalEulerAngles(Number.isFinite(pitch) ? pitch : 0, 0, Number.isFinite(roll) ? -roll : 0);
    }
  };
}
