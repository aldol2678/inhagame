// Actual /campus/ + production controllers, offline backend. No authenticated/live writes.
// PHONE_HEAD_SHA=<candidate> WORLD_SMOKE_DISABLE_WEBGPU=1 node .../phone-campus-smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.PHONE_HEAD_SHA,'PHONE_HEAD_SHA must be this exact candidate');
const output='test-results/phone-campus';await mkdir(output,{recursive:true});
const files=['src/main.js','campus/index.html','phone.css','src/phone/smartphone.js','src/phone/phone-shell.js',
  'src/phone/phone-album.js','src/phone/phone-preferences.js','src/phone/student-id.js','src/phone/phone-surfaces.js',
  'src/photo/photo-mode.js','src/photo/photo-mode-panel.js','src/minimap/full-map-controller.js'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(new URL(`../../${p}`,import.meta.url))).digest('hex')])));
const report={head,status:'RUNNING',sourceHashes:hashes,cases:[],limits:['Offline guest campus: live signed-in server profile/EXP/Badge integration not verified.',
  'Chromium mobile viewport/touch emulation is not physical Android/iOS gallery, safe-area or WebGPU acceptance.']};
const save=()=>writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
const frames=async(page,count=2)=>{const at=await page.evaluate(()=>window.__INHAGAME_P0__.app.frame);await page.waitForFunction(({at,count})=>window.__INHAGAME_P0__.app.frame>=at+count,{at,count},{timeout:120000});};
const phoneState=page=>page.evaluate(()=>window.__INHAGAME_P0__.smartphone.status());
const snapshot=page=>page.evaluate(()=>{const d=window.__INHAGAME_P0__,p=d.player.getLocalPosition(),c=d.orbit.camera.getPosition();return {position:[p.x,p.y,p.z],camera:[c.x,c.y,c.z],yaw:d.orbit.yaw,pitch:d.orbit.pitch,input:d.controller.inputEnabled,orbitInput:d.orbit.inputEnabled,photo:d.photoMode.active,phone:d.smartphone.shell.state};});
async function clickApp(page,id){await page.locator(`.smartphone-app[data-app-id="${id}"]`).click();}
async function screen(page,entry,name){await page.screenshot({path:`${output}/${entry.name}-${name}.png`,animations:'disabled',timeout:60000});entry.screenshots.push(`${entry.name}-${name}.png`);}
async function layout(page){return page.evaluate(()=>{const root=document.querySelector('.smartphone'),frame=root.querySelector('.smartphone-frame'),content=root.querySelector('.smartphone-content'),r=frame.getBoundingClientRect();
  return {inViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,horizontalClip:content.scrollWidth>content.clientWidth+2,focusInside:root.contains(document.activeElement),inert:document.getElementById('application').inert};});}

async function run(name,viewport,mobile){
  const entry={name,viewport,status:'RUNNING',checks:[],screenshots:[]};report.cases.push(entry);await save();let smoke,page;
  try{
    smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,acceptDownloads:true,reducedMotion:'reduce'}});
    page=await smoke.context.newPage();page.setDefaultTimeout(60000);const fatal=smoke.watch(page);
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
    await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000}),fatal]);
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer),'WebGL2');
    const served=await page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async p=>{const bytes=await(await fetch('/'+p)).arrayBuffer();return[p,[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')];}))),files);
    assert.deepEqual(served,hashes);await frames(page,3);
    const initial=await snapshot(page);
    if(mobile)await page.locator('#phone-toggle').tap();else await page.keyboard.press('KeyN');
    assert.equal((await phoneState(page)).state,'HOME');assert.equal((await snapshot(page)).input,false);
    assert.equal((await snapshot(page)).orbitInput,false);let bounds=await layout(page);assert.ok(bounds.inViewport&&!bounds.horizontalClip&&bounds.focusInside&&bounds.inert,JSON.stringify(bounds));
    await screen(page,entry,'home');entry.checks.push('Phone key/mobile button, frame bounds, focus isolation and inert World');
    await page.keyboard.down('KeyW');await frames(page,3);await page.keyboard.up('KeyW');
    const blocked=await snapshot(page);assert.deepEqual(blocked.position.slice(0,1).concat(blocked.position.slice(2)),initial.position.slice(0,1).concat(initial.position.slice(2)));assert.equal(blocked.yaw,initial.yaw);
    await clickApp(page,'student-id');await page.getByRole('button',{name:'뒷면 보기',exact:true}).click();assert.ok(await page.locator('.smartphone-student-card[data-face="back"]').isVisible());
    await page.getByRole('button',{name:'앞면 보기',exact:true}).click();assert.match(await page.locator('.smartphone-student-card').innerText(),/인덕이/);await screen(page,entry,'student-id');
    await page.locator('.smartphone-home-button').click();entry.checks.push('World held movement/camera blocked; Student ID front/back guest fallbacks');
    await clickApp(page,'camera');assert.equal((await phoneState(page)).state,'CAMERA');assert.equal(await page.locator('.smartphone').isVisible(),false);assert.equal((await snapshot(page)).photo,true);
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.locator('[data-photo-control="capture"]').click()]);
    await download.saveAs(`${output}/${name}-capture.png`);const bytes=await readFile(`${output}/${name}-capture.png`);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    await page.waitForFunction(()=>!window.__INHAGAME_P0__.photoModePanel.status().busy,null,{timeout:120000});
    const photos=await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list());assert.equal(photos.length,1);const photo=photos[0];
    assert.ok(photo.locationName);assert.notEqual(photo.imageRef,photo.thumbnailRef);assert.ok(photo.position);
    const blobs=await page.evaluate(async id=>{const a=window.__INHAGAME_P0__.smartphone.album,original=await a.image(id),thumbnail=await a.image(id,'thumbnail'),o=await createImageBitmap(original),t=await createImageBitmap(thumbnail);
      const result={originalType:original.type,thumbnailType:thumbnail.type,original:[o.width,o.height],thumbnail:[t.width,t.height]};o.close();t.close();return result;},photo.id);
    assert.equal(blobs.originalType,'image/png');assert.equal(blobs.thumbnailType,'image/jpeg');assert.ok(Math.max(...blobs.thumbnail)<=256);assert.ok(Math.max(...blobs.original)>256);
    await page.locator('[data-photo-control="close"]').click();assert.equal((await phoneState(page)).state,'HOME');assert.equal((await snapshot(page)).photo,false);
    entry.checks.push('Existing Photo Mode capture/download + Album readback, distinct original/thumbnail, Phone-origin exit');
    await clickApp(page,'album');await page.waitForSelector('.smartphone-album-grid button');await screen(page,entry,'album');
    await page.locator('.smartphone-album-grid button').first().click();await page.getByRole('button',{name:'☆ 즐겨찾기',exact:true}).click();await page.getByRole('button',{name:'★ 즐겨찾기 해제',exact:true}).waitFor();
    await page.getByRole('button',{name:'홈 배경으로 사용',exact:true}).click();assert.equal((await phoneState(page)).preferences.wallpaper.id,photo.id);
    await page.getByRole('button',{name:'지도에서 보기',exact:true}).click();assert.equal((await phoneState(page)).current.appId,'maps');assert.equal(await page.locator('#full-map-panel').getAttribute('data-phone-hosted'),'true');
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).current.photoId,photo.id);
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).current.appId,'album');
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).state,'HOME');entry.checks.push('Album thumbnail grid, favorite, photo wallpaper, Album→Photo→Maps back stack');
    await clickApp(page,'maps');await page.locator('.full-map-search-input').fill('본관');
    await page.locator('.full-map-search-result').first().click();assert.ok(await page.locator('#full-map-info').isVisible());
    await page.getByRole('button',{name:'선택한 장소 즐겨찾기',exact:true}).click();await screen(page,entry,'maps');
    await page.locator('#full-map-set-destination').click();assert.equal((await phoneState(page)).state,'CLOSED');
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.navigation.getSnapshot().active),true);
    await frames(page);assert.equal(await page.locator('#full-map-panel').getAttribute('data-phone-hosted'),null);assert.equal(await page.locator('#phone-toggle').isVisible(),true);
    entry.checks.push('Existing Full Map search/selection/favorites, solved destination closes Phone, shared waypoint/HUD authority');
    await page.locator('#phone-toggle').click();await clickApp(page,'maps');
    const target=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;const node=[...document.querySelectorAll('.full-map-poi')].find(n=>n.__mapPoi?.presentation==='NORMAL'&&/본관/.test(n.__mapPoi.title));d.fullMap.selectPoi(node.__mapPoi);return node.dataset.poiId;});assert.ok(target);
    await page.locator('#full-map-auto-move').click();assert.equal((await phoneState(page)).state,'CLOSED');
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().autoMove?.active??window.__INHAGAME_P0__.playerAutoMove?.active),true);
    await page.locator('#phone-toggle').click();await clickApp(page,'maps');
    await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.selectMapPoint({x:10000,z:10000}));assert.equal(await page.locator('#full-map-auto-move').isDisabled(),true);await page.locator('.smartphone-home-button').click();
    entry.checks.push('Existing Auto Move invoked, unsupported map point disabled, old map restored to World DOM');
    await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();
    const source=page.locator('.smartphone-app[data-app-id="album"]'),dock=page.locator('.smartphone-app[data-area="dock"][data-slot="2"]');
    const a=await source.boundingBox(),b=await dock.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});await page.mouse.up();
    assert.equal((await phoneState(page)).preferences.dock[2],'album');
    await page.getByRole('button',{name:'편집 완료',exact:true}).click();await screen(page,entry,'customized-home');
    const persisted=(await phoneState(page)).preferences;await page.locator('.smartphone-header button').last().click();
    await page.reload({waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});await page.locator('#phone-toggle').click();
    assert.deepEqual((await phoneState(page)).preferences,persisted);assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,1);
    await clickApp(page,'album');await page.waitForSelector('.smartphone-album-grid button');await page.locator('.smartphone-album-grid button').first().click();await page.getByRole('button',{name:'사진 삭제',exact:true}).click();
    assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,1);await page.getByRole('button',{name:'삭제 확인',exact:true}).click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__.smartphone.status().preferences.wallpaper.type==='default');
    assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,0);await page.getByRole('button',{name:'카메라 열기',exact:true}).waitFor();
    entry.checks.push('Home pointer drag/Dock dedup + reload persistence; photo delete confirmation/three-entry cleanup/deleted wallpaper fallback/empty state');
    await page.locator('.smartphone-home-button').click();await clickApp(page,'settings');assert.equal(await page.locator('#view-settings').getAttribute('data-phone-hosted'),'true');await page.keyboard.press('Escape');assert.equal((await phoneState(page)).state,'HOME');
    await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();await page.evaluate(()=>{window.__restoreStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('QA quota');};});
    await page.getByRole('button',{name:'밤',exact:true}).click();await page.getByRole('button',{name:'편집 완료',exact:true}).click();assert.match(await page.locator('.smartphone-message').innerText(),/저장하지 못/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.__restoreStorageSet;});await page.keyboard.press('Escape');assert.equal((await phoneState(page)).state,'CLOSED');assert.equal(await page.locator('#application').evaluate(c=>c.inert),false);
    await page.keyboard.press('KeyP');assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.photoMode.active),true);await page.locator('[data-photo-control="close"]').click();assert.equal((await phoneState(page)).state,'CLOSED');
    entry.checks.push('Reused Settings + Esc hierarchy; storage failure explicit, session preserved, World escape; direct P origin returns World');
    const errors=smoke.problems.filter(x=>!x.includes('net::ERR_ABORTED')||!x.includes('/api/world-time'));
    assert.deepEqual(errors,[]);entry.status='PASS';await save();
  }catch(error){entry.status='FAIL';entry.error=String(error.stack??error);if(page)try{await screen(page,entry,'failure');}catch{}throw error;}
  finally{await smoke?.close();await save();}
}
try{for(const [name,viewport,mobile]of [['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]])await run(name,viewport,mobile);report.status='PASS';}
catch(error){report.status='FAIL';report.error=String(error.stack??error);process.exitCode=1;}
finally{await save();console.log(JSON.stringify(report,null,2));}
