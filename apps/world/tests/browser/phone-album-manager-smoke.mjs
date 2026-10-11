// Real campus + real IndexedDB + browser downloads. All data is synthetic and device-local.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output='test-results/phone-album-manager';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[]};
const files=['src/phone/phone-album.js','src/phone/phone-album-export.js','src/phone/phone-album-manager.js','src/phone/smartphone.js','phone.css'];
report.sourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(new URL(`../../${path}`,import.meta.url))).digest('hex')])));
const save=()=>writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
async function run(name,viewport,mobile){
  const entry={name,checks:[]};report.cases.push(entry);console.log(`${name}: starting`);await save();
  const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,acceptDownloads:true}});
  await smoke.context.addInitScript(()=>localStorage.setItem('inha-world-graphics-quality-v1','low'));
  let page;
  try{
    page=await smoke.context.newPage();page.setDefaultTimeout(60000);smoke.watch(page);
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
    await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});
    console.log(`${name}: campus ready`);
    const served=await page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async path=>{const bytes=await(await fetch('/'+path)).arrayBuffer();return [path,[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')];}))),files);
    assert.deepEqual(served,report.sourceHashes);
    const tap=async label=>{const button=page.getByRole('button',{name:label,exact:true});mobile?await button.tap():await button.click();};
    const open=async()=>{await page.evaluate(()=>{const p=window.__INHAGAME_P0__.smartphone;p.open();p.launch('album');});await page.getByRole('button',{name:'저장공간 관리',exact:true}).waitFor();};
    await open();console.log(`${name}: empty album ready`);assert.equal(await page.getByRole('button',{name:'전체 사진 ZIP',exact:true}).isDisabled(),true);await page.getByText('첫 캠퍼스 사진을 남겨 보세요.',{exact:true}).waitFor();
    const expected=await page.evaluate(async()=>{
      const p=window.__INHAGAME_P0__.smartphone;p.setAccount('qa-album-b');const a=p.album;
      const otherCanvas=document.createElement('canvas');otherCanvas.width=2;otherCanvas.height=2;
      const otherBlob=await new Promise(resolve=>otherCanvas.toBlob(resolve,'image/png'));
      window.__otherPhoto=await a.save({blob:otherBlob},{locationName:'다른 계정'});
      p.setAccount('qa-album-a');
      const photos=[];
      for(const color of ['red','green','blue']){
        const c=document.createElement('canvas');c.width=32;c.height=24;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,32,24);
        const blob=await new Promise(r=>c.toBlob(r,'image/png'));
        const record=await a.save({blob},{position:{x:12,y:23,z:34},locationName:'테스트 캠퍼스',locationId:'private-location'});
        if(!record)throw Error('Fixture save failed');
        if(color!=='green')await a.favorite(record.id,true);
        photos.push({id:record.id,data:btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),originalBytes:blob.size,thumbnailBytes:(await a.image(record.id,'thumbnail')).size,favorite:color!=='green'});
      }
      window.__albumRecords=JSON.stringify(await a.list());
      return photos;
    });
    console.log(`${name}: fixtures saved`);await open();await page.waitForFunction(()=>document.querySelectorAll('.smartphone-album-grid button').length===3);
    const stats=await page.evaluate(async()=>{const {measureAlbum}=await import('/src/phone/phone-album-export.js');return measureAlbum(window.__INHAGAME_P0__.smartphone.album);});
    assert.equal(stats.originalBytes,expected.reduce((n,p)=>n+p.originalBytes,0));assert.equal(stats.thumbnailBytes,expected.reduce((n,p)=>n+p.thumbnailBytes,0));
    await tap('저장공간 관리');await page.getByText(/사이트 전체 추정 사용량/).waitFor();await page.screenshot({path:`${output}/${name}-storage.png`});
    await tap('뒤로');await page.getByRole('button',{name:'전체 사진 ZIP',exact:true}).waitFor();
    const download=async(label,which,suffix)=>{
      const ready=page.waitForEvent('download');await tap(label);const result=await ready;console.log(`${name}: downloaded ${suffix}`);assert.equal(await result.failure(),null);assert.equal(result.suggestedFilename(),'inha-world-photos.zip');
      const path=`${output}/${name}-${suffix}.zip`;await result.saveAs(path);
      const files=JSON.parse(execFileSync('python3',['-c',`import sys,json,zipfile,base64
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 print(json.dumps([{'name':n,'bytes':base64.b64encode(z.read(n)).decode()} for n in z.namelist()]))`,path],{encoding:'utf8'}));
      assert.equal(files.length,which.length);assert.equal(new Set(files.map(x=>x.name)).size,files.length);
      for(const file of files)assert.match(file.name,/^photo-\d{4}\.png$/);
      assert.deepEqual(files.map(x=>x.bytes).sort(),which.map(x=>x.data).sort());
      assert.doesNotMatch((await readFile(path)).toString(),/qa-album|private-location|position|imageRef|token/);
      await page.getByText(/ZIP 생성 완료 · 다운로드를 요청했어요/).waitFor();
    };
    await download('전체 사진 ZIP',expected,'all');await download('즐겨찾기 ZIP',expected.filter(p=>p.favorite),'favorites');
    await tap('사진 다중 선택');const buttons=page.locator('.smartphone-album-grid button');
    if(mobile)await buttons.first().tap();else{await buttons.first().focus();await page.keyboard.press('Space');}
    await page.getByText(/선택 1장 · 예상 원본 용량/).waitFor();assert.equal(await buttons.first().getAttribute('aria-pressed'),'true');
    const selectedId=await page.evaluate(async()=> (await window.__INHAGAME_P0__.smartphone.album.list())[0].id);
    await download('선택 사진 ZIP',expected.filter(p=>p.id===selectedId),'selected');
    await tap('선택 전체 해제');assert.equal(await page.getByRole('button',{name:'선택 사진 ZIP',exact:true}).isDisabled(),true);
    await tap('선택 모드 끝내기');
    const preserved=await page.evaluate(async()=>{const a=window.__INHAGAME_P0__.smartphone.album;return Promise.all((await a.list()).map(async r=>({id:r.id,data:btoa(String.fromCharCode(...new Uint8Array(await (await a.image(r.id)).arrayBuffer()))),favorite:r.favorite})));});
    assert.deepEqual(preserved.sort((a,b)=>a.id.localeCompare(b.id)),expected.map(({id,data,favorite})=>({id,data,favorite})).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.equal(await page.evaluate(async()=>JSON.stringify(await window.__INHAGAME_P0__.smartphone.album.list())===window.__albumRecords),true);
    const bounds=await page.evaluate(()=>{const c=document.querySelector('.smartphone-content'),r=document.querySelector('.smartphone-frame').getBoundingClientRect();return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,overflow:c.scrollWidth>c.clientWidth+2,focus:document.querySelector('.smartphone').contains(document.activeElement),input:window.__INHAGAME_P0__.controller.inputEnabled};});
    assert.deepEqual(bounds,{fits:true,overflow:false,focus:true,input:false});
    await page.screenshot({path:`${output}/${name}-selection.png`});entry.checks.push('empty, exact storage sizes, site estimate distinction, all/favorites/keyboard-or-touch selection ZIP downloads, Python unzip CRC/count/names/bytes, originals preserved, viewport/focus');await save();
    if(name==='desktop'){
      // Inject download request failure, then recover without changing album data.
      await page.evaluate(()=>{window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){throw Error('QA download blocked');};});
      await tap('전체 사진 ZIP');await page.getByText(/사진 읽기 또는 다운로드에 실패/).waitFor();await page.evaluate(()=>{HTMLAnchorElement.prototype.click=window.__anchorClick;});
      // Use padded valid PNG to guarantee several interruptible CRC chunks.
      const largeId=await page.evaluate(async()=>{const a=window.__INHAGAME_P0__.smartphone.album,r=(await a.list())[0],blob=await a.image(r.id);return (await a.save({blob:new Blob([blob,new Uint8Array(12*1024*1024)],{type:'image/png'})},{locationName:'취소 테스트'})).id;});
      await open();
      let downloads=0;page.on('download',()=>downloads++);
      const holdDecode=()=>page.evaluate(()=>{window.__realDecode=createImageBitmap;window.__releaseDecode=null;globalThis.createImageBitmap=async(...args)=>{await new Promise(resolve=>{window.__releaseDecode=resolve;});return window.__realDecode(...args);};});
      const releaseDecode=()=>page.evaluate(()=>{globalThis.createImageBitmap=window.__realDecode;window.__releaseDecode?.();});
      const pendingExport=async()=>{await holdDecode();await tap('전체 사진 ZIP');await page.waitForFunction(()=>!!window.__releaseDecode);};
      await pendingExport();await tap('다운로드 취소');await page.getByText(/다운로드를 취소했어요/).waitFor();await releaseDecode();assert.equal(downloads,0);
      // Switch A→B→A while a ZIP is pending; stale scope must never download.
      await pendingExport();await page.evaluate(async()=>{const p=window.__INHAGAME_P0__.smartphone;p.setAccount('qa-album-b');const records=await p.album.list();if(records.length!==1||records[0].id!==window.__otherPhoto.id)throw Error('Account isolation failed');p.setAccount('qa-album-a');});await releaseDecode();
      await open();await page.waitForTimeout(100);assert.equal(downloads,0);assert.equal(await page.evaluate(async()=>(await window.__INHAGAME_P0__.smartphone.album.list()).length),4);
      await pendingExport();await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.setAccount(null));await releaseDecode();await open();assert.equal(await page.getByRole('button',{name:'전체 사진 ZIP',exact:true}).isDisabled(),true);assert.equal(downloads,0);
      await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.setAccount('qa-album-a'));await open();
      await page.evaluate(async id=>{await window.__INHAGAME_P0__.smartphone.album.remove(id);},largeId);
      // Native IndexedDB corruption: missing original, then invalid image bytes, then oversized original.
      const first=expected[0].id;
      await page.evaluate(async id=>{window.__fixtureOriginal=await window.__INHAGAME_P0__.smartphone.album.image(id);},first);
      const replace=async kind=>page.evaluate(async({id,kind})=>{const a=window.__INHAGAME_P0__.smartphone.album,r=await a.read(id),request=indexedDB.open('inha-world-phone-v1',1);const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite'),s=tx.objectStore('images');if(kind==='missing')s.delete(r.imageRef);else s.put({key:r.imageRef,blob:kind==='corrupt'?new Blob(['broken'],{type:'image/png'}):kind==='large'?new Blob([window.__fixtureOriginal,new Uint8Array(33*1024*1024)],{type:'image/png'}):window.__fixtureOriginal});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},{id:first,kind});
      for(const kind of ['missing','corrupt','large']){await replace(kind);await open();await tap('전체 사진 ZIP');await page.getByText(kind==='large'?/한 번에 최대 100장·원본 32 MiB까지 가능/:/원본 사진이 없거나 손상/).waitFor();assert.equal(downloads,0);}
      await replace('restore');
      // Access denial and quota errors from real IDB adapter, no migration or real user storage.
      const storageFailures=await page.evaluate(async()=>{
        const {createPhoneAlbum}=await import('/src/phone/phone-album.js');
        const denied=createPhoneAlbum({indexedDB:{open(){throw new DOMException('QA denied','SecurityError');}}});
        let deniedRead=false;try{await denied.list();}catch{deniedRead=true;}
        const quota=createPhoneAlbum({indexedDB:{open(){throw new DOMException('QA full','QuotaExceededError');}},thumbnail:async b=>b});const saved=await quota.save({blob:new Blob(['synthetic'])});
        // Cross-scope poisoned references cannot read account B even from an account A record.
        const a=window.__INHAGAME_P0__.smartphone.album,r=(await a.list())[0],req=indexedDB.open('inha-world-phone-v1',1),db=await new Promise(resolve=>{req.onsuccess=()=>resolve(req.result);});
        await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key:`${a.scope}/${r.id}`,scope:a.scope,record:{...r,imageRef:window.__otherPhoto.imageRef}});tx.oncomplete=resolve;});
        let isolated=false;try{await a.image(r.id);}catch{isolated=true;}
        await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key:`${a.scope}/${r.id}`,scope:a.scope,record:r});tx.oncomplete=resolve;});db.close();
        return {deniedRead,deniedError:denied.error,saved,quotaError:quota.error,isolated};
      });assert.equal(storageFailures.deniedRead,true);assert.match(storageFailures.deniedError,/저장소/);assert.equal(storageFailures.saved,null);assert.match(storageFailures.quotaError,/부족/);assert.equal(storageFailures.isolated,true);
      await page.evaluate(()=>{window.__estimate=navigator.storage.estimate.bind(navigator.storage);navigator.storage.estimate=async()=>({usage:99,quota:100});});
      await open();await tap('저장공간 관리');await page.getByText(/브라우저 저장공간이 부족해요/).waitFor();
      await page.evaluate(()=>{navigator.storage.estimate=async()=>{throw Error('QA denied');};});await tap('뒤로');await tap('저장공간 관리');await page.getByText(/브라우저 저장공간 추정치에 접근하지 못/).waitFor();
      await page.evaluate(()=>{navigator.storage.estimate=undefined;});await tap('뒤로');await tap('저장공간 관리');await page.getByText(/이 브라우저는 사이트 저장공간 추정치를 제공하지/).waitFor();
      await page.evaluate(()=>{navigator.storage.estimate=window.__estimate;});
      entry.checks.push('download exception, cancel, A→B→A and logout abort, missing/corrupt/33 MiB original, denied IDB, quota failure, poisoned cross-account ref rejected, low/denied/unsupported site estimate');
    }
    entry.status='PASS';
  }catch(error){entry.status='FAIL';entry.error=String(error.stack??error);if(page)try{await page.screenshot({path:`${output}/${name}-failure.png`});}catch{}throw error;}
  finally{await smoke.close();await save();}
}
try{for(const args of [['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]])await run(...args);report.status='PASS';}
catch(error){report.status='FAIL';report.error=String(error.stack??error);process.exitCode=1;}
finally{await save();console.log(JSON.stringify(report,null,2));}
