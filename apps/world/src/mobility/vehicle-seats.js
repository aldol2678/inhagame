// Per-instance seat authority. Presence pose packets are NOT seat claims.
// Local P0 only: network admission must be provided before exposing shared passenger boarding.
export function createVehicleSeats(definitions) {
  const seats=new Map(definitions.map(s=>[s.id,{...s,occupant:null}]));
  if(seats.size!==definitions.length || [...seats.values()].filter(s=>s.controls).length!==1)
    throw new TypeError("Vehicle requires unique seats and exactly one driver");
  return {
    claim(seatId,actorId) {
      const seat=seats.get(seatId);
      if(!seat || typeof actorId!=="string" || !actorId || seat.occupant ||
        [...seats.values()].some(s=>s.occupant===actorId)) return false;
      seat.occupant=actorId;return true;
    },
    release(seatId,actorId) {
      const seat=seats.get(seatId);
      if(!seat || !actorId || seat.occupant!==actorId)return false;
      seat.occupant=null;return true;
    },
    canDrive(actorId) {
      return typeof actorId==="string" && [...seats.values()].some(s=>s.controls && s.occupant===actorId);
    },
    snapshot() { return [...seats.values()].map(s=>({id:s.id,role:s.role,controls:s.controls,occupant:s.occupant})); },
    worldPose(seatId,transform) {
      const s=seats.get(seatId);
      if(!s || !transform || ![transform.x,transform.y,transform.z,transform.yaw].every(Number.isFinite))return null;
      const o=s.offset??{x:0,y:0,z:0},r=transform.yaw*Math.PI/180;
      return {x:transform.x+o.x*Math.cos(r)+o.z*Math.sin(r),y:transform.y+o.y,
        z:transform.z-o.x*Math.sin(r)+o.z*Math.cos(r),yaw:transform.yaw};
    }
  };
}
