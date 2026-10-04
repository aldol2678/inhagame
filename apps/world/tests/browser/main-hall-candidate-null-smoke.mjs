// Real PlayCanvas lifecycle verification; a null device supplies no pixel proof.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const {buildMainHallBlockout}=await import('../../src/main-hall-blockout.js');
const {buildMainHallCandidate}=await import('../../src/main-hall-candidate-renderer.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
assert.equal(typeof buildMainHallCandidate,'function','candidate lifecycle adapter exists');
const canvas={id:'main-hall-candidate-null',width:512,height:512},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
const tiers=['BASE','NEAR','DETAIL'],materials=new Set(),totals=[];
const summarize=root=>root.findComponents('render').flatMap(r=>r.meshInstances.map(m=>({name:r.entity.name,vertices:m.mesh.vertexBuffer.numVertices,hash:createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex')})));
for(let cycle=0;cycle<3;cycle++){
 const root=new pc.Entity('MainHallCandidate');app.root.addChild(root);root.setLocalScale(1,1,-1);
 assert.throws(()=>buildMainHallCandidate(root,'UNKNOWN'),/tier/i);assert.equal(root.children.length,0);
 const result={};
 for(const tier of tiers){
  const node=buildMainHallCandidate(root,tier);assert.equal(buildMainHallCandidate(root,tier),node,'per-root/tier idempotence');
  root.removeChild(node);assert.equal(node.parent,null);assert.ok(buildMainHallCandidate(root,tier).parent===root,'detached cached tier recovers parent ownership');
  assert.equal(node.parent,root);assert.deepEqual(node.getLocalPosition().toArray(),[0,0,0]);assert.deepEqual(node.getLocalScale().toArray(),[1,1,1]);
  const renders=node.findComponents('render'),names=renders.map(r=>r.entity.name);
  if(tier==='BASE'){assert.equal(names.filter(n=>n==='bldg_01').length,1);assert.equal(names.filter(n=>n.startsWith('hall_candidate_base_')).length,1);assert.ok(!names.includes('hall_front_entablature'));}
  if(tier==='NEAR'){assert.ok(!names.includes('hall_entry_glass'));assert.equal(names.filter(n=>n.startsWith('hall_candidate_entry_')).length,2);}
  if(tier==='DETAIL')assert.equal(names.filter(n=>n.startsWith('hall_facade_')).length,5,'one material-grouped facade');
  const meshes=renders.flatMap(r=>r.meshInstances);assert.ok(meshes.length<=10);assert.ok(meshes.reduce((n,m)=>n+m.mesh.vertexBuffer.numVertices,0)<14000);
  for(const m of meshes){if(cycle===0)materials.add(m.material);else assert.ok(materials.has(m.material),'source material reuse across reload');}
  result[tier]=summarize(node);
 }
 assert.equal(root.children.length,3);if(cycle)assert.deepEqual(result,totals[0]);totals.push(result);
 // Destroying a tier and recreating cannot return a stale or detached group.
 const old=root.children[1];old.destroy();const replacement=buildMainHallCandidate(root,'NEAR');assert.notEqual(replacement,old);assert.equal(root.children.length,3);
 const foreign=new pc.Entity('OtherOwner');app.root.addChild(foreign);root.removeChild(replacement);foreign.addChild(replacement);
 const recreated=buildMainHallCandidate(root,'NEAR');assert.ok(recreated!==replacement&&recreated.parent===root&&replacement.parent===foreign,'externally reparented tier is not reclaimed');
 foreign.destroy();assert.ok(buildMainHallCandidate(root,'NEAR')===recreated,'old-group destruction cannot evict a newer cache entry');
 root.destroy();
}
// The default call remains byte-equivalent to explicitly selecting the old
// presentation and Jeongseok is unaffected by the main-hall-only option.
for(const id of ['bldg_01','bldg_jungseok'])for(const tier of tiers){const a=new pc.Entity('a'),b=new pc.Entity('b');app.root.addChild(a);app.root.addChild(b);buildMainHallBlockout(a,[id],tier);buildMainHallBlockout(b,[id],tier,{mainHallDetail:id==='bldg_01'?'existing':'candidate'});assert.deepEqual(summarize(a),summarize(b));a.destroy();b.destroy();}
console.log(JSON.stringify({engine:pc.version,device:'NullGraphicsDevice (no pixels)',cycles:3,tiers:Object.fromEntries(tiers.map(t=>[t,{meshes:totals[0][t].length,vertices:totals[0][t].reduce((s,m)=>s+m.vertices,0)}])),idempotence:true,disposal:true,defaultAndLibraryParity:true}));
app.destroy();
