export const CAMPUS_BALLOON_ID = "mount.campus_balloon.prototype";
let parkedPose = null;
let propRoot = null;
let visible = false;
export function getCampusBalloonParkedPose() { return parkedPose ? { ...parkedPose } : null; }
function sync() {
  if (!propRoot) return;
  propRoot.enabled = visible && parkedPose !== null;
  if (parkedPose) {
    propRoot.setLocalPosition(parkedPose.x, parkedPose.y, parkedPose.z);
    propRoot.setLocalEulerAngles(0, parkedPose.yaw, 0);
  }
}
export function setCampusBalloonPropRoot(root) { propRoot = root; sync(); }
export function parkCampusBalloonAt(pose) {
  if (!pose || ![pose.x,pose.y,pose.z,pose.yaw].every(Number.isFinite)) return false;
  parkedPose = { ...pose }; visible = true; sync(); return true;
}
export function setCampusBalloonPropVisible(value) { visible = value === true; sync(); }
