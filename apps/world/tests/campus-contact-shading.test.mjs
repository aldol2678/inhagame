import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactGeometry,contactEllipse,contactMask,contactVisibility } from '../src/campus-contact-shading-geometry.js';
import { campusBaseContactGeometry,campusTreeContactGeometry,CONTACT_BUDGET } from '../src/campus-contact-shading-layout.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { GARDEN_FLOOR } from '../src/library-garden-layout.js';

const rect=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const receiver=(exclude=[])=>({id:'test',y:.018,mask:contactMask(rect(-2,-2,2,2)),exclude});
const patch=(id='one')=>({id,kind:'tree',pieces:contactEllipse({x:0,z:0},(x,z)=>({x,z}),1,1)});
const surfaceArea=d=>{
  let area=0;
  for(let i=0;i<d.positions.length;i+=9){const [ax,,az,bx,,bz,cx,,cz]=d.positions.slice(i,i+9);
    area+=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))/2;}
  return area;
};

test('exact clipping removes a narrow crossing that corner/centre rejection misses',()=>{
  const uncut=buildContactGeometry([patch()],[receiver()]);
  const cut=buildContactGeometry([patch()],[receiver([contactMask(rect(.4,-2,.45,2))])]);
  assert.ok(surfaceArea(cut)<surfaceArea(uncut));
  for(let i=0;i<cut.positions.length;i+=9){
    const xs=[cut.positions[i],cut.positions[i+3],cut.positions[i+6]];
    assert.ok(Math.max(...xs)<=.4+1e-7 || Math.min(...xs)>=.45-1e-7);
  }
  assert.ok(cut.colors.every((v,i)=>i%4!==3 || v>=0 && v<=.16+1e-7));
  assert.ok(cut.colors.some((v,i)=>i%4===3 && v>0 && v<.16));
});

test('coincident objects do not darken the same ground twice',()=>{
  const once=buildContactGeometry([patch()],[receiver()]);
  const twice=buildContactGeometry([patch(),patch('two')],[receiver()]);
  assert.ok(Math.abs(surfaceArea(once)-surfaceArea(twice))<1e-7);
  assert.equal(twice.sources.length,1);
});

test('triangle and byte caps discard whole objects, including the first one',()=>{
  for(const limits of [{maxTriangles:1},{maxBytes:16}]){
    const d=buildContactGeometry([patch()],[receiver()],limits);
    assert.equal(d.triangles,0);assert.equal(d.sources.length,0);assert.equal(d.skipped,1);
  }
});

test('snow, quality, explicit disable and layer fade compose without rebuilding',()=>{
  assert.equal(contactVisibility({near:true,tier:'low'}),0);
  assert.equal(contactVisibility({tier:'low'}),1);
  assert.equal(contactVisibility({fade:.25,snow:.07}),.125);
  assert.equal(contactVisibility({snow:.14}),0);
  assert.equal(contactVisibility({snow:NaN}),1);
  assert.equal(contactVisibility({enabled:false}),0);
  assert.equal(contactVisibility({fade:-1}),0);
});

test('current campus pilot covers two buildings, four benches and nine owned trees within budget',()=>{
  const base=campusBaseContactGeometry();
  assert.equal(base.sources.filter(s=>s.kind==='bench').length,4);
  for(const id of ['bldg_01','bldg_jungseok'])assert.ok(base.sources.some(s=>s.id.startsWith(id)));
  assert.ok(base.triangles<=CONTACT_BUDGET.baseTriangles);
  const near=RENDER_CHUNKS.map(c=>campusTreeContactGeometry(c)).filter(Boolean);
  assert.equal(near.length,2);
  assert.equal(near.reduce((s,d)=>s+d.sources.length,0),9);
  const data=[base,...near];
  assert.ok(data.reduce((s,d)=>s+d.triangles,0)<=CONTACT_BUDGET.totalTriangles);
  assert.ok(data.reduce((s,d)=>s+d.bufferBytes,0)<=CONTACT_BUDGET.bufferBytes);
  for(const d of data){
    assert.ok([...d.positions,...d.colors].every(Number.isFinite));
    assert.equal(d.colors.length,d.positions.length/3*4);
    for(let i=0;i<d.positions.length;i+=9){
      const [ax,,az,bx,,bz,cx,,cz]=d.positions.slice(i,i+9);
      assert.ok((bz-az)*(cx-ax)-(bx-ax)*(cz-az)>0,'faces point up');
    }
  }
  for(const s of base.sources.filter(s=>s.kind==='bench')){
    for(let i=s.first*9+1;i<(s.first+s.triangles)*9;i+=3)
      assert.ok(Math.abs(base.positions[i]-(GARDEN_FLOOR+.0015))<1e-9);
  }
});


test('latest main hall connectors and pond promenade do not overlap pilot contact receivers',async()=>{
  const {MAIN_HALL_WALKWAYS}=await import('../src/main-hall-walkway-layout.js');
  const {pondPromenadeCells,rectInFrame}=await import('../src/roadview-layout.js');
  const newReceivers=[...pondPromenadeCells(),...MAIN_HALL_WALKWAYS.map(q=>
    rectInFrame(q.frame,0,q.frame.length,-q.width/2,q.width/2))]
    .map((ring,i)=>({id:String(i),y:0,mask:contactMask(ring),exclude:[]}));
  const data=[campusBaseContactGeometry(),...RENDER_CHUNKS.map(campusTreeContactGeometry).filter(Boolean)];
  for(const d of data)for(let i=0;i<d.positions.length;i+=9){
    const triangle=[];
    for(let k=0;k<9;k+=3)triangle.push({x:d.positions[i+k],z:d.positions[i+k+2],alpha:.1});
    const overlap=buildContactGeometry([{id:String(i),kind:'test',pieces:[triangle]}],newReceivers);
    assert.equal(overlap.triangles,0,'existing ground ownership is preserved');
  }
});
