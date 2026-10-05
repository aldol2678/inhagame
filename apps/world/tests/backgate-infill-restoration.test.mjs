import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,export const unused=1',shortCircuit:true}:next(s,c)}});
const {FacilityMeshBatch}=await import('../src/facility-mesh-batch.js');
const {BACK_ALLEY_BLOCKS,BACK_ALLEY_COLLIDERS}=await import('../src/back-alley-layout.js');
const {MARKET_BUILDINGS,MARKET_COLLIDERS,MARKET_EXISTING_SHOPS,GEONMULJU_BUILDING}=await import('../src/back-market-layout.js');
const alley=await import('../src/back-alley-geometry.js');
const market=await import('../src/back-market-geometry.js');
const genericMarket=MARKET_BUILDINGS.filter(q=>q!==GEONMULJU_BUILDING);
const targets=[...BACK_ALLEY_BLOCKS,...genericMarket];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record=()=>{const operations=[];return {operations,batch:Object.fromEntries(['box','tube','quad','triangle','crown'].map(k=>[k,(...args)=>operations.push([k,...args])]))}};
const geometryPoints=b=>[...b.groups.values()].flatMap(g=>Array.from({length:g.positions.length/3},(_,i)=>g.positions.slice(i*3,i*3+3)));

test('all 114 residual QA bodies receive persistent glazing and real roof profiles',()=>{
  assert.equal(targets.length,114);
  for(const [fill,minimum] of [[alley.fillBackAlleyBase,35],[market.fillMarketBase,79]]){
    const b=new FacilityMeshBatch();fill(b);
    assert.equal(b.groups.get('#598f91')?.indices.length||0,0,'cyan QA shell must not survive');
    assert.ok((b.groups.get('#396773')?.indices.length||0)/3>=minimum*24,'ground and upper glazing must survive BASE-only LOD');
    assert.ok(b.groups.has('#687472'),'roof surface uses current roof material');
    assert.ok(b.groups.size>=6&&b.groups.size<=18,'shared material count stays bounded');
  }
});

test('alley and infill detailed tiers are deterministic and ID-scoped',()=>{
  for(const q of targets){
    const m=BACK_ALLEY_BLOCKS.includes(q)?alley:market,prefix=BACK_ALLEY_BLOCKS.includes(q)?'fillBackAlley':'fillMarket';
    for(const tier of ['Near','Detail']){
      const a=record(),b=record();assert.equal(m[prefix+tier](a.batch,[q.id]),a.batch);m[prefix+tier](b.batch,[q.id]);
      assert.deepEqual(a.operations,b.operations);assert.ok(a.operations.length>=4,q.id+' '+tier+' missing restored facade features');
    }
  }
  for(const fill of [alley.fillBackAlleyNear,alley.fillBackAlleyDetail,market.fillMarketNear,market.fillMarketDetail]){
    const r=record();fill(r.batch,['unknown']);assert.deepEqual(r.operations,[]);
  }
});

test('collision facts and previously detailed market dressing stay byte-equivalent',()=>{
  assert.equal(hash([...BACK_ALLEY_COLLIDERS,...MARKET_COLLIDERS]),'c517f26eefe39bd427815e5fd4325c1c9c61c8c9a16b13689e387d49fb8ffe6e');
  const r=record(),ids=MARKET_EXISTING_SHOPS.map(q=>q.id);market.fillMarketNear(r.batch,ids);market.fillMarketDetail(r.batch,ids);
  assert.equal(hash(r.operations),'19eb0fe3084f597a5843eadff3b803e218641883b3661e3b8003d3e7c282488c');
});

const {fillInfillBase,fillInfillNear,fillInfillDetail,infillProfile}=await import('../src/backgate-infill-geometry.js');
const {backApproachClear}=await import('../src/back-approach-layout.js');
const {RENDER_CHUNKS}=await import('../src/render-chunk-registry.js');

test('every restored shell keeps exact body corners and top within its unchanged collider',()=>{
  for(const q of targets){
    const kind=BACK_ALLEY_BLOCKS.includes(q)?'alley':'market',p=infillProfile(q,kind),r=record();fillInfillBase(r.batch,q,kind);
    const body=r.operations[0];assert.equal(body[0],'box');assert.deepEqual(body[3],[q.w,q.h,q.d]);
    const center=q.frame.at(0,q.d/2);assert.deepEqual(body[2],[center.x,q.h/2,center.z]);
    const collider=[...BACK_ALLEY_COLLIDERS,...MARKET_COLLIDERS].find(c=>c.id===q.id);
    assert.equal(p.roofHeight,collider.maxY);
    const b=new FacilityMeshBatch();fillInfillBase(b,q,kind);
    const points=geometryPoints(b);assert.ok(Math.abs(Math.max(...points.map(p=>p[1]))-collider.maxY)<1e-8);
    assert.ok(points.every(p=>p[1]>=0&&p[1]<=collider.maxY+1e-8));
    const panes=r.operations.filter(([primitive,color,pos])=>primitive==='box'&&color==='#396773'&&pos[1]>2);
    assert.equal(panes.length,p.rows.length*p.columns);
    assert.ok(panes.every(([, ,pos,size])=>pos[1]+size[1]/2<q.h));
  }
});

test('all restored vertices stay in their chunk and clear of current mapped road corridors',()=>{
  let triangles=0;const palette=new Set();
  for(const q of targets){
    const kind=BACK_ALLEY_BLOCKS.includes(q)?'alley':'market',b=new FacilityMeshBatch();
    for(const fill of [fillInfillBase,fillInfillNear,fillInfillDetail])fill(b,q,kind);
    const owners=RENDER_CHUNKS.filter(c=>c.streetscape.includes(q.id));assert.equal(owners.length,1,q.id);
    const bounds=owners[0].bounds,f=q.frame,o=f.at(0),u=f.at(1),v=f.at(0,1);
    for(const p of geometryPoints(b)){
      const localX=(p[0]-o.x)*(u.x-o.x)+(p[2]-o.z)*(u.z-o.z);
      const localZ=(p[0]-o.x)*(v.x-o.x)+(p[2]-o.z)*(v.z-o.z);
      assert.ok(Math.abs(localX)<=q.w/2+1e-7&&localZ>=-.551&&localZ<=q.d+1e-7,q.id+' exceeds local visual envelope');
      assert.ok(p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[2]>=bounds.minZ&&p[2]<=bounds.maxZ,q.id+' escapes owner');
      assert.ok(backApproachClear({x:p[0],z:p[2]}),q.id+' crosses mapped road');
    }
    for(const [color,g] of b.groups){palette.add(color);triangles+=g.indices.length/3;}
  }
  assert.ok(triangles<65000,triangles);assert.ok(palette.size<=12,palette.size);
});

test('the previously restored 37 facades, all west buildings and inner residential geometry are unchanged',async()=>{
  const {BACK_STREET_BLOCKS}=await import('../src/back-street-layout.js');
  const {CULTURE_BUILDINGS}=await import('../src/culture-street-layout.js');
  const {fillShopfrontBase,fillShopfrontNear,fillShopfrontDetail}=await import('../src/backgate-shopfront-geometry.js');
  const r=record();for(const q of [...BACK_STREET_BLOCKS,...CULTURE_BUILDINGS])for(const fill of [fillShopfrontBase,fillShopfrontNear,fillShopfrontDetail])fill(r.batch,q);
  assert.equal(hash(r.operations),'c2319a3cb7f3926aaedbf1b2997d2fef4714d6c15208ca2d19c8b80dd7966aaf');
  for(const [module,prefix,layout,lists,digest] of [
    ['back-west','BackWest','back-west',['BACK_WEST_BUILDINGS'],'c0e99a7e607b8b7731595a744fb208f2bdcedfbe8212c0e827fa84a08dd8e150'],
    ['market-interior','Interior','market-interior',['INTERIOR_BUILDINGS','INTERIOR_REAR_FACADES'],'f2fdf3c20a6759e1b97ec9f9656ec15153e8d40a05caeaa46083f67103f30517']
  ]){
    const m=await import(`../src/${module}-geometry.js`),l=await import(`../src/${layout}-layout.js`),ids=lists.flatMap(key=>l[key]).map(q=>q.id),r=record();
    for(const tier of ['Base','Near','Detail'])m[`fill${prefix}${tier}`](r.batch,ids);
    assert.equal(hash(r.operations),digest);
  }
});

test('existing sign lettering stays street-side of every opaque fascia backing',async()=>{
  const {MARKET_SIGNS}=await import('../src/back-market-layout.js');
  for(const q of targets){
    const kind=BACK_ALLEY_BLOCKS.includes(q)?'alley':'market',p=infillProfile(q,kind),r=record();fillInfillBase(r.batch,q,kind);
    const fascia=r.operations.find(([primitive,color,pos])=>primitive==='box'&&color===p.sign&&pos[1]===p.signY);
    const origin=q.frame.at(0),inward=q.frame.at(0,1),v=point=>(point[0]-origin.x)*(inward.x-origin.x)+(point[2]-origin.z)*(inward.z-origin.z);
    const surface=v(fascia[2])-fascia[3][2]/2,sign=MARKET_SIGNS.find(s=>s.id===q.id);
    assert.ok(sign.corners.every(c=>v(c)<surface-.008),q.id+' label is buried in opaque fascia');
  }
});

test('restored door frames remain recessed behind the preserved alley shutter face',()=>{
  for(const shop of MARKET_EXISTING_SHOPS.filter(q=>q.kind==='alley'&&q.treatment==='shutter')){
    const q=BACK_ALLEY_BLOCKS.find(q=>q.id===shop.id),r=record();fillInfillNear(r.batch,q,'alley');
    const origin=q.frame.at(0),inward=q.frame.at(0,1);
    const frames=r.operations.filter(([primitive,color,p,size])=>primitive==='box'&&color==='#505b5b'&&size[1]===1.48);
    for(const [, ,p,size] of frames){
      const v=(p[0]-origin.x)*(inward.x-origin.x)+(p[2]-origin.z)*(inward.z-origin.z);
      assert.ok(v-size[2]/2>-.105+.015,q.id+' door frame fights with existing shutter');
    }
  }
});

test('closed door caps are vertically inset from the overlapping glazing caps',()=>{
  for(const q of targets){
    const r=record();fillInfillBase(r.batch,q,BACK_ALLEY_BLOCKS.includes(q)?'alley':'market');
    const pane=r.operations.find(([k,c,p])=>k==='box'&&c==='#396773'&&p[1]<2);
    const door=r.operations.find(([k,c])=>k==='box'&&c==='#486271');
    assert.ok(door[2][1]+door[3][1]/2<pane[2][1]+pane[3][1]/2-.015,q.id+' top caps overlap');
    assert.ok(door[2][1]-door[3][1]/2>pane[2][1]-pane[3][1]/2+.015,q.id+' bottom caps overlap');
  }
});


test('dedicated Geonmulju venue base and detailed geometry are unchanged',()=>{
  const r=record();market.fillMarketBase(r.batch);
  // Dedicated venue is emitted after generic infill; preserve its nine base boxes.
  const operations=r.operations.slice(-9),near=record(),detail=record();
  market.fillMarketNear(near.batch,[GEONMULJU_BUILDING.id]);market.fillMarketDetail(detail.batch,[GEONMULJU_BUILDING.id]);
  operations.push(...near.operations,...detail.operations);
  assert.equal(hash(operations),'6224a0714af5a8ec62753889615f6da9c142673cda6cc7332e0ad753084e90c5');
});
