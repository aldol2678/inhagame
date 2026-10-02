// Local P0 transit clock; no timetable or shared network vehicle authority.
export const SHUTTLE_ROUTE=Object.freeze({
 routeId:"campus.main_gate_test",
 stations:Object.freeze([
  // Keep the parked shuttle ahead of MAIN_GATE_SPAWN. The lobby renders the real
  // player at z=-98, so parking the 5.2m-long shuttle at the same coordinate makes
  // the first gameplay frame start inside its body/camera occluder.
  Object.freeze({id:"main_gate",name:"정문 승강장",x:0,z:-92,platform:Object.freeze({x:2.2,z:-92})}),
  Object.freeze({id:"gate_north",name:"정문 북측 승강장",x:0,z:-70,platform:Object.freeze({x:2.2,z:-70})})
 ]),speed:4
});
export const TRANSIT_STATE=Object.freeze({IDLE:"IDLE",BOARDING:"BOARDING",DEPARTING:"DEPARTING",MOVING:"MOVING",ARRIVING:"ARRIVING",DWELL:"DWELL"});
export function createTransitRuntime({route=SHUTTLE_ROUTE,groundHeight=()=>0,canTravel=()=>false}={}) {
 if(!route?.routeId || !Array.isArray(route.stations) || route.stations.length<2 ||
 route.stations.some(s=>!s.id||![s.x,s.z,s.platform?.x,s.platform?.z].every(Number.isFinite)) ||
 new Set(route.stations.map(s=>s.id)).size!==route.stations.length || (!Number.isFinite(route.speed)||!(route.speed>0)))
 throw new TypeError("Invalid transit route");
 let index=0,nextIndex=1,phase="IDLE",time=0;
 let pose={x:route.stations[0].x,y:groundHeight(route.stations[0].x,route.stations[0].z),z:route.stations[0].z,yaw:0};
 const change=value=>{phase=value;time=0;};
 const stopped=()=>["IDLE","BOARDING","DWELL"].includes(phase);
 return {
  routeId:route.routeId,stations:route.stations,
  get currentStation(){return route.stations[index];},get nextStation(){return route.stations[nextIndex];},
  get transitState(){return phase;},get pose(){return{...pose};},get boardingAllowed(){return stopped();},
  update(dt){
   if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.1);time+=dt;
   if(phase==="IDLE"&&time>=1)change("BOARDING");
   else if(phase==="BOARDING"&&time>=6)change("DEPARTING");
   else if(phase==="DEPARTING"&&time>=1)change("MOVING");
   else if(phase==="MOVING"){
    const target=route.stations[nextIndex],dx=target.x-pose.x,dz=target.z-pose.z,distance=Math.hypot(dx,dz),step=Math.min(distance,route.speed*dt);
    const candidate=distance>1e-7?{x:pose.x+dx/distance*step,z:pose.z+dz/distance*step}:{x:target.x,z:target.z};
    const next={...candidate,y:groundHeight(candidate.x,candidate.z),yaw:Math.atan2(dx,dz)*180/Math.PI};
    if(!Number.isFinite(next.y)||!canTravel(next,pose))return;pose=next;
    if(distance<=step+.001){index=nextIndex;nextIndex=(index+1)%route.stations.length;change("ARRIVING");}
   }else if(phase==="ARRIVING"&&time>=1)change("DWELL");
   else if(phase==="DWELL"&&time>=6)change("BOARDING");
  },
  snapshot(){return{routeId:route.routeId,stations:route.stations.map(s=>s.id),currentStation:route.stations[index].id,
   nextStation:route.stations[nextIndex].id,transitState:phase,pose:{...pose},boardingAllowed:stopped()};}
 };
}
