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
const files=['src/main.js','campus/index.html','campus/induck-store-v0.2.1.html','phone.css','src/phone/smartphone.js','src/phone/phone-shell.js',
  'src/phone/phone-album.js','src/phone/phone-preferences.js','src/phone/phone-motion.js','src/phone/phone-app-catalog.js','src/phone/phone-store-integration.js','src/phone/student-id.js','src/phone/phone-surfaces.js',
  'src/photo/photo-capture.js','src/photo/photo-mode.js','src/photo/photo-mode-panel.js','src/minimap/full-map-controller.js'];
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
    await screen(page,entry,'home');
    const blank=await page.locator('.smartphone-clock').boundingBox();
    if(mobile){const cdp=await smoke.context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:blank.x+blank.width/2,y:blank.y+blank.height/2,id:1}]});await new Promise(r=>setTimeout(r,650));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
    else{await page.mouse.move(blank.x+blank.width/2,blank.y+blank.height/2);await page.mouse.down();await new Promise(r=>setTimeout(r,650));await page.mouse.up();}
    assert.equal((await phoneState(page)).state,'HOME_EDIT');await page.getByRole('button',{name:'편집 완료',exact:true}).click();
    // Phase 1 uses real preferences, not the standalone prototype's mock catalog.
    await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();
    await page.getByRole('button',{name:'학생증 홈에서 숨기기',exact:true}).click();
    assert.equal((await phoneState(page)).preferences.hiddenApps.includes('student-id'),false,'prompt does not mutate preferences');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('alertdialog').count(),0,'Escape cancels only the hide prompt');
    assert.equal((await phoneState(page)).state,'HOME_EDIT');
    await page.getByRole('button',{name:'학생증 홈에서 숨기기',exact:true}).click();
    await page.getByRole('button',{name:'숨기기 확인',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.smartphone-app[data-app-id="student-id"]'));
    const hiddenPersisted=await page.evaluate(()=>{
      const s=window.__INHAGAME_P0__.smartphone.status();
      return JSON.parse(localStorage.getItem('inha-world-phone-home-v1:'+s.scope)).hiddenApps;
    });
    assert.ok(hiddenPersisted.includes('student-id'),'hide success has persisted readback');
    await page.locator('.smartphone-hidden-apps summary').click();
    await page.getByRole('button',{name:/학생증 다시 표시/}).click();
    assert.equal((await phoneState(page)).preferences.hiddenApps.includes('student-id'),false);
    const beforeFailedHide=(await phoneState(page)).preferences;
    await page.evaluate(()=>{window.__restoreStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('QA quota');};});
    await page.getByRole('button',{name:'앨범 홈에서 숨기기',exact:true}).click();
    await page.getByRole('button',{name:'숨기기 확인',exact:true}).click();
    assert.deepEqual((await phoneState(page)).preferences,beforeFailedHide,'failed hide retains exact layout');
    assert.equal(await page.locator('.smartphone-app[data-app-id="album"]').count(),1);
    await page.evaluate(()=>{Storage.prototype.setItem=window.__restoreStorageSet;});
    await page.getByRole('button',{name:'지도 Dock에서 홈으로 이동',exact:true}).click();
    const unpinned=(await phoneState(page)).preferences;
    assert.equal(unpinned.dock.includes('maps'),false);
    assert.equal(unpinned.hiddenApps.includes('maps'),false);
    assert.equal(unpinned.pages.flat().filter(id=>id==='maps').length,1);
    await page.getByRole('button',{name:'기본 배치 복구',exact:true}).click();
    await page.locator('.smartphone-clock').click();
    assert.equal((await phoneState(page)).state,'HOME','free home space exits edit mode');
    await page.getByRole('button',{name:'알림센터 열기',exact:true}).click();
    assert.equal((await phoneState(page)).current.appId,'notifications');
    await page.getByRole('button',{name:'알림센터 닫기',exact:true}).click();
    assert.equal((await phoneState(page)).state,'HOME');
    entry.checks.push('Phase 1: cancelable hide confirmation, persisted hide/restore, storage rollback, Dock move-not-hide, free-space exit and bounded notification handles');await save();
    entry.checks.push('Phone key/mobile button, frame bounds, focus isolation and inert World');await save();
    await page.keyboard.down('KeyW');await frames(page,3);await page.keyboard.up('KeyW');
    const blocked=await snapshot(page);assert.deepEqual(blocked.position.slice(0,1).concat(blocked.position.slice(2)),initial.position.slice(0,1).concat(initial.position.slice(2)));assert.equal(blocked.yaw,initial.yaw);
    await clickApp(page,'student-id');await page.getByRole('button',{name:'뒷면 보기',exact:true}).click();assert.ok(await page.locator('.smartphone-student-card[data-face="back"]').isVisible());
    await page.getByRole('button',{name:'앞면 보기',exact:true}).click();assert.match(await page.locator('.smartphone-student-card').innerText(),/인덕이/);await screen(page,entry,'student-id');
    await page.locator('.smartphone-home-button').click();entry.checks.push('World held movement/camera blocked; Student ID front/back guest fallbacks');await save();
    // MENU-01: the two already-shipped server-owned daily panels live inside Phone.
    // Guest fixture has no reward authority: opening either app must never claim anything.
    for (const [appId,panelId] of [['daily-quiz','#daily-quiz-panel'],['attendance','#attendance-panel']]) {
      await clickApp(page,appId);
      assert.equal((await phoneState(page)).current.appId,appId);
      assert.equal(await page.locator(panelId).getAttribute('data-phone-hosted'),'true');
      assert.equal(await page.locator(panelId).getAttribute('aria-modal'),null);
      assert.equal(await page.locator(panelId).isVisible(),true);
      assert.match(await page.locator(panelId).innerText(),/로그인|계정/);
      const hosted=await layout(page);
      assert.ok(hosted.inViewport&&!hosted.horizontalClip&&hosted.focusInside&&hosted.inert,JSON.stringify({appId,hosted}));
      await screen(page,entry,appId);
      await page.keyboard.press('Escape');
      assert.equal((await phoneState(page)).state,'HOME');
      assert.equal(await page.locator(panelId).getAttribute('data-phone-hosted'),null);
      assert.equal(await page.locator(panelId).isVisible(),false);
      assert.equal((await snapshot(page)).input,false,'Phone remains the only gameplay lock after app Back');
    }
    await clickApp(page,'daily-quiz');
    await page.locator('#daily-quiz-panel .profile-close').click();
    assert.equal((await phoneState(page)).state,'HOME','legacy close button returns to Phone Home');
    assert.equal(await page.locator('#daily-quiz-panel').getAttribute('data-phone-hosted'),null);
    entry.checks.push('MENU-01: existing Quiz/Attendance panels embedded; guest no-claim, focus/inert, Escape, native close and DOM restoration');await save();
    // MENU-02A: guests see an honest sign-in state and no private message content.
    await clickApp(page,'messages');
    await page.getByText('로그인하면 메시지를 확인할 수 있어요.',{exact:true}).waitFor();
    assert.equal((await phoneState(page)).current.appId,'messages');
    await screen(page,entry,'messages-guest');
    await page.keyboard.press('Escape');
    assert.equal((await phoneState(page)).state,'HOME');
    entry.checks.push('MENU-02A: guest messages sign-in view, no private RPC, Back/Home and world lock');await save();
    // INHA OS v0.2.1: embedded original storefront; real Phone installs use a scoped bridge.
    await clickApp(page,'induck-store');
    assert.equal((await phoneState(page)).current.appId,'induck-store');
    const store=page.frameLocator('.phone-store-iframe');
    await store.locator('#root').waitFor();
    assert.match(await store.locator('.brand-title').innerText(),/인덕스토어/);
    await store.locator('[data-action="search"]').first().click();
    await store.locator('#searchInput').fill('인하오리 Classic');
    await store.locator('[data-action="install"][data-id="induck-classic"]').first().click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__.smartphone.status().preferences.installedApps.includes('induck-classic'));
    await store.locator('[data-action="open"][data-id="induck-classic"]').first().click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__.smartphone.status().current.appId==='induck-classic');
    const external=page.getByRole('link',{name:'인하오리 Classic 새 탭에서 열기'});
    assert.equal(await external.getAttribute('href'),'https://duck.inhagame.app/');
    assert.equal(await external.getAttribute('rel'),'noopener noreferrer');
    await page.keyboard.press('Escape');
    assert.equal((await phoneState(page)).current.appId,'induck-store');
    const nextStore=page.frameLocator('.phone-store-iframe');
    await nextStore.locator('[data-action="nav"][data-id="mine"]').first().click();
    await nextStore.getByText('실제 연결된 앱',{exact:true}).waitFor();
    await nextStore.getByText('시연 앱 · 실제 설치 아님',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.status().preferences.installedApps.includes('induck-pet')),false);
    await nextStore.locator('[data-action="phone-preview"]').click();
    await nextStore.getByText('실제 스마트폰 홈',{exact:true}).waitFor();
    await nextStore.locator('[data-action="pin"][data-id="induck-classic"]').click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__.smartphone.status().preferences.hiddenApps.includes('induck-classic'));
    await nextStore.getByText('홈에서 숨김',{exact:true}).first().waitFor();
    await nextStore.locator('[data-action="pin"][data-id="induck-classic"]').click();
    await page.waitForFunction(()=>!window.__INHAGAME_P0__.smartphone.status().preferences.hiddenApps.includes('induck-classic'));
    await nextStore.getByText('홈에 표시 중',{exact:true}).first().waitFor();
    await nextStore.locator('[data-action="search"]').first().click();
    await nextStore.locator('#searchInput').fill('인하오리 Classic');
    await nextStore.locator('[data-action="detail"][data-id="induck-classic"]').first().click();
    await nextStore.locator('[data-action="uninstall"][data-id="induck-classic"]').first().click();
    await nextStore.locator('[data-action="confirm-uninstall"][data-id="induck-classic"]').first().click();
    await page.waitForFunction(()=>!window.__INHAGAME_P0__.smartphone.status().preferences.installedApps.includes('induck-classic'));
    await page.locator('.smartphone-home-button').click();
    assert.equal(await page.locator('.smartphone-app[data-app-id="induck-store"]').count(),1);
    entry.checks.push('INHA OS live bridge: authoritative install, app separation, actual Home snapshot, pin/hide restore, safe game route and uninstall');await save();    const beforeCamera=await snapshot(page);await clickApp(page,'camera');assert.equal((await phoneState(page)).state,'CAMERA');assert.equal(await page.locator('.smartphone').isVisible(),false);assert.equal((await snapshot(page)).photo,true);
    const downloadReady=page.waitForEvent('download',{timeout:120000});
    downloadReady.catch(()=>{});
    await page.locator('[data-photo-control="capture"]').click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__?.photoModePanel.status().busy===false,null,{timeout:120000});
    // Keep success timings too: a product deadline change must not hide 10-second overruns.
    entry.captureDiagnostic = await page.evaluate(() => window.__INHAGAME_P0__.photoModePanel.status().capture);
    await save();
    assert.doesNotMatch(await page.locator('[data-photo-control="status"]').innerText(),/PNG를 만들지 못/,'Production shutter succeeds');
    const download=await downloadReady;
    await download.saveAs(`${output}/${name}-capture.png`);const bytes=await readFile(`${output}/${name}-capture.png`);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    await page.waitForFunction(()=>!window.__INHAGAME_P0__.photoModePanel.status().busy,null,{timeout:120000});
    const photos=await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list());assert.equal(photos.length,1);const photo=photos[0];
    assert.ok(photo.locationName);assert.notEqual(photo.imageRef,photo.thumbnailRef);assert.ok(photo.position);
    const blobs=await page.evaluate(async id=>{const a=window.__INHAGAME_P0__.smartphone.album,original=await a.image(id),thumbnail=await a.image(id,'thumbnail'),o=await createImageBitmap(original),t=await createImageBitmap(thumbnail);
      const result={originalType:original.type,thumbnailType:thumbnail.type,original:[o.width,o.height],thumbnail:[t.width,t.height]};o.close();t.close();return result;},photo.id);
    assert.equal(blobs.originalType,'image/png');assert.equal(blobs.thumbnailType,'image/jpeg');assert.ok(Math.max(...blobs.thumbnail)<=256);assert.ok(Math.max(...blobs.original)>256);
    await page.locator('[data-photo-control="close"]').click();assert.equal((await phoneState(page)).state,'HOME');assert.equal((await snapshot(page)).photo,false);
    assert.deepEqual((await snapshot(page)).camera,beforeCamera.camera);assert.equal((await snapshot(page)).yaw,beforeCamera.yaw);
    entry.checks.push('Existing Photo Mode capture/download + Album readback, distinct original/thumbnail, Phone-origin exit');await save();
    await clickApp(page,'album');await page.waitForSelector('.smartphone-album-grid button');await screen(page,entry,'album');
    await page.locator('.smartphone-album-grid button').first().click();await page.getByRole('button',{name:'☆ 즐겨찾기',exact:true}).click();await page.getByRole('button',{name:'★ 즐겨찾기 해제',exact:true}).waitFor();
    await page.getByRole('button',{name:'홈 배경으로 사용',exact:true}).click();assert.equal((await phoneState(page)).preferences.wallpaper.id,photo.id);
    await page.getByRole('button',{name:'지도에서 보기',exact:true}).click();assert.equal((await phoneState(page)).current.appId,'maps');assert.equal(await page.locator('#full-map-panel').getAttribute('data-phone-hosted'),'true');
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).current.photoId,photo.id);
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).current.appId,'album');
    await page.locator('.smartphone-header button').first().click();assert.equal((await phoneState(page)).state,'HOME');entry.checks.push('Album thumbnail grid, favorite, photo wallpaper, Album→Photo→Maps back stack');await save();
    await clickApp(page,'maps');await page.locator('.full-map-search-input').fill('본관');
    await page.locator('.full-map-search-result').first().click();assert.ok(await page.locator('#full-map-info').isVisible());
    await page.getByRole('button',{name:'☆ 즐겨찾기 추가',exact:true}).click();await screen(page,entry,'maps');
    await page.locator('#full-map-set-destination').click();assert.equal((await phoneState(page)).state,'CLOSED');
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.navigation.getSnapshot().active),true);
    await frames(page);assert.equal(await page.locator('#full-map-panel').getAttribute('data-phone-hosted'),null);assert.equal(await page.locator('#phone-toggle').isVisible(),true);
    entry.checks.push('Existing Full Map search/selection/favorites, solved destination closes Phone, shared waypoint/HUD authority');await save();
    await page.locator('#phone-toggle').click();await clickApp(page,'maps');
    const target=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;const node=[...document.querySelectorAll('.full-map-poi')].find(n=>n.__mapPoi?.presentation==='NORMAL'&&/본관/.test(n.__mapPoi.title));d.fullMap.selectPoi(node.__mapPoi);return node.dataset.poiId;});assert.ok(target);
    await page.locator('#full-map-auto-move').click();assert.equal((await phoneState(page)).state,'CLOSED');
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().autoMove?.active??window.__INHAGAME_P0__.playerAutoMove?.active),true);
    await page.locator('#phone-toggle').click();await clickApp(page,'maps');
    await page.evaluate(()=>window.__INHAGAME_P0__.fullMap.selectMapPoint({x:10000,z:10000}));assert.equal(await page.locator('#full-map-auto-move').isDisabled(),true);await page.locator('.smartphone-home-button').click();
    entry.checks.push('Existing Auto Move invoked, unsupported map point disabled, old map restored to World DOM');await save();
    await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();
    const source=page.locator('.smartphone-app[data-app-id="album"]'),dock=page.locator('.smartphone-app[data-area="dock"][data-slot="2"]');
    await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await dock.boundingBox();
    if(mobile){const cdp=await smoke.context.newCDPSession(page),point={x:a.x+a.width/2,y:a.y+a.height/2,id:1,radiusX:2,radiusY:2,force:1};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await new Promise(r=>setTimeout(r,650));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:b.x+b.width/2,y:b.y+b.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    }else{await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});await page.mouse.up();}
    assert.equal((await phoneState(page)).preferences.dock[2],'album');
    await page.getByRole('button',{name:'편집 완료',exact:true}).click();assert.equal(await page.locator('.smartphone-content').evaluate(n=>n.scrollTop),0);await screen(page,entry,'customized-home');
    const persisted=(await phoneState(page)).preferences;await page.locator('.smartphone-header button').last().click();
    await page.reload({waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});await page.locator('#phone-toggle').click();
    assert.deepEqual((await phoneState(page)).preferences,persisted);assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,1);
    await clickApp(page,'album');await page.waitForSelector('.smartphone-album-grid button');await page.locator('.smartphone-album-grid button').first().click();await page.getByRole('button',{name:'사진 삭제',exact:true}).click();
    assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,1);await page.getByRole('button',{name:'삭제 확인',exact:true}).click();
    await page.waitForFunction(()=>window.__INHAGAME_P0__.smartphone.status().preferences.wallpaper.type==='default');
    assert.equal((await page.evaluate(async()=>window.__INHAGAME_P0__.smartphone.album.list())).length,0);await page.getByRole('button',{name:'카메라 열기',exact:true}).waitFor();
    entry.checks.push('Home pointer drag/Dock dedup + reload persistence; photo delete confirmation/three-entry cleanup/deleted wallpaper fallback/empty state');await save();
    await page.locator('.smartphone-home-button').click();await clickApp(page,'settings');
    assert.equal(await page.locator('#view-settings').getAttribute('data-phone-hosted'),'true');
    assert.ok(await page.locator('#settings-category-home').isVisible(), 'categorized Settings home opens');
    await page.locator('[data-settings-target="graphics"]').click();
    assert.ok(await page.locator('#settings-page-graphics').isVisible());
    const scroll=await page.evaluate(()=>{
      const n=document.querySelector('.smartphone-content'),panel=document.querySelector('#view-settings');
      const outer=getComputedStyle(n),inner=getComputedStyle(panel);
      const oldMax=n.style.maxHeight,oldFlex=n.style.flex;
      n.style.maxHeight='200px';n.style.flex='0 0 auto';
      n.scrollTop=n.scrollHeight;
      const result={outerOverflow:outer.overflowY,innerOverflow:inner.overflowY,
        scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight};
      n.style.maxHeight=oldMax;n.style.flex=oldFlex;n.scrollTop=0;
      return result;
    });
    assert.equal(scroll.outerOverflow,'auto');
    assert.equal(scroll.innerOverflow,'visible');
    assert.ok(scroll.scrollHeight>scroll.clientHeight && scroll.scrollTop>0, JSON.stringify(scroll));
    await page.locator('#settings-section-back').click();
    assert.ok(await page.locator('#settings-category-home').isVisible(), 'back restores categories');
    await page.locator('[data-settings-target="audio"]').click();
    assert.ok(await page.locator('#audio-volume').isVisible(), 'existing audio control survives grouping');
    await page.keyboard.press('Escape');assert.equal((await phoneState(page)).state,'HOME');
    entry.checks.push('Settings 2.0 category/back, existing controls, inner overflow visible and Phone-owned scrolling');await save();
    await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();
    await page.locator('.smartphone-app[data-app-id="settings"]').click();await page.getByLabel('앱 이동할 칸',{exact:true}).selectOption('dock:3');await page.getByRole('button',{name:'선택한 앱 이동',exact:true}).click();assert.equal((await phoneState(page)).preferences.dock[3],'settings');
    await page.getByRole('button',{name:'기본 배치 복구',exact:true}).click();assert.deepEqual((await phoneState(page)).preferences.dock,['maps','camera',null,null]);
    await page.evaluate(()=>{window.__restoreStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('QA quota');};});
    await page.getByRole('button',{name:'밤',exact:true}).click();await page.getByRole('button',{name:'편집 완료',exact:true}).click();assert.match(await page.locator('.smartphone-message').innerText(),/저장하지 못/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.__restoreStorageSet;});await page.keyboard.press('Escape');assert.equal((await phoneState(page)).state,'CLOSED');assert.equal(await page.locator('#application').evaluate(c=>c.inert),false);
    await page.keyboard.press('KeyP');assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.photoMode.active),true);await page.locator('[data-photo-control="close"]').click();assert.equal((await phoneState(page)).state,'CLOSED');
    entry.checks.push('Reused Settings + Esc hierarchy; storage failure explicit, session preserved, World escape; direct P origin returns World');await save();
    const errors=smoke.problems.filter(x=>!x.includes('net::ERR_ABORTED')||!x.includes('/api/world-time'));
    assert.deepEqual(errors,[]);entry.status='PASS';await save();
  }catch(error){entry.status='FAIL';entry.error=String(error.stack??error);if(page)try{entry.diagnostic=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;return {phone:d?.smartphone.status(),photo:d?.photoModePanel.status(),focus:d?.inputFocus?.snapshot(),canvas:[document.getElementById('application').width,document.getElementById('application').height],hidden:document.hidden,deviceLost:d?.app.graphicsDevice.contextLost};});}catch{}if(page)try{await screen(page,entry,'failure');}catch{}throw error;}
  finally{await smoke?.close();await save();}
}
try{for(const [name,viewport,mobile]of [['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]])await run(name,viewport,mobile);report.status='PASS';}
catch(error){report.status='FAIL';report.error=String(error.stack??error);process.exitCode=1;}
finally{await save();console.log(JSON.stringify(report,null,2));}
