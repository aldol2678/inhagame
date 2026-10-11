// Both subjects are direct children of CampusCoordinateFrame (whose world Z is reflected).
export function incomeLocalEntityPosition(entity) {
  const p = entity?.getLocalPosition?.();
  return p && [p.x,p.y,p.z].every(Number.isFinite) ? {x:p.x,y:p.y,z:p.z} : null;
}
