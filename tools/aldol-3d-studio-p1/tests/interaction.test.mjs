import test from 'node:test';
import assert from 'node:assert/strict';
import {dragTransform,projectedAxis,sceneHierarchy,canReparent,screenToGround,rotateAroundAxis} from '../web/interaction.mjs';
const start={position:[2,3,4],rotation:[0,0,0,1],scale:[1,2,3]};
test('gizmo move projects pointer delta to world meters',()=>{
 const p={direction:[1,0],pixelsPerMeter:40};
 const n=dragTransform(start,'move','x',[80,0],p);assert.equal(n.position[0],4);assert.equal(start.position[0],2);
});
test('gizmo move axis parallel to view cannot produce huge deltas',()=>{
 assert.deepEqual(dragTransform(start,'move','y',[600,100],{direction:[1,0],pixelsPerMeter:0}).position,start.position);
});
test('gizmo move snap rounds to grid',()=>{
 const n=dragTransform(start,'move','z',[16,0],{direction:[1,0],pixelsPerMeter:40},{snap:true});assert.equal(n.position[2],4.5);
});
test('gizmo scale maintains positivity and affects one axis only',()=>{
 const n=dragTransform(start,'scale','y',[-999,0],{direction:[1,0],pixelsPerMeter:40});assert(n.scale[1]>=.05);assert.equal(n.scale[0],1);
});
test('gizmo rotation preserves normalized quaternion, original unchanged',()=>{
 const n=dragTransform(start,'rotate','x',[30,0],{direction:[1,0],pixelsPerMeter:25});assert(Math.abs(Math.hypot(...n.rotation)-1)<1e-9);assert.deepEqual(start.rotation,[0,0,0,1]);
});
test('90-degree quaternion axis rotation',()=>{
 const q=rotateAroundAxis([0,0,0,1],'y',Math.PI/2);assert(Math.abs(q[1]-Math.SQRT1_2)<1e-10);
});
test('projection axis direction from supplied projection',()=>{
 assert.deepEqual(projectedAxis(p=>[p[0]*5,p[1]*3],[0,0,0],'x'),{direction:[1,0],pixelsPerMeter:5});
});
test('hierarchy preserves nesting and tolerates orphan nodes',()=>{
 const rows=sceneHierarchy([{id:'root',parentId:null},{id:'child',parentId:'root'},{id:'orphan',parentId:'lost'}]);assert.deepEqual(rows.map(r=>[r.node.id,r.depth]),[['root',0],['child',1],['orphan',0]]);
});
test('hierarchy cyclic data terminates safely',()=>{
 const rows=sceneHierarchy([{id:'a',parentId:'b'},{id:'b',parentId:'a'}]);assert.equal(rows.length,2);
});
test('reparent forbids self and descendant cycles',()=>{
 const nodes=[{id:'a',parentId:null},{id:'b',parentId:'a'},{id:'c',parentId:'b'}];assert.equal(canReparent(nodes,'a','c'),false);assert.equal(canReparent(nodes,'b','b'),false);assert.equal(canReparent(nodes,'c',null),true);
});
test('ground ray resolves to floor below center camera',()=>{
 const p=screenToGround(300,300,600,600,.7,.48,18);assert(p);assert(Math.abs(p[0])<1e-8);assert.equal(p[1],0);assert(Math.abs(p[2])<1e-8);
});
test('ground ray rejects invalid dimensions or rays above horizon',()=>{
 assert.equal(screenToGround(0,0,0,300,0,.4,18),null);
});
