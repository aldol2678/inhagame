import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionLibrary,validateMotionClip} from '../src/motion-library.mjs';

const q=Math.SQRT1_2;
function make(id,endpoint=2){
  return {id,name:id,duration:1,fps:30,skeleton:['root','arm'],tracks:[
    {joint:'root',channel:'translation',frames:[{time:0,value:[0,0,0]},{time:1,value:[endpoint,0,0]}]},
    {joint:'arm',channel:'rotation',frames:[{time:0,value:[0,0,0,1]},{time:1,value:[0,0,q,q]}]}
  ]};
}
test('motion clip validated, imported idempotently and exported without touching world or disk',()=>{
 const library=new MotionLibrary(),a=make('walk');
 const checked=validateMotionClip(a);assert.equal(checked.stats.frames,4);
 assert.equal(library.validate({clip:a}).valid,true);
 assert.equal(library.import(a).status,'imported');
 assert.equal(library.import(a).status,'unchanged');
 assert.equal(library.library().clips.length,1);
 const exported=library.export('walk');assert.deepEqual(exported.clip,a);
 assert.equal(exported.sha256,checked.sha256);
 assert.equal(exported.glbExportSupported,false);
 assert.equal(library.validate({id:'walk'}).engineRenderQA,'NOT_SUPPORTED');
 a.tracks[0].frames[1].value[0]=999;
 assert.equal(library.export('walk').clip.tracks[0].frames[1].value[0],2);
 assert.throws(()=>library.import(make('walk',99)),/E_MOTION_ID_CONFLICT/);
});
test('retarget copies joints using explicit name mapping without claiming skeleton IK',()=>{
 const l=new MotionLibrary();l.import(make('walk'));
 const result=l.retarget({sourceId:'walk',id:'walk.hand',targetSkeleton:['root','hand'],mapping:{arm:'hand'}});
 assert.equal(result.method,'JOINT_NAME_MAPPING_ONLY');assert.equal(result.ikSolved,false);
 assert.deepEqual(l.export('walk.hand').clip.skeleton,['root','hand']);
 assert.equal(l.export('walk.hand').clip.tracks[1].joint,'hand');
 assert.deepEqual(l.export('walk').clip.skeleton,['root','arm']);
 assert.throws(()=>l.retarget({sourceId:'walk',id:'broken',targetSkeleton:['root','hand'],mapping:{arm:'root'}}),/E_MOTION_RETARGET_MAP/);
});
test('blend samples interpolated pose with normalized shortest-path rotation',()=>{
 const l=new MotionLibrary();l.import(make('a',2));l.import(make('b',4));
 const blend=l.blend({aId:'a',bId:'b',time:.5,alpha:.5});
 assert.equal(blend.tracks.length,2);
 assert.equal(blend.tracks.find(x=>x.channel==='translation').value[0],1.5);
 assert.ok(Math.abs(Math.hypot(...blend.tracks.find(x=>x.channel==='rotation').value)-1)<1e-9);
 assert.equal(blend.renderingSupported,false);
 assert.throws(()=>l.blend({aId:'a',bId:'b',time:0,alpha:2}),/E_MOTION_BLEND/);
 l.import({id:'other',name:'other',duration:1,fps:30,skeleton:['other'],tracks:[{joint:'other',channel:'scale',frames:[{time:0,value:[1,1,1]}]}]});
 assert.throws(()=>l.blend({aId:'a',bId:'other',time:0,alpha:.5}),/E_MOTION_SKELETON_MISMATCH/);
});
test('invalid frame, skeleton, quaternion, budget and duplicate tracks fail without storing',()=>{
 const mutate=[
  c=>c.tracks[0].frames[1].time=0,
  c=>c.tracks[0].frames[1].value[0]=Infinity,
  c=>c.tracks[1].frames[0].value=[0,0,0,3],
  c=>c.tracks.push(structuredClone(c.tracks[0])),
  c=>c.skeleton=['root','root'],
  c=>c.tracks[0].joint='missing',
  c=>c.tracks[0].frames[1].time=1.5,
  c=>c.tracks[0].frames[0].value=[1,2],
  c=>c.tracks[0].channel='__proto__',
  c=>c.skeleton=['__proto__','arm'],
 ];
 const l=new MotionLibrary();
 for(const edit of mutate){
   const c=make('bad');edit(c);
   assert.throws(()=>l.import(c),/E_MOTION_/);
   assert.equal(l.library().clips.length,0);
 }
});
