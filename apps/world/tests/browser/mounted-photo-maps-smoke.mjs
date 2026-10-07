// Real campus controllers and real Chromium rendering, offline guest; no Production requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.MOUNTED_PHOTO_HEAD_SHA)assert.equal(head,process.env.MOUNTED_PHOTO_HEAD_SHA);
const output=process.env.MOUNTED_PHOTO_OUTPUT||'test-results/mounted-photo-maps';await mkdir(output,{recursive:true});
const sources=['src/main.js','src/player-controller.js','src/character-model.js','src/photo/photo-mode.js','src/photo/photo-camera-controller.js','src/phone/smartphone.js','src/phone/phone-surfaces.js','src/minimap/full-map-controller.js','phone.css'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(new URL(`../../${p}`,import.meta.url))).digest('hex')])));
const report={head,sourceHashes:hashes,status:'RUNNING',cases:[],limits:['Offline guest Chromium + software WebGL2. Physical Android/iOS Safari, hardware WebGPU and authenticated server integration are unverified.']};
const save=()=>writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
const frames=async(page,count=2)=>{const at=await page.evaluate(()=>window.__INHAGAME_P0__.app.frame);await page.waitForFunction(({at,count})=>window.__INHAGAME_P0__.app.frame>=at+count,{at,count},{timeout:120000});};
const snapshot=page=>page.evaluate(()=>{const d=window.__INHAGAME_P0__,p=d.player.getLocalPosition(),c=d.orbit.camera,r=c.getRotation(),cp=c.getPosition();return {position:[p.x,p.y,p.z],camera:[cp.x,cp.y,cp.z],rotation:[r.x,r.y,r.z,r.w],fov:c.camera.fov,mounted:d.controller.mounted,mountId:d.controller.mountId,held:d.controller.photoHolding,input:d.controller.inputEnabled,orbitInput:d.orbit.inputEnabled,orbit:{yaw:d.orbit.yaw,pitch:d.orbit.pitch,distance:d.orbit.distance,firstPerson:d.orbit.firstPerson,mounted:d.orbit.mounted,profile:d.orbit.flightProfile},photo:d.photoMode.active,rig:d.photoMode.active?d.photoMode.saved:null,phone:d.smartphone.shell.state,focus:d.getStatus().inputFocus,touch:d.controller.touchVector};});
async function screen(page,entry,name){const path=`${entry.name}-${name}.png`;await page.screenshot({path:`${output}/${path}`,timeout:60000});entry.screenshots.push(path);}
async function boot(smoke,entry){const page=await smoke.context.newPage();page.setDefaultTimeout(60000);smoke.watch(page);await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});
  const served=await page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async p=>{const b=await(await fetch('/'+p)).arrayBuffer();return [p,[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('')];}))),sources);assert.deepEqual(served,hashes);await frames(page,2);return page;}
async function setupMount(page,kind){return page.evaluate(async kind=>{
  const d=window.__INHAGAME_P0__,c=d.controller;
  if(kind==='ground'){
    const {MAIN_GATE_CAMPUS_BIKE:a}=await import('/src/mounts/campus-bike-world.js');
    d.player.setLocalPosition(a.x,c.groundY+(c.space.groundHeight?.(a.x,a.z)||0),a.z);c.grounded=true;
    return c.boardBike();
  }
  if(kind==='water'){
    const {INKYUNG_DOCK}=await import('/src/mounts/duck-boat-motion.js'),a=INKYUNG_DOCK.shore;
    d.player.setLocalPosition(a.x,c.groundY+(c.space.groundHeight?.(a.x,a.z)||0),a.z);c.grounded=true;return c.boardDuckBoat();
  }
  const {getCampusHelicopterParkedPose}=await import('/src/mounts/campus-helicopter-world.js'),a=getCampusHelicopterParkedPose();
  d.player.setLocalPosition(a.x,c.groundY+(c.space.groundHeight?.(a.x,a.z)||0),a.z);c.grounded=true;return c.boardHelicopter();
},kind);}
async function move(page,code,n=6){await page.locator('#application').focus();await page.keyboard.down(code);await frames(page,n);await page.keyboard.up(code);await frames(page,2);}
async function capture(page,entry,kind){const promise=page.waitForEvent('download',{timeout:120000});promise.catch(()=>{});await page.locator('[data-photo-control="capture"]').click();await page.waitForFunction(()=>!window.__INHAGAME_P0__.photoModePanel.status().busy,null,{timeout:30000});assert.doesNotMatch(await page.locator('[data-photo-control="status"]').innerText(),/PNG를 만들지 못/);const download=await promise;const path=`${entry.name}-${kind}-capture.png`;await download.saveAs(`${output}/${path}`);const bytes=await readFile(`${output}/${path}`);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(bytes.length>5000);
  await page.waitForFunction(()=>!window.__INHAGAME_P0__.photoModePanel.status().busy,null,{timeout:120000});
  const albums=await page.evaluate(async()=>{const a=window.__INHAGAME_P0__.smartphone.album,records=await a.list(),r=records[0],blob=await a.image(r.id),bitmap=await createImageBitmap(blob);const result={record:r,size:[bitmap.width,bitmap.height],type:blob.type};bitmap.close();return result;});
  assert.ok(albums.record);assert.notEqual(albums.record.imageRef,albums.record.thumbnailRef);assert.equal(albums.type,'image/png');assert.ok(Math.max(...albums.size)>256);entry.captures.push({kind,path,...albums});}
async function photoCase(smoke,entry,kind,mobile){let page=await boot(smoke,entry);try{
  assert.equal(await setupMount(page,kind),true,`${kind} real boarding`);await frames(page,3);
  if(kind==='air'){await move(page,'Space',20);assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.controller.grounded),false);}
  const at=await snapshot(page);await move(page,'KeyW',8);const moving=await snapshot(page);assert.ok(Math.hypot(...moving.position.map((n,i)=>n-at.position[i]))>.001,`${kind} moves before photo`);
  const phoneOrigin=kind==='water';if(phoneOrigin){await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="camera"]').click();}else{await page.locator('#photo-mode-toggle').click();}
  await page.waitForFunction(()=>window.__INHAGAME_P0__.photoMode.active);const opened=await snapshot(page),saved=opened.rig;
  assert.equal(opened.held,true);assert.equal(opened.input,false);assert.equal(opened.orbitInput,false);assert.deepEqual(opened.focus.topOwners,['photo-mode']);
  await frames(page,10);const holding=await snapshot(page);assert.deepEqual(holding.position,opened.position,`${kind} exact stationary hold including altitude`);
  const photoRig=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().photoMode.camera);assert.ok(photoRig.subjectBounds);entry.subjects.push({kind,bounds:photoRig.subjectBounds,travel:photoRig.travel,framing:photoRig.position});
  // All eight corners of the rider+vehicle union fit on the canvas at the default frame.
  const projection=await page.evaluate(async()=>{const pc=await import('playcanvas'),d=window.__INHAGAME_P0__,b=d.getStatus().photoMode.camera.subjectBounds,c=d.orbit.camera.camera,canvas=document.getElementById('application');
    const points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=c.worldToScreen(new pc.Vec3(x,y,-z));points.push({x:p.x,y:p.y,z:p.z});}return {points,width:canvas.width,height:canvas.height};});
  entry.subjects.at(-1).projection=projection;assert.ok(projection.points.every(p=>p.x>=-2&&p.y>=-2&&p.x<=projection.width+2&&p.y<=projection.height+2),`${kind} full bounds fit: ${JSON.stringify(projection)}`);
  await screen(page,entry,`${kind}-mounted-photo`);console.log(`${entry.name}/${kind}: framed`);
  const beforePhoto=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().photoMode.camera);
  const canvas=page.locator('#application'),box=await canvas.boundingBox();
  if(mobile){const cdp=await smoke.context.newCDPSession(page),point={x:box.width*.5,y:box.height*.4,id:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x+30}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const a={x:point.x-30,y:point.y,id:1},b={x:point.x+30,y:point.y,id:2};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:a.x-15},{...b,x:b.x+15}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const pad=await page.locator('[data-photo-control="pad"]').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x+pad.width/2,y:pad.y+6,id:3}]});await frames(page,4);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{await page.mouse.move(box.width*.5,box.height*.4);await page.mouse.down();await page.mouse.move(box.width*.5+40,box.height*.4,{steps:3});await page.mouse.up();await page.mouse.wheel(0,-200);await page.locator('#application').focus();await page.keyboard.down('KeyE');await frames(page,4);await page.keyboard.up('KeyE');}
  await frames(page,3);const afterPhoto=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().photoMode.camera);
  assert.notEqual(afterPhoto.yaw,beforePhoto.yaw);assert.ok(afterPhoto.fov<beforePhoto.fov);assert.notDeepEqual(afterPhoto.position,beforePhoto.position);
  assert.deepEqual((await snapshot(page)).position,opened.position);console.log(`${entry.name}/${kind}: gestures done`);await capture(page,entry,kind);console.log(`${entry.name}/${kind}: captured`);
  await page.locator('[data-photo-control="settings"]').click();await page.locator('[data-photo-control="reset"]').click();await page.locator('[data-photo-control="settings"]').click();
  const reset=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().photoMode.camera);for(const axis of ['x','y','z'])assert.equal(reset.position[axis],reset.entry[axis]);
  const immediate=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.photoMode.close();const c=d.orbit.camera,p=c.getPosition(),r=c.getRotation();return {position:{x:p.x,y:p.y,z:-p.z},rotation:[r.x,r.y,r.z,r.w],fov:c.camera.fov,mounted:d.controller.mounted,held:d.controller.photoHolding,phone:d.smartphone.shell.state,keys:[...d.controller.keys],touch:d.controller.touchVector};});
  for(const axis of ['x','y','z'])assert.equal(immediate.position[axis],saved.position[axis]);assert.ok(immediate.rotation.every((n,i)=>Math.abs(n-saved.rotation[i])<1e-6));assert.equal(immediate.fov,saved.fov);assert.equal(immediate.mounted,true);assert.equal(immediate.held,false);assert.deepEqual(immediate.keys,[]);assert.deepEqual(immediate.touch,{x:0,y:0});assert.equal(immediate.phone,phoneOrigin?'HOME':'CLOSED');
  if(phoneOrigin)await page.locator('.smartphone-header button').last().click();await frames(page,2);assert.equal((await snapshot(page)).input,true);assert.equal((await snapshot(page)).orbitInput,true);
  const restart=await snapshot(page);await move(page,'KeyW',8);const driven=await snapshot(page);assert.ok(Math.hypot(...driven.position.map((n,i)=>n-restart.position[i]))>.001,`${kind} controls resume`);assert.equal(driven.mounted,true);
  // A real forced dismount for the ground vehicle; reference invalidation for flight/water.
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.photoMode.open()),true);
  await page.evaluate(kind=>{const d=window.__INHAGAME_P0__;if(kind==='ground')d.controller.dismountBike();else d.controller.entity.mountKind=null;d.photoMode.update();},kind);
  const invalid=await snapshot(page);assert.equal(invalid.photo,false);assert.equal(invalid.held,false);assert.equal(invalid.input,true);assert.equal(invalid.focus.activeClaimCount,0);
  entry.checks.push(`${kind}: real board/move, stationary photo hold, union framing, look/free move/zoom, PNG+Album, reset, exact chase restore, ${phoneOrigin?'Phone':'World'} origin, resume driving, lifecycle safe close`);
}finally{await page.close();await save();}}
async function mapsCase(smoke,entry,mobile){const page=await boot(smoke,entry);try{
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();
  await page.locator('.full-map-search-input').fill('본관');await page.locator('.full-map-search-result').first().click();
  const style=await page.locator('.full-map-poi').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n),i=getComputedStyle(n.querySelector('.full-map-poi-icon'));return {id:n.dataset.poiId,background:s.backgroundColor,border:s.borderTopWidth,padding:s.padding,shadow:s.boxShadow,width:s.width,height:s.height,radius:s.borderRadius,icon:i.borderRadius,selected:n.classList.contains('is-selected')};}));
  for(const s of style){assert.equal(s.background,'rgba(0, 0, 0, 0)');assert.equal(s.border,'0px');assert.equal(s.padding,'0px');assert.equal(s.shadow,'none');assert.equal(s.width,'44px');assert.equal(s.height,'44px');assert.equal(s.radius,'50%');assert.equal(s.icon,'50%');}
  assert.equal(style.filter(s=>s.selected).length,1);entry.markerStyles=style;await screen(page,entry,'maps-clean-markers');
  const favorite=page.locator('[data-map-favorite]');assert.equal(await favorite.innerText(),'☆ 즐겨찾기 추가');await favorite.click();assert.equal(await favorite.innerText(),'★ 즐겨찾기 해제');await page.locator('.smartphone-map-history details').first().evaluate(n=>{n.open=true;});await screen(page,entry,'favorite-added');
  const selected=await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.selectedPoi);const favoriteTitle=selected.title;
  await page.locator('#full-map-set-destination').click();await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();const navigation=await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.destination);
  await favorite.click();assert.equal(await favorite.innerText(),'☆ 즐겨찾기 추가');assert.equal(await page.locator('.smartphone-map-history summary').filter({hasText:'즐겨찾기'}).count(),0);
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.selectedPoi.poiId),selected.poiId);assert.deepEqual(await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.destination),navigation);await screen(page,entry,'favorite-removed');
  await favorite.click();await page.locator('.smartphone-header button').last().click();await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();assert.equal(await favorite.innerText(),'★ 즐겨찾기 해제');
  const zoom=await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.viewport.zoom);await page.locator('#full-map-zoom-in').click();assert.ok(await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.viewport.zoom)>zoom);
  await page.locator('#full-map-locate').click();await page.locator('#full-map-reset-view').click();assert.ok(await page.locator('#full-map-player').isVisible());
  await page.reload({waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();
  await page.locator('.smartphone-map-history details').first().evaluate(n=>{n.open=true;});await page.locator('.smartphone-map-history').getByRole('button',{name:favoriteTitle,exact:true}).first().click();assert.equal(await favorite.innerText(),'★ 즐겨찾기 해제');await favorite.click();assert.equal(await favorite.innerText(),'☆ 즐겨찾기 추가');
  await page.reload({waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();assert.equal(await page.locator('.smartphone-map-history summary').filter({hasText:'즐겨찾기'}).count(),0);
  // Real marker target still selects on a touch viewport at a point outside the 32px icon.
  const target=page.locator('.full-map-poi').filter({has:page.locator('.full-map-poi-label',{hasText:'본관'})}).first();
  await page.locator('.full-map-search-input').fill('본관');await page.locator('.full-map-search-result').first().click();
  if(mobile)await target.tap({position:{x:3,y:22}});else await target.click({position:{x:3,y:22}});
  assert.ok(await page.locator('#full-map-info').isVisible());
  const auto=await page.evaluate(()=>{const d=window.__INHAGAME_P0__,n=[...document.querySelectorAll('.full-map-poi')].find(n=>/정문/.test(n.__mapPoi.title));d.fullMap.selectPoi(n.__mapPoi);return n.dataset.poiId;});assert.ok(auto);
  await page.locator('#full-map-auto-move').click();assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.shell.state),'CLOSED');
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.playerAutoMove.active),true);
  entry.checks.push('Maps transparent 44px marker wrappers/circular icons, one selected highlight, hit-area selection, favorite state/instant list/add+remove reload readback, selection+destination preserved, locate/zoom/reset/search/auto move');
}finally{await page.close();await save();}}
try{
  const cases=new Set((process.env.MOUNTED_PHOTO_QA_CASES||'desktop,portrait,landscape').split(','));
  for(const [name,viewport,mobile]of [['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]]){
    if(!cases.has(name))continue;
    const entry={name,viewport,status:'RUNNING',checks:[],screenshots:[],captures:[],subjects:[]};report.cases.push(entry);await save();
    const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,acceptDownloads:true,reducedMotion:'reduce'}});
    try{for(const kind of ['ground','water','air']){console.log(`${name}: ${kind}`);await photoCase(smoke,entry,kind,mobile);}console.log(`${name}: maps`);await mapsCase(smoke,entry,mobile);assert.deepEqual(smoke.problems.filter(x=>!x.includes('/api/world-time')),[]);entry.status='PASS';}
    catch(error){entry.status='FAIL';entry.error=String(error.stack??error);throw error;}
    finally{entry.problems=smoke.problems;await smoke.close();await save();}
  }
  report.status=cases.size===3?'PASS':'PARTIAL';
}catch(error){report.status='FAIL';report.error=String(error.stack??error);process.exitCode=1;}
finally{await save();console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({name:c.name,status:c.status,checks:c.checks,error:c.error})),error:report.error},null,2));}
