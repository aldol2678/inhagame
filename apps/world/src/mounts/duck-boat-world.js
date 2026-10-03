import { INKYUNG_DOCK } from "./duck-boat-motion.js";

export const DUCK_BOAT_ID = "mount.inkyung_duckboat.prototype";
// DOCK UX: the boat is a piece of dock infrastructure, not a free-summon vehicle.
// Keep one ready at the authored dock anchor as soon as the world mounts its prop root.
let parkedPose = { ...INKYUNG_DOCK.spawn };
let propRoot = null;
let visible = true;
export function getDuckBoatParkedPose() { return parkedPose ? { ...parkedPose } : null; }
function sync() {
  if (!propRoot) return;
  propRoot.enabled = visible && parkedPose !== null;
  if (parkedPose) {
    propRoot.setLocalPosition(parkedPose.x, parkedPose.y, parkedPose.z);
    propRoot.setLocalEulerAngles(0, parkedPose.yaw, 0);
  }
}
export function setDuckBoatPropRoot(root) { propRoot = root; sync(); }
export function parkDuckBoatAt(pose) {
  if (!pose || ![pose.x,pose.y,pose.z,pose.yaw].every(Number.isFinite)) return false;
  parkedPose = { ...pose }; visible = true; sync(); return true;
}
export function setDuckBoatPropVisible(value) { visible = value === true; sync(); }
