const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/stage-config.js','utf8'),ctx);
const stages=ctx.window.InduckSurvivalStages;
const stage=stages.get(4),map=stage.map,world=stage.world;
assert(stage.implemented&&map.kind==='campus');
assert.equal(stage.clear.seconds,220);
assert.equal(stage.clear.deadline,285);
assert.equal(map.portals.length,8);
for(const portal of map.portals){
  assert(map.portals.some(p=>p.floor===portal.to&&p.to===portal.floor&&p.x===portal.tx&&p.z===portal.tz),
    `One-way stair: ${portal.floor} -> ${portal.to}`);
}
const step=2,columns=(world.maxX-world.minX)/step,rows=(world.maxZ-world.minZ)/step;
const cell=(x,z)=>Math.floor((z-world.minZ)/step)*columns+Math.floor((x-world.minX)/step);
const point=i=>({x:world.minX+(i%columns+.5)*step,z:world.minZ+(Math.floor(i/columns)+.5)*step});
function blocked(floor,x,z){
  if(x<world.minX+.8||x>world.maxX-.8||z<world.minZ+.8||z>world.maxZ-.8)return true;
  return map.walls[floor].some(([cx,cz,hw,hd])=>Math.abs(x-cx)<hw+.65&&Math.abs(z-cz)<hd+.65);
}
function reachable(floor,from,to){
  const begin=cell(from.x,from.z),goal=cell(to.x,to.z);
  if(blocked(floor,point(begin).x,point(begin).z)||blocked(floor,point(goal).x,point(goal).z))return false;
  const queue=[begin],seen=new Set(queue);
  for(let i=0;i<queue.length;i++){
    const current=queue[i];if(current===goal)return true;
    for(const [dc,dr] of [[0,-1],[1,0],[0,1],[-1,0]]){
      const col=current%columns+dc,row=Math.floor(current/columns)+dr;
      if(col<0||col>=columns||row<0||row>=rows)continue;
      const next=row*columns+col;if(seen.has(next))continue;
      const p=point(next);if(blocked(floor,p.x,p.z))continue;
      seen.add(next);queue.push(next);
    }
  }
  return false;
}
for(const floor of map.floors){
  const locations=[...map.portals.filter(p=>p.floor===floor.id),
    ...[map.print,map.lecture,map.defense,map.exit].filter(p=>p.floor===floor.id)];
  if(floor.id===1)locations.push(stage.start);
  for(const from of locations)for(const to of locations)
    assert(reachable(floor.id,from,to),`Floor ${floor.id}: (${from.x},${from.z}) cannot reach (${to.x},${to.z})`);
}
for(const [name,objective] of [['인쇄물',map.print],['강의',map.lecture],['방어',map.defense]]){
  assert(objective.at<stage.clear.deadline,`${name} opens after deadline`);
  assert(objective.hold>0);
}
assert.equal(stages.get(1).clear.seconds,180);
assert.equal(stages.get(2).clear.deadline,210);
assert.equal(stages.get(3).clear.deadline,225);
console.log('Stage 4 three floors, reciprocal portals, all stair/objective/exit routes, timing and 1–3 clear rules: PASS');
