// Movement profiles are explicit; category/domain never choose physics.
export const GROUND_MOTION_PROFILES = Object.freeze({
  KICKBOARD: Object.freeze({ cruise: 12, boost: 17, acceleration: 36, braking: 48, turnRate: 540 })
});
export function stepGroundMount(state, { x = 0, z = 0, boost = false } = {}, dt, profile) {
  if (!profile || !Number.isFinite(dt) || dt <= 0) return { ...state };
  dt = Math.min(dt, 0.1);
  const magnitude = Math.min(1, Math.hypot(x,z));
  const targetSpeed = magnitude * (boost ? profile.boost : profile.cruise);
  const speed = state.speed + Math.max(-profile.braking*dt, Math.min(profile.acceleration*dt,targetSpeed-state.speed));
  const targetYaw = magnitude > 0.001 ? Math.atan2(x,z)*180/Math.PI : state.yaw;
  const delta = ((targetYaw-state.yaw+540)%360)-180;
  const yaw = state.yaw + Math.max(-profile.turnRate*dt,Math.min(profile.turnRate*dt,delta));
  return { speed, yaw, vx: Math.sin(yaw*Math.PI/180)*speed, vz: Math.cos(yaw*Math.PI/180)*speed };
}

// Profiles select physics explicitly, never via category or domain.
export const CAR_LIGHT_PROFILE=Object.freeze({cruise:10,boost:13,reverse:4,acceleration:8,braking:12,turnRate:80});
export function stepLightCar(state,{x=0,z=0,boost=false}={},dt,profile) {
  if(!profile || !Number.isFinite(dt) || dt<=0)return {...state};
  dt=Math.min(dt,.1);x=Math.max(-1,Math.min(1,x));z=Math.max(-1,Math.min(1,z));
  const target=z*(z<0 ? profile.reverse : boost ? profile.boost : profile.cruise);
  const rate=Math.abs(target)>Math.abs(state.speed) && target*state.speed>=0 ? profile.acceleration : profile.braking;
  const speed=state.speed+Math.max(-rate*dt,Math.min(rate*dt,target-state.speed));
  const yaw=state.yaw+x*profile.turnRate*dt*Math.min(1,Math.abs(speed)/2)*Math.sign(speed);
  return {speed,yaw,vx:Math.sin(yaw*Math.PI/180)*speed,vz:Math.cos(yaw*Math.PI/180)*speed};
}
