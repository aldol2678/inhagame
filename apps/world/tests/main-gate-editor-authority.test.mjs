import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld } from '../src/editor/world-schema.js';
import { MAIN_GATE_EDITOR_WORLD, MAIN_GATE_EDITOR_PRODUCTION_IDS, mainGateProductionPath, mainGateProductionStructure } from '../src/editor/main-gate-production.js';
import { GATE_DORM_ROADS, GATE_DORM_PATHS, GATE_DORM_CROSSINGS, MAIN_GATE_INNER_ZEBRA } from '../src/main-gate-road-layout.js';
import { GATE_FRAME, GATE_BOOTH, ROADVIEW_OBSTACLES, rectInFrame } from '../src/roadview-layout.js';
import { DORM_1_FRAME } from '../src/dorm1-layout.js';
import { OBSTACLES } from '../src/campus-layout.js';

const canonical=JSON.parse(readFileSync(new URL('../data/editor/main-gate.world.json',import.meta.url),'utf8'));

test('main gate committed WorldDocument is valid and carries the production adapter contract',()=>{
  const result=validateWorld(canonical);
  assert.equal(result.valid,true,result.errors.map(e=>e.code).join(','));
  assert.equal(canonical.worldId,'inha-world-main-gate');
  assert.equal(canonical.metadata.productionAdapter,'main-gate-v1');
  assert.equal(canonical.metadata.coordinateFrame,'gate-local-meters');
  assert.equal(canonical.entities.length,32);
  assert.deepEqual(MAIN_GATE_EDITOR_WORLD,canonical);
});

test('production main-gate corridors are derived from editor entities, not duplicated literals',()=>{
  const expected=canonical.entities.map(e=>e.metadata.production.id).sort();
  const expectedPaths=canonical.entities.filter(e=>e.components['world.path']&&e.metadata.production.role!=='curb-return')
    .map(e=>e.metadata.production.id).sort();
  assert.deepEqual([...MAIN_GATE_EDITOR_PRODUCTION_IDS].sort(),expected);
  const production=[...GATE_DORM_ROADS,...GATE_DORM_PATHS,...GATE_DORM_CROSSINGS,MAIN_GATE_INNER_ZEBRA];
  assert.deepEqual(production.map(p=>p.id).sort(),expectedPaths);
  for(const item of production){
    const fromEditor=mainGateProductionPath(item.id);
    assert.equal(item.width,fromEditor.width,item.id);
    assert.deepEqual(item.vertices,fromEditor.vertices,item.id);
    assert.equal(item.editorEntityId,fromEditor.editorEntityId,item.id);
  }
});

test('Dormitory 1 connector preserves the previous runtime anchors while becoming editor-authored',()=>{
  const path=GATE_DORM_PATHS.find(item=>item.id==='dorm1_entry_path');
  assert.ok(path);
  assert.equal(path.width,2.8);
  const expected=[GATE_FRAME.at(39,-20),DORM_1_FRAME.at(0,7),DORM_1_FRAME.at(0,.65)];
  assert.equal(path.vertices.length,expected.length);
  path.vertices.forEach((point,index)=>{
    assert.ok(Math.hypot(point.x-expected[index].x,point.z-expected[index].z)<1e-6,'anchor '+index);
  });
  assert.equal(path.editorEntityId,'entity.main-gate.dorm1-entry-path');
});

test('traffic island structures are editor-authored without changing production geometry',()=>{
  const base=mainGateProductionStructure('gate_traffic_island_base');
  const green=mainGateProductionStructure('gate_traffic_island_green');
  const center=GATE_FRAME.at(-2,7);
  assert.deepEqual(base.position,[center.x,.09,center.z]);
  assert.deepEqual(base.size,[.9,.18,4]);
  assert.equal(base.color,'#cac9b8');
  assert.ok(Math.abs(base.yaw-GATE_FRAME.yaw)<1e-9);
  assert.deepEqual(green.position,[center.x,.19,center.z]);
  assert.deepEqual(green.size,[.65,.03,3.65]);
  assert.equal(green.color,'#739057');
});

test('guardhouse body and collision footprint are editor-authored with legacy parity',()=>{
  const booth=mainGateProductionStructure('gate_security_booth');
  const center=GATE_FRAME.at(12,3.1);
  assert.deepEqual(booth.position,[center.x,1.2,center.z]);
  assert.deepEqual(booth.size,[4,2.4,3.8]);
  assert.equal(booth.color,'#9c7864');
  assert.equal(booth.collisionMaxY,2.5);
  assert.ok(Math.abs(booth.yaw-GATE_FRAME.yaw)<1e-9);
  const legacy=rectInFrame(GATE_FRAME,10,14,1.2,5);
  assert.equal(booth.footprint.length,legacy.length);
  booth.footprint.forEach((point,index)=>
    assert.ok(Math.hypot(point.x-legacy[index].x,point.z-legacy[index].z)<1e-9,'footprint '+index));
  assert.deepEqual(GATE_BOOTH,booth.footprint);
  const collider=ROADVIEW_OBSTACLES.find(item=>item.id==='gate_security_booth');
  assert.deepEqual(collider.polygon,booth.footprint);
  assert.equal(collider.maxY,2.5);
});

test('guardhouse body renderer no longer owns a duplicate polygon literal',()=>{
  const roadview=readFileSync(new URL('../src/roadview-details.js',import.meta.url),'utf8');
  assert.doesNotMatch(roadview,/polygon\(root,'gate_security_booth'/);
  assert.match(roadview,/mainGateProductionStructure\('gate_security_booth'\)/);
});

test('both gate walls, caps and colliders are editor-authored with legacy parity',()=>{
  const pointSet=points=>points.map(p=>`${p.x.toFixed(9)},${p.z.toFixed(9)}`).sort();
  for(const side of [-1,1]){
    const body=mainGateProductionStructure(`gate_wall_${side}`);
    const cap=mainGateProductionStructure(`gate_wall_${side}_cap`);
    const center=GATE_FRAME.at(side*16,0);
    assert.deepEqual(body.position,[center.x,.75,center.z]);
    assert.deepEqual(body.size,[16,1.5,1.2]);
    assert.equal(body.color,'#c9c3b5');
    assert.equal(body.collisionMaxY,1.6);
    assert.deepEqual(cap.position,[center.x,1.55,center.z]);
    assert.deepEqual(cap.size,[16,.1,1.2]);
    assert.equal(cap.color,'#49545a');
    const legacy=[[side*8,-.6],[side*24,-.6],[side*24,.6],[side*8,.6]].map(([u,v])=>GATE_FRAME.at(u,v));
    assert.deepEqual(pointSet(body.footprint),pointSet(legacy));
    const collider=OBSTACLES.find(item=>item.id===`gate_wall_${side}`);
    assert.ok(collider);
    assert.deepEqual(pointSet(collider.polygon),pointSet(body.footprint));
    assert.equal(collider.minY,0);
    assert.equal(collider.maxY,1.6);
  }
});

test('gate renderer and basic campus no longer own duplicate wall geometry',()=>{
  const basic=readFileSync(new URL('../src/basic-campus.js',import.meta.url),'utf8');
  const blockout=readFileSync(new URL('../src/gate-blockout.js',import.meta.url),'utf8');
  assert.doesNotMatch(basic,/GATE_WALLS/);
  assert.doesNotMatch(blockout,/polygon\(root,wall/);
  assert.match(blockout,/mainGateProductionStructure\(id\)/);
});

test('curved curb return paths are editor-authored with legacy centerline parity',()=>{
  for(const side of [-1,1]){
    const id=side<0?'gate_curb_west':'gate_curb_east';
    const curb=mainGateProductionPath(id);
    const expected=[[-7,8],[0,8],[7,10],[11,13]].map(([v,u])=>GATE_FRAME.at(side*u,v));
    assert.equal(curb.role,'curb-return');
    assert.equal(curb.side,side);
    assert.equal(curb.width,.2);
    assert.equal(curb.vertices.length,expected.length);
    curb.vertices.forEach((point,index)=>
      assert.ok(Math.hypot(point.x-expected[index].x,point.z-expected[index].z)<1e-9,'curb '+side+' point '+index));
  }
});

test('gate roadview no longer owns the curved curb control-point literal',()=>{
  const roadview=readFileSync(new URL('../src/roadview-details.js',import.meta.url),'utf8');
  assert.doesNotMatch(roadview,/\[\[-7,8\],\[0,8\],\[7,10\],\[11,13\]\]/);
  assert.match(roadview,/mainGateProductionPath\(id\)/);
});

test('guardhouse fascia/window/plinth details are editor-authored with legacy parity',()=>{
  const expected=[
    ['gate_booth_roof_fascia',12,2.45,3.1,4.4,.24,4.2,'#eeeadd'],
    ['gate_booth_front_glass',12,1.35,1.16,2.8,.9,.08,'#345260'],
    ['gate_booth_side_panel',9.96,.9,3.9,.08,1.8,.85,'#34494b'],
    ['gate_booth_detail_fascia',12,2.15,1.1,3.9,.27,.12,'#dadbd1'],
    ['gate_booth_roof_trim',12,2.48,3.1,4.5,.09,4.3,'#536462'],
    ['gate_booth_window_bar_0',10.55,1.35,1.1,.055,.92,.07,'#c9cfc7'],
    ['gate_booth_window_bar_1',11.5,1.35,1.1,.055,.92,.07,'#c9cfc7'],
    ['gate_booth_window_bar_2',12.5,1.35,1.1,.055,.92,.07,'#c9cfc7'],
    ['gate_booth_window_bar_3',13.45,1.35,1.1,.055,.92,.07,'#c9cfc7'],
    ['gate_booth_window_horizontal',12,1.35,1.08,2.9,.045,.07,'#c9cfc7'],
    ['gate_booth_plinth_0',12,.3,1.185,3.8,.025,.02,'#b69883'],
    ['gate_booth_plinth_1',12,.6,1.185,3.8,.025,.02,'#b69883'],
    ['gate_booth_plinth_2',12,.9,1.185,3.8,.025,.02,'#b69883']
  ];
  for(const [id,u,y,v,w,h,d,color] of expected){
    const item=mainGateProductionStructure(id),center=GATE_FRAME.at(u,v);
    assert.ok(Math.hypot(item.position[0]-center.x,item.position[2]-center.z)<1e-9,id+' center');
    assert.equal(item.position[1],y,id+' y');
    assert.deepEqual(item.size,[w,h,d],id+' size');
    assert.equal(item.color,color,id+' color');
    assert.ok(Math.abs(item.yaw-GATE_FRAME.yaw)<1e-9,id+' yaw');
  }
});

test('guardhouse renderers no longer own duplicate trim/window/plinth geometry literals',()=>{
  const roadview=readFileSync(new URL('../src/roadview-details.js',import.meta.url),'utf8');
  const detail=readFileSync(new URL('../src/main-gate-detail.js',import.meta.url),'utf8');
  assert.doesNotMatch(roadview,/frameBox\(b,f,'#eeeadd',12,3\.1,2\.45/);
  assert.doesNotMatch(roadview,/frameBox\(b,f,'#345260',12,1\.16,1\.35/);
  assert.doesNotMatch(detail,/box\('#dadbd1',12,2\.15,1\.1/);
  assert.doesNotMatch(detail,/for\(const u of \[10\.55,11\.5,12\.5,13\.45\]\)box/);
  assert.match(roadview,/gate_booth_roof_fascia/);
  assert.match(detail,/gate_booth_window_bar_0/);
});

test('editor UI exposes generic box Structure placement and geometry editing',()=>{
  const html=readFileSync(new URL('../editor/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/editor/editor-app.js',import.meta.url),'utf8');
  assert.match(html,/data-placement-tool="structure"/);
  assert.match(app,/Structure Geometry/);
  assert.match(app,/world\.structure","sizeMeters"/);
});

test('editor UI exposes Main Gate canonical open and editable path geometry',()=>{
  const html=readFileSync(new URL('../editor/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/editor/editor-app.js',import.meta.url),'utf8');
  assert.match(html,/id="editor-open-main-gate"/);
  assert.match(app,/\/data\/editor\/main-gate\.world\.json/);
  assert.match(app,/Path Geometry · production/);
  assert.match(app,/setComponentField\(entity\.id,"world\.path","widthMeters"/);
  assert.match(app,/setComponentField\(entity\.id,"world\.path","points"/);
});
