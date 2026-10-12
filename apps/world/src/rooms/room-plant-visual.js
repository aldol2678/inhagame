// Self-authored bounded geometry. Pot identity stays independent from the STATIC medium plant.
export function roomPlantVisual(stage = null) {
  const part = (name, at, size, color, type = "sphere") => ({ name, at, size, color, type });
  const pieces = [part("grow_pot",[0,.15,0],[.38,.30,.38],"#a95f3c","cylinder"),
    part("grow_soil",[0,.305,0],[.32,.015,.32],"#514332","cylinder")];
  if (!["SPROUT","BUD","BLOOM"].includes(stage)) return pieces;
  const y = stage === "SPROUT" ? .39 : .49;
  pieces.push(part("grow_stem",[0,y,0],[.025,(y-.31)*2,.025],"#4b7d3e","cylinder"),
    part("grow_leaf_left",[-.065,y,0],[.13,.035,.07],"#64974d"),
    part("grow_leaf_right",[.065,y+.035,0],[.13,.035,.07],"#4b8b47"));
  if (stage === "BUD") pieces.push(part("grow_bud",[0,.685,0],[.10,.14,.10],"#a0b964"));
  if (stage === "BLOOM") {
    for (let n = 0; n < 8; n++) {
      const a = n*Math.PI/4;
      pieces.push(part(`grow_petal_${n}`,[Math.cos(a)*.105,.70,Math.sin(a)*.105],[.12,.045,.12],"#fff1da"));
    }
    pieces.push(part("grow_flower_center",[0,.725,0],[.105,.05,.105],"#efbf4d"));
  }
  return pieces;
}
