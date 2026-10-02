// Parked campus helicopter state and stadium spawn.
// This module stays renderer-free so PlayerController and Node QA can import it without PlayCanvas.
import { FACILITIES } from "../campus-facilities.js";
import { SPORTS_FLOOR } from "../stadium-stands-layout.js";
import { metersToWorld } from "../world-scale.js";

export const CAMPUS_HELICOPTER_ID = "mount.campus_helicopter.prototype";

const stadium = FACILITIES.find((facility) => facility.id === "fac_stadium");
if (!stadium) throw new Error("Campus helicopter requires fac_stadium");

const INITIAL_POSE = Object.freeze({
  x: stadium.footprintCenter.x,
  y: SPORTS_FLOOR + 0.05,
  z: stadium.footprintCenter.z,
  yaw: 0
});

let parkedPose = { ...INITIAL_POSE };
let propRoot = null;

export const CAMPUS_HELICOPTER = Object.freeze({
  id: "stadium_campus_helicopter",
  mountId: CAMPUS_HELICOPTER_ID,
  rideable: true,
  interactionRadius: metersToWorld(9)
});

export function getCampusHelicopterParkedPose() {
  return { ...parkedPose };
}

function applyParkedPose() {
  if (!propRoot) return;
  propRoot.setLocalPosition(parkedPose.x, parkedPose.y, parkedPose.z);
  propRoot.setLocalEulerAngles(0, parkedPose.yaw, 0);
}

export function setCampusHelicopterPropRoot(root) {
  propRoot = root ?? null;
  applyParkedPose();
}

export function parkCampusHelicopterAt({ x, y, z, yaw } = {}) {
  parkedPose = {
    x: Number.isFinite(x) ? x : parkedPose.x,
    y: Number.isFinite(y) ? y : parkedPose.y,
    z: Number.isFinite(z) ? z : parkedPose.z,
    yaw: Number.isFinite(yaw) ? yaw : parkedPose.yaw
  };
  applyParkedPose();
  return getCampusHelicopterParkedPose();
}

export function setCampusHelicopterPropVisible(visible) {
  if (propRoot) propRoot.enabled = visible === true;
}
