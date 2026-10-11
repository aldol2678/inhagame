// Exact-head hosted C04 acceptance. The normal app renders; only the server clock
// response and inspection camera are fixtures. No production network requests.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {C04_VIEWPORTS,assertC04Hosted,assertC04Frame} from './npc-c04-browser-qa.mjs';
import {worldTimePayload,NPC_WORLD_EPOCH_MS as E,NPC_WORLD_PERIOD_MS as P} from '../../npc-factory/npc-world-time-contract.mjs';
import {createNpcNavigator} from '../../npc-factory/dev-navigation.mjs';
import {createPurposefulRoster} from '../../npc-factory/purposeful-roster.mjs';
import {mergeCampusPopulation} from '../../npc-factory/npc-campus-expansion.mjs';
import {bindSharedSchedule} from '../../npc-factory/npc-shared-schedule.mjs';
assertC04Hosted(process.env);
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.EXPECTED_C04_HEAD);
const name=process.env.C04_VIEWPORT,config=C04_VIEWPORTS[name];
const output=process.env.C04_OUTPUT||`test-results/npc-c04/${name}`;
await mkdir(output,{recursive:true});
const report={head,viewport:name,dimensions:config,result:'RUNNING',scenes:[],limitations:['Offline Chromium/SwiftShader; not physical-device performance.','Pixels require independent review; state assertions alone do not establish natural pose or camera-lens direction.']};
const reportPath=path.join(output,'report.json');
const flush=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'head.txt'),head+'\n');await flush();
const watchdog=setTimeout(()=>{report.result='FAIL';report.error='C04 overall 18-minute deadline';writeFileSync(reportPath,JSON.stringify(report,null,2));process.exit(1)},18*60_000);
const read=async file=>JSON.parse(await readFile(new URL('../../npc-factory/data/'+file,import.meta.url),'utf8'));
const {batch}=mergeCampusPopulation(await read('repaired/INKYUNG-20-A-R1.json'),await read('fixtures/public-roster.json'),await read('expansion/CAMPUS-28-P2A.json'));
const navigator=createNpcNavigator(batch),roster=bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>E+2*P);
function arrival(id){let lo=0,hi=899;for(let i=0;i<30;i++){const mid=(lo+hi)/2;if(roster.get(id).controller.sample(E+2*P+mid*1000).phase==='MOVING')lo=mid;else hi=mid}assert.ok(hi>8);return hi}
const ids=['INKYUNG-NPC-009','INKYUNG-NPC-010'];
const arrivalById=Object.fromEntries(ids.map(id=>[id,arrival(id)]));report.lunchArrivalSeconds=arrivalById;
let smoke,page;let serverTime=E+2*P+799000,cycle=0;
try {
  const {startSmoke}=await import('./harness.mjs');
  smoke=await startSmoke({viewport:{width:config.width,height:config.height},contextOptions:{isMobile:config.mobile,hasTouch:config.mobile,deviceScaleFactor:1}});
  page=await smoke.context.newPage();const fatal=smoke.watch(page);
  page.setDefaultTimeout(90000);
  await page.route('**/api/world-time',route=>route.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify(worldTimePayload(serverTime))}));
  await page.goto(smoke.origin+'/campus/?npcSync=ng2&envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:120000});
  await Promise.race([page.waitForFunction(()=>{const n=window.__INHAGAME_P0__?.getStatus?.().npcTest;return n?.shared_schedule?.state==='SYNCED'&&n?.purposeful_count===46&&n.purposeful['INKYUNG-NPC-009']?.activity==='PHOTO'&&n.purposeful['INKYUNG-NPC-010']?.activity==='RESTING'},null,{timeout:120000}),fatal]);
  await page.evaluate(()=>{window.__C04_QA_FRAMES__=0;window.__INHAGAME_P0__.app.on('postrender',()=>window.__C04_QA_FRAMES__++)});
  async function syncTo(period,seconds){
    // Each observation advances one complete day. Never move the monotonic clock backwards.
    serverTime=E+(++cycle*5+period)*P+Math.round(seconds*1000);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await Promise.race([page.waitForFunction(target=>{const c=window.__INHAGAME_P0__?.getStatus?.().npcTest?.shared_schedule;return c?.state==='SYNCED'&&c.frameServerNowMs>=target&&c.frameServerNowMs<target+12000},serverTime,{timeout:15000}),fatal]);
  }
  async function capture(id,phase,label){
    // Inspection camera only: retain the actual NPC, props, benches and every HUD.
    // Keep the guest fallback avatar out of the shot instead of hiding any entity.
    await page.evaluate(id=>{
      const d=window.__INHAGAME_P0__,s=d.getStatus().npcTest.purposeful[id];
      d.player.setLocalPosition(s.position.x+5,d.controller.groundY,s.position.z+5);
      if(window.__C04_CAMERA__)d.app.off('prerender',window.__C04_CAMERA__);
      window.__C04_CAMERA__=()=>{const v=d.app.root.findByName('NPC_TEST_HUMAN_'+id),p=v.getPosition();
        d.orbit.camera.setPosition(p.x+2.4,p.y+1.2,p.z+(id.endsWith('009')?1.8:-1.8));
        d.orbit.camera.lookAt(p.x,p.y+.45,p.z);};
      d.app.on('prerender',window.__C04_CAMERA__);window.__C04_CAMERA__();
      window.__C04_CAPTURE_START__=window.__C04_QA_FRAMES__;
    },id);
    await Promise.race([page.waitForFunction(()=>window.__C04_QA_FRAMES__-window.__C04_CAPTURE_START__>=3,null,{timeout:30000}),fatal]);
    if(phase==='ACTING'&&id.endsWith('009'))await page.waitForFunction(()=>window.__INHAGAME_P0__.app.root.findByName('NPC_TEST_HUMAN_INKYUNG-NPC-009')?.findByName('NPC_Activity_compact_camera')?.enabled===true,null,{timeout:15000});
    const frame=await page.evaluate(async id=>{
      const [{SEAT_ANCHORS,SEAT_TOP_Y},{roadviewGroundHeight},{INKYUNG_PHOTO_POINT},{NPC_ACTIVITY_PROPS},{NPC_SEAT_ANCHOR_MODEL_Y}]=await Promise.all([import('/src/seat-anchors.js'),import('/src/roadview-layout.js'),import('/src/photo/inkyung-photo-point.js'),import('/src/life-props.js'),import('/npc-factory/npc-dimensions.mjs')]);
      const d=window.__INHAGAME_P0__,n=d.getStatus().npcTest,s=n.purposeful[id],v=d.app.root.findByName('NPC_TEST_HUMAN_'+id),p=v.getLocalPosition(),q=v.getLocalRotation(),seat=SEAT_ANCHORS.find(a=>a.id==='SEAT_INKYUNG_TREE_1_A'),target=INKYUNG_PHOTO_POINT.lookAt;
      const projected=v.getPosition().clone();projected.y+=.5;const screen=d.orbit.camera.camera.worldToScreen(projected);
      const world=v.getPosition(),corners=[];
      for(const x of [-.35,.35])for(const z of [-.35,.35])for(const y of [0,2.37*v.getLocalScale().y]){
        const point=world.clone();point.x+=x;point.y+=y;point.z+=z;corners.push(d.orbit.camera.camera.worldToScreen(point));}
      const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
      const avatarBounds={x:left,y:top,width:Math.max(...corners.map(p=>p.x))-left,height:Math.max(...corners.map(p=>p.y))-top};
      const hud=[...document.querySelectorAll('#inkyung-living-moment,#minimap,#quest-hud,#tour,.campus-topbar > *,.social-cluster > button,#joystick,#run,#jump,#transport-action')].filter(e=>{const c=getComputedStyle(e);return !e.hidden&&c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)>0}).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,x:r.x,y:r.y,width:r.width,height:r.height}}).filter(r=>r.width>0&&r.height>0);
      const others=Object.entries(n.purposeful).filter(([other,x])=>other!==id&&x.visible).map(([other,x])=>({id:other,distance:Math.hypot(x.position.x-s.position.x,x.position.z-s.position.z)})).sort((a,b)=>a.distance-b.distance);
      return {cameraMode:'inspection camera; actual scene and HUD retained',avatarBounds,hud,actor:s,clock:n.shared_schedule,count:n.purposeful_count,renderer:d.getStatus().renderer,renderedFrames:window.__C04_QA_FRAMES__-window.__C04_CAPTURE_START__,viewport:{width:innerWidth,height:innerHeight},screen:{x:screen.x,y:screen.y},render:{enabled:v.enabled,position:{x:p.x,y:p.y,z:p.z},heading:Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y))*180/Math.PI,seatAnchorY:p.y+NPC_SEAT_ANCHOR_MODEL_Y*v.getLocalScale().y},seat,seatTopY:roadviewGroundHeight(seat.position.x,seat.position.z)+SEAT_TOP_Y,photoTargetYaw:Math.atan2(target.x-s.position.x,target.z-s.position.z)*180/Math.PI,photoPropVisible:v.findByName('NPC_Activity_'+NPC_ACTIVITY_PROPS.PHOTO.id)?.enabled===true,nearest:others.slice(0,3)};
    },id);
    const screenshot=`${name}-${id.slice(-3)}-${label}.png`;
    await page.screenshot({path:path.join(output,screenshot)});
    report.scenes.push({label,id,screenshot,...frame});await flush();
    assertC04Frame(frame,{id,phase});
    assert.ok(frame.nearest.every(x=>x.distance>=.6),'sampled scene has no target-NPC overlap');
    return frame;
  }
  for(const id of ids)await capture(id,'ACTING','lunch');
  for(const id of ids){await syncTo(2,arrivalById[id]-6);const a=await capture(id,'MOVING','approach');await page.waitForTimeout(250);const b=await page.evaluate(id=>{const n=window.__INHAGAME_P0__.getStatus().npcTest;return {state:n.purposeful[id],time:n.shared_schedule.frameServerNowMs}},id);const dt=(b.time-a.clock.frameServerNowMs)/1000;assert.ok(dt>=0&&Math.hypot(b.state.position.x-a.actor.position.x,b.state.position.z-a.actor.position.z)<=2*dt+.05,'approach is continuous');await page.waitForFunction(id=>window.__INHAGAME_P0__.getStatus().npcTest.purposeful[id]?.phase==='ACTING',id,{timeout:30000});await capture(id,'ACTING','arrived');}
  for(const id of ids){await syncTo(2,880);await capture(id,'ACTING','before-departure');await page.waitForFunction(id=>{const n=window.__INHAGAME_P0__.getStatus().npcTest;return n.period==='evening'&&n.purposeful[id]?.phase==='MOVING'},id,{timeout:45000});const a=await capture(id,'MOVING','departure');await page.waitForTimeout(250);const b=await page.evaluate(id=>{const n=window.__INHAGAME_P0__.getStatus().npcTest;return {state:n.purposeful[id],time:n.shared_schedule.frameServerNowMs}},id);const dt=(b.time-a.clock.frameServerNowMs)/1000;assert.ok(dt>=0&&Math.hypot(b.state.position.x-a.actor.position.x,b.state.position.z-a.actor.position.z)<=2*dt+.05,'departure is continuous');}
  assert.deepEqual(smoke.problems,[]);report.result='PASS';report.problems=smoke.problems;await flush();
  const hashes=[];for(const scene of report.scenes){const bytes=await readFile(path.join(output,scene.screenshot));hashes.push(createHash('sha256').update(bytes).digest('hex')+'  '+scene.screenshot)}await writeFile(path.join(output,'SHA256SUMS'),hashes.join('\n')+'\n');
  console.log('C04 actual-browser PASS',JSON.stringify({head,viewport:name,scenes:report.scenes.length}));
}catch(error){report.result='FAIL';report.error=String(error.stack||error);report.problems=smoke?.problems??[];await flush();throw error}finally{clearTimeout(watchdog);await page?.close();await smoke?.close()}
