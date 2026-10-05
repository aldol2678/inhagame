// Independent buoyancy + drag integrator. No helicopter/rotor/pitch/roll dependency.
export const BALLOON_LIMITS=Object.freeze({maxAltitude:35,horizontalSpeed:1.8,ascendSpeed:2,descendSpeed:1.5});
export function createBalloonState(yaw=0){return{vx:0,vy:0,vz:0,yaw:Number.isFinite(yaw)?yaw:0};}
export function stepBalloon(state,{x=0,z=0,lift=0}={},dt){
 if(!Number.isFinite(dt)||dt<=0)return{...state};dt=Math.min(dt,.1);
 const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
 const vx=state.vx+(x*.9-state.vx*.6)*dt,vz=state.vz+(z*.9-state.vz*.6)*dt;
 const speed=Math.hypot(vx,vz),scale=speed>BALLOON_LIMITS.horizontalSpeed?BALLOON_LIMITS.horizontalSpeed/speed:1;
 const vy=Math.max(-BALLOON_LIMITS.descendSpeed,Math.min(BALLOON_LIMITS.ascendSpeed,
 state.vy+(Math.max(-1,Math.min(1,lift))*1.4-state.vy*.7)*dt));
 const target=length>.01?Math.atan2(x,z)*180/Math.PI:state.yaw;
 const delta=((target-state.yaw+540)%360)-180;
 return{vx:vx*scale,vy,vz:vz*scale,yaw:state.yaw+Math.max(-15*dt,Math.min(15*dt,delta))};
}
