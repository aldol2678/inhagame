/**
 * Real localhost-served Chromium QA, intended for a normal GitHub Actions runner.
 * Does not certify PlayCanvas / GPU hardware / physical mobile devices.
 */
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=process.cwd();
const root=resolve(repo,'tools/aldol-3d-studio-p1');
const require=createRequire(resolve(repo,'apps/world/tests/browser/package.json'));
const {chromium}=require('playwright');
const runner=spawn(process.execPath,['bin/dev-server.mjs','--demo','--allow-write','--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
const ready=new Promise((ok,fail)=>{let buf='';runner.stdout.on('data',part=>{buf+=part.toString();const found=buf.match(/http:\/\/127\.0\.0\.1:\d+/);if(found)ok(found[0]);});runner.on('exit',code=>fail(Error('Studio server exited '+code)));});
const timeout=new Promise((_,fail)=>setTimeout(()=>fail(Error('Server start timeout')),9000));
const host=await Promise.race([ready,timeout]);
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const pageErrors=[];
 const desktop=await browser.newPage({viewport:{width:1360,height:800}});
 desktop.on('pageerror',e=>pageErrors.push(String(e)));
 const response=await desktop.goto(host+'/',{waitUntil:'networkidle',timeout:30000});
 assert.equal(response.status(),200);
 await desktop.waitForFunction(()=>document.querySelector('#mode')?.textContent!=='연결 확인 중');
 const renderer=await desktop.locator('#renderer-status').getAttribute('data-mode');
 assert.ok(['webgl','canvas'].includes(renderer),'Renderer did not initialize: '+renderer);
 const esm=await desktop.request.get(host+'/interaction.mjs');
 assert.ok(esm.headers()['content-type'].startsWith('text/javascript'));
 const before=await desktop.locator('.viewport').screenshot();
 await desktop.locator('#add-box').click();
 const box=await desktop.locator('#canvas').boundingBox();
 await desktop.mouse.click(box.x+box.width/2,box.y+box.height*.7);
 await desktop.waitForFunction(()=>document.querySelectorAll('.node-row').length===1);
 await desktop.waitForTimeout(150);
 const after=await desktop.locator('.viewport').screenshot();
 const changed=await desktop.evaluate(async([a,b])=>{
  async function pixels(base64){const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}
  const old=await pixels(a),next=await pixels(b);let count=0;
  for(let i=0;i<old.length;i+=4)if(Math.abs(old[i]-next[i])+Math.abs(old[i+1]-next[i+1])+Math.abs(old[i+2]-next[i+2])>75)count++;
  return count;
 },[before.toString('base64'),after.toString('base64')]);
 assert.ok(changed>2500,'No meaningful actual scene pixels changed: '+changed);
 await mkdir('test-results/aldol-studio-p1-1',{recursive:true});
 await desktop.screenshot({path:'test-results/aldol-studio-p1-1/desktop.png',fullPage:true});
 console.log('P11_RENDER_PIXELS_PASS renderer='+renderer+' changedPixels='+changed);
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 mobile.on('pageerror',e=>pageErrors.push(String(e)));
 await mobile.goto(host+'/',{waitUntil:'networkidle',timeout:30000});
 await mobile.waitForFunction(()=>document.querySelector('#mode')?.textContent!=='연결 확인 중');
 await mobile.locator('#add-floor').click();
 const beforeCount=await mobile.locator('.node-row').count(),mobBox=await mobile.locator('#canvas').boundingBox();
 const cx=Math.floor(mobBox.x+mobBox.width*.5),cy=Math.floor(mobBox.y+mobBox.height*.65);
 const cdp=await mobile.context().newCDPSession(mobile);
 const p=(x,y,id)=>({x:Math.floor(x),y:Math.floor(y),id,radiusX:8,radiusY:8,force:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(cx-20,cy,1),p(cx+20,cy,2)]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(cx-42,cy,1),p(cx+42,cy,2)]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await mobile.waitForTimeout(170);
 assert.equal(await mobile.locator('.node-row').count(),beforeCount,'Multi-touch unexpectedly placed an object');
 await mobile.touchscreen.tap(cx,cy);
 await mobile.waitForFunction(n=>document.querySelectorAll('.node-row').length===n+1,beforeCount);
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile horizontal overflow');
 assert.deepEqual(pageErrors,[]);
 await mobile.screenshot({path:'test-results/aldol-studio-p1-1/mobile.png',fullPage:true});
 console.log('P11_MOBILE_EMULATION_PASS pinchNoGhostPlacement=true touchPlacement=true overflow=false');
 console.log('REMAINING_NOT_VERIFIED PlayCanvas runtime, physical touch devices, production hosting');
}finally{
 if(browser)await browser.close();
 runner.kill('SIGTERM');
}
