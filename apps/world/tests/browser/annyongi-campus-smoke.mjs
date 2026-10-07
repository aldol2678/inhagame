import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output=process.env.ANNYONGI_OUTPUT||'test-results/annyongi';await mkdir(output,{recursive:true});
const results=[];
const frames=[];
async function screenshot(page,path) {
 const at=await page.evaluate(()=>window.__INHAGAME_P0__.app.frame);
 await page.waitForFunction(at=>window.__INHAGAME_P0__.app.frame>=at+3,at);
 const evidence=await page.evaluate(async()=>{
  const d=window.__INHAGAME_P0__,carrier=d.player.findByName('Annyongi_GLB_Visual');
  const pc=await import('playcanvas');const points=[];
  for(const component of carrier.findComponents('render'))for(const mi of component.meshInstances){
   const v=[];mi.mesh.getPositions(v);const transform=mi.node.getWorldTransform();
   for(let i=0;i<v.length;i+=3){const world=transform.transformPoint(new pc.Vec3(v[i],v[i+1],v[i+2]));const p=d.orbit.camera.camera.worldToScreen(world);points.push(p);}
  }
  return {state:d.character.flightVisualState??null, wings:['DragonWing_L','DragonWing_R'].map(n=>carrier.findByName(n).getLocalEulerAngles().toString()),
   bounds:{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))},width:innerWidth,height:innerHeight};
 });
 frames.push({file:path.split('/').at(-1),...evidence});
 if(evidence.state && /-(ascending|hover|flight|descending)\.png$/.test(path)) {
  const state=path.match(/-(ascending|hover|flight|descending)\.png$/)[1];
  assert.equal(evidence.state.mode,{ascending:'ascend',hover:'hover',flight:'forward',descending:'descend'}[state]);
 }
 if(/-(hover|ride-three-quarter)\.png$/.test(path)) {
  assert.ok(evidence.bounds.left>=0&&evidence.bounds.right<=evidence.width&&evidence.bounds.top>=0&&evidence.bounds.bottom<=evidence.height,'whole mascot stays framed: '+JSON.stringify(evidence));
 }
 await page.screenshot({path});
}
for(const time of (process.env.ANNYONGI_TIMES || 'day,night').split(',')) for(const [deviceName,viewport,touch] of [['desktop',{width:1280,height:800},false],['mobile',{width:390,height:844},true]]){
 const name=deviceName+'-'+time;
 const smoke=await startSmoke({viewport,contextOptions:touch?{isMobile:true,hasTouch:true,deviceScaleFactor:1}:{}});
 try {
 const page=await smoke.context.newPage();const fatal=smoke.watch(page);
 await page.goto(smoke.origin+'/campus/?envTime='+time+'&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS}),fatal]);
 await page.waitForFunction(()=>window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual'));
 const setup=await page.evaluate(()=>{
  const d=window.__INHAGAME_P0__,c=d.controller;
  // Exercise existing mount action in a clear synthetic test location, never grant an account item.
  d.player.setLocalPosition(15,c.groundY,10);c.grounded=true;c.velocityY=0;c.toggleMount();d.app.fire('update',.016);
  d.orbit.yaw=.6;d.orbit.pitch=.20; // Keep the shipping camera's default zoom.
  return {mounted:c.mounted,mountId:c.mountId,renderer:d.getStatus().renderer,model:d.player.findByName('Annyongi_GLB_Visual').enabled};
 });
 assert.equal(setup.mounted,true);assert.equal(setup.mountId,'annyongi');assert.equal(setup.model,true);
 await page.waitForFunction(()=>window.__INHAGAME_P0__.app.frame>10);
 await screenshot(page,`${output}/${name}-campus-mounted.png`);
 const before=await page.evaluate(()=>window.__INHAGAME_P0__.player.getLocalPosition().y);
 if(touch){
  const box=await page.locator('#jump').boundingBox();assert.ok(box);const cdp=await smoke.context.newCDPSession(page);page.touchSession=cdp;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
 }else await page.keyboard.down('Space');
 await page.waitForFunction(y=>window.__INHAGAME_P0__.player.getLocalPosition().y>y+.6,before,{timeout:15000});
 await screenshot(page,`${output}/${name}-ascending.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('Space');
 await screenshot(page,`${output}/${name}-hover.png`);
 const start=await page.evaluate(()=>{const p=window.__INHAGAME_P0__.player.getLocalPosition();return [p.x,p.z];});
 if(touch){const box=await page.locator('#joystick').boundingBox();await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.2,id:2}]});}else await page.keyboard.down('w');
 await page.waitForFunction(([x,z])=>{const p=window.__INHAGAME_P0__.player.getLocalPosition();return Math.hypot(p.x-x,p.z-z)>.7},start,{timeout:15000});
 await screenshot(page,`${output}/${name}-flight.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('w');
 const framing=await page.evaluate(()=>{const d=window.__INHAGAME_P0__,p=d.player.findByName('Annyongi_GLB_Visual').getPosition();const v=d.orbit.camera.camera.worldToScreen(p);return {x:v.x,y:v.y,w:innerWidth,h:innerHeight,visible:d.player.findByName('Annyongi_GLB_Visual').enabled};});
 assert.ok(framing.visible&&framing.x>0&&framing.x<framing.w&&framing.y>0&&framing.y<framing.h,JSON.stringify(framing));
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.yaw+=2.2;});
 await screenshot(page,`${output}/${name}-ride-three-quarter.png`);
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.yaw-=2.2;});
 const clipping=await page.evaluate(async()=>{
  const pc=await import('playcanvas');
  const d=window.__INHAGAME_P0__,carrier=d.player.findByName('Annyongi_GLB_Visual'),rider=d.player.findByName('Induck_GLB_Visual');
  // Check actual rider vertices in head/model space, not rotated world AABBs
  // (those overlap falsely when the separated boxes turn diagonally together).
  const inverse=carrier.getWorldTransform().clone().invert();let minimum=Infinity;
  for(const component of rider.findComponents('render')) for(const instance of component.meshInstances){
   const vertices=[];instance.mesh.getPositions(vertices);
   const transform=new pc.Mat4().mul2(inverse,instance.node.getWorldTransform());
   for(let i=0;i<vertices.length;i+=3){const p=transform.transformPoint(new pc.Vec3(...vertices.slice(i,i+3)));
    minimum=Math.min(minimum,(p.x/.69)**2+((p.y-.32)/.63)**2+((p.z-.12)/.52)**2);
   }
  }
  const headClip=minimum<1;
  const before=carrier.getLocalPosition().y;d.character.update(.13,{mounted:true,moving:false,grounded:false});const after=carrier.getLocalPosition().y;
  return {headClip,minimum,hover:before!==after,anchor:!!carrier.findByName('RiderAnchor')};
 });assert.equal(clipping.headClip,false);assert.equal(clipping.hover,true);
 // Actual input descent, then release before exercising automatic landing.
 const high=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;const p=d.player.getLocalPosition();d.player.setLocalPosition(p.x,d.controller.groundY+10,p.z);return d.player.getLocalPosition().y;});
 if(touch){const b=await page.locator('#descend').boundingBox();await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:3}]});}else await page.keyboard.down('c');
 await page.waitForFunction(y=>window.__INHAGAME_P0__.player.getLocalPosition().y<y-.6,high);
 await screenshot(page,`${output}/${name}-descending.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('c');
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.orbit.distance=d.orbit.zoomLimits.min;});
 await screenshot(page,`${output}/${name}-close.png`);
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.togglePerspective();});
 await page.waitForFunction(()=>!window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual').enabled);
 await screenshot(page,`${output}/${name}-first-person.png`);
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.orbit.togglePerspective();d.orbit.distance=d.orbit.zoomLimits.initial;d.controller.toggleMount();});
 await page.waitForFunction(()=>!window.__INHAGAME_P0__.controller.mounted,null,{timeout:30000});
 await screenshot(page,`${output}/${name}-landed.png`);
 assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual').enabled),false);
 assert.deepEqual(smoke.problems,[]);results.push({name,setup,clipping,passed:true});
 }catch(error){results.push({name,passed:false,error:String(error.stack??error),problems:smoke.problems});throw error;}
 finally{await writeFile(output+'/campus-results.json',JSON.stringify({results,frames},null,2));await smoke.close();}
}
console.log('Annyongi campus desktop/mobile day/night PASS');
