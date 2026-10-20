import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(resolve(process.cwd(),'apps/world/tests/browser/package.json'));
const {chromium}=require('playwright');
const folder=resolve(process.cwd(),'tools/aldol-3d-studio-p1');
function fileGlb(){
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[]}]}));
 const j=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
 const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+j.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([h,j]);
}
const bytes=fileGlb(),hash=createHash('sha256').update(bytes).digest('hex');
const manifest=Buffer.from(JSON.stringify({project_id:'factory_20261021',assets:[{id:'sample-01',file:'assets/sample.glb',byte_size:bytes.length,sha256:hash,status:'PASS'}]}));
const runner=spawn(process.execPath,['bin/dev-server.mjs','--demo','--allow-write','--port','0'],{cwd:folder,stdio:['ignore','pipe','pipe']});
let output='';const host=await Promise.race([new Promise((yes,no)=>{runner.stdout.on('data',p=>{output+=p.toString();const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)yes(match[0]);});runner.on('exit',code=>no(Error('server exit '+code+' '+output)));}),new Promise((_,no)=>setTimeout(()=>no(Error('server timeout')),10000))]);
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1360,height:840}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await page.goto(host+'/',{waitUntil:'networkidle'})).status(),200);
 await page.waitForFunction(()=>!document.getElementById('factory-import').disabled||document.getElementById('mode').textContent.includes('DEMO'));
 await page.locator('#factory-file').setInputFiles({name:'sample.glb',mimeType:'model/gltf-binary',buffer:bytes});
 await page.locator('#factory-manifest').setInputFiles({name:'mcp-request.json',mimeType:'application/json',buffer:manifest});
 await page.locator('#factory-import').click();
 await page.waitForFunction(()=>document.querySelectorAll('.factory-asset').length===1);
 assert.match(await page.locator('#status').textContent(),/검증|등록/);
 const row=page.locator('.factory-asset');assert.match(await row.textContent(),/sample.glb/);
 await row.getByText('프록시 배치').click();
 await page.waitForFunction(()=>document.querySelectorAll('.node-row').length===1);
 const r=await page.request.get(host+'/api/assets/package');
 assert.equal(r.status(),200);const zip=await r.body();assert.ok(zip.includes(bytes));
 const world=await (await page.request.get(host+'/api/export')).json();
 assert.equal(world.entities[0].components['core.renderable'].assetId,world.assets[0].id);
 assert.match(world.assets[0].uri,/^assets\/[a-f0-9]{64}\.glb$/);
 assert.deepEqual(errors,[]);
 await mkdir('test-results/aldol-studio-p2',{recursive:true});
 await page.screenshot({path:'test-results/aldol-studio-p2/desktop.png',fullPage:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.goto(host+'/',{waitUntil:'networkidle'});
 assert.ok(await mobile.locator('#factory-file').count()===1);
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await mobile.screenshot({path:'test-results/aldol-studio-p2/mobile.png',fullPage:true});
 console.log('FACTORY_P2_BROWSER_PASS original_bytes=true sha256='+hash+' scene_asset_link=true mobile_layout=true');
}finally{if(browser)await browser.close();runner.kill('SIGTERM');}
