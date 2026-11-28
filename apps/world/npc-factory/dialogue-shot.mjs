// Head positions are in campus coordinates, with +z in the navigation plane.
export function chooseDialogueShot({player, subject, aspect = 1, fov = 50, visible}) {
  const dx=player.x-subject.x, dz=player.z-subject.z, gap=Math.hypot(dx,dz);
  if (!Number.isFinite(gap) || gap < .24 || gap > 2.5) return null;
  const ux=dx/gap, uz=dz/gap, sx=-uz, sz=ux;
  const headY=(player.y+subject.y)*.5, centerX=(player.x+subject.x)*.5, centerZ=(player.z+subject.z)*.5;
  const lens = Math.tan(fov*Math.PI/360);
  const distance = Math.max(1.85, (gap+.47)/(2*Math.max(.38,aspect)*lens*.74));
  const playerHead=[player.x,player.y,player.z], npcHead=[subject.x,subject.y,subject.z];
  const reaches = [...new Set([distance,Math.min(distance,3),Math.min(distance,2.5)])];
  for(const reach of reaches) for(const offset of [.46,.14,.84,1.12,1.40]) for(const side of [1,-1]) {
    const eye=[centerX+sx*side*reach+ux*offset,headY+.29,centerZ+sz*side*reach+uz*offset];
    if(!visible(npcHead,eye) || !visible(playerHead,eye)) continue;
    const target=[centerX,headY-Math.min(.57,Math.hypot(reach,offset)*lens*.46),centerZ];
    return {eye,target};
  }
  return null;
}
