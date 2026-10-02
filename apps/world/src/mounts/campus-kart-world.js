export const CAMPUS_KART_ID = "mount.campus_kart.prototype";
let parkedPose = null;
let propRoot = null;
let visible = false;
export function getCampusKartParkedPose() { return parkedPose ? { ...parkedPose } : null; }
function sync() {
  if (!propRoot) return;
  propRoot.enabled = visible && parkedPose !== null;
  if (parkedPose) {
    propRoot.setLocalPosition(parkedPose.x, parkedPose.y, parkedPose.z);
    propRoot.setLocalEulerAngles(0, parkedPose.yaw, 0);
  }
}
export function setCampusKartPropRoot(root) { propRoot = root; sync(); }
export function parkCampusKartAt(pose) {
  if (!pose || ![pose.x,pose.y,pose.z,pose.yaw].every(Number.isFinite)) return false;
  parkedPose = { ...pose }; visible = true; sync(); return true;
}
export function setCampusKartPropVisible(value) { visible = value === true; sync(); }
