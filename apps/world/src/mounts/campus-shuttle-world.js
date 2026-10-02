export const CAMPUS_SHUTTLE_ID="mount.campus_shuttle.prototype";
let root=null;
export function setCampusShuttlePropRoot(value){root=value;}
export function syncCampusShuttleProp(pose,visible=true){
 if(!root)return;root.enabled=visible;
 root.setLocalPosition(pose.x,pose.y,pose.z);root.setLocalEulerAngles(0,pose.yaw,0);
}
