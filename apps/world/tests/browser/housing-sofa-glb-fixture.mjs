import * as pc from 'playcanvas';
import {GRAPHICS_PRESETS} from '/src/graphics-presets.js';
import {createPersonalRoomScene} from '/src/rooms/personal-room-renderer.js';
import {createFurnitureLayer} from '/src/rooms/furniture-renderer.js';
import {captureFurnitureVisual,SOFA_VISUAL} from '/src/rooms/furniture-visual-assets.js';
import {furnitureAssetStatus} from '/src/rooms/furniture-glb-visual.js';
const qa=window.__SOFA_QA__={ready:false,frames:0};
try{
 const params=new URLSearchParams(location.search),mode=params.get('mode')??'glb',quality=params.get('quality')??'medium';
 const canvas=document.getElementById('stage'),device=await pc.createGraphicsDevice(canvas,{deviceTypes:[pc.DEVICETYPE_WEBGL2],antialias:quality==='high'});
 const app=new pc.Application(canvas,{graphicsDevice:device}),scene=createPersonalRoomScene(app);scene.root.enabled=true;app.scene.ambientLight=scene.ambient;
 // Same real room shell/fixtures and same renderer entry point for both branches.
 const layer=createFurnitureLayer(app,scene.root,{modelMode:mode==='procedural'?'procedural':'glb'});
 const camera=new pc.Entity('ABCamera');camera.addComponent('camera',{fov:42,nearClip:.03,farClip:100,clearColor:scene.clearColor});app.root.addChild(camera);const fit=Math.max(1,.8/(innerWidth/innerHeight));const cameraAt=[1.55*fit,.39+.81*fit,2.2*fit];camera.setPosition(...cameraAt);camera.lookAt(0,.39,0);
 const profile=GRAPHICS_PRESETS[quality];const ratio=Math.min(devicePixelRatio||1,profile.maxPixelRatio);device.resizeCanvas(Math.round(innerWidth*ratio),Math.round(innerHeight*ratio));
 const object=(i=0,yaw=0)=>({id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,itemId:SOFA_VISUAL.itemId,surface:'floor',x:i*1.5,z:0,yaw});
 const frames=[],cpuSubmission=[],start=performance.now();let last,cpuStart;
 app.on('prerender',()=>{cpuStart=performance.now();});
 app.on('postrender',()=>{if(cpuStart!==undefined)cpuSubmission.push(performance.now()-cpuStart);qa.frames++;if(last!==undefined)frames.push(performance.now()-last);last=performance.now();});
 qa.objects=[object()];layer.setObjects(qa.objects);app.start();await scene.ensureVisualAssets();await layer.whenVisualsReady();
 const gl=device.gl,debug=gl.getExtension('WEBGL_debug_renderer_info');
 const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const active=e=>{for(let n=e;n;n=n.parent)if(!n.enabled)return false;return true;};
 const snapshot=()=>{
  const renders=layer.root.findComponents('render').filter(c=>active(c.entity)),instances=renders.flatMap(c=>c.meshInstances);
  return {mode,quality,engine:pc.version,device:device.deviceType,renderer,hardwareGPU:/swiftshader|llvmpipe|software/i.test(renderer)?false:null,
   cameraAt,cameraTarget:[0,.39,0],graphicsProfile:profile,renderSize:[device.width,device.height],roomLightingPolicy:'existing non-shadowed practicals unchanged',visual:layer.visualStatus(),resources:furnitureAssetStatus(app),triangles:instances.reduce((sum,mi)=>sum+mi.mesh.primitive[0].count/3,0),meshInstances:instances.length,
   drawCalls:app.stats.drawCalls.total,cpuSubmissionMs:cpuSubmission.at(-1)??null,cpuSubmissionSamplesMs:cpuSubmission.slice(-60),engineFrameRenderTimeRaw:app.stats.frame.renderTime,engineFrameRenderTimeAccepted:false,frameIntervalsMs:frames.slice(-60),gpuFrameMs:null,gpuFrameReason:'No validated disjoint timer sample; CPU render duration is not GPU time',
   vram:{...device._vram},jsHeapBytes:performance.memory?.usedJSHeapSize??null,frames:qa.frames,loadMs:qa.loadMs,objects:qa.objects,obstacles:layer.obstacles};
 };
 qa.snapshot=snapshot;qa.loadMs=performance.now()-start;
 qa.cycle=async()=>{
  const records=[];
  for(let i=0;i<6;i++){
   qa.objects=[object(0,i*45),object(1)];layer.setObjects(qa.objects);await layer.whenVisualsReady();
   records.push({phase:'two',...snapshot()});
   // The same reset used by room/account authority, with an in-flight generation.
   layer.setObjects([]);layer.setObjects([object()]);layer.setObjects([]);
   await new Promise(r=>setTimeout(r,25));records.push({phase:'empty',resources:furnitureAssetStatus(app),vram:{...device._vram},children:layer.root.children.length});
  }
  qa.objects=[object()];layer.setObjects(qa.objects);await layer.whenVisualsReady();return records;
 };
 qa.capture=async()=>captureFurnitureVisual(layer,()=>new Promise(resolve=>{app.once('postrender',()=>resolve(canvas.toDataURL('image/png')));app.renderNextFrame=true;}),{viewKey:JSON.stringify({quality,camera:cameraAt,target:[0,.39,0],size:[device.width,device.height]})});
 qa.dispose=()=>{layer.root.destroy();};
 qa.ready=true;document.getElementById('status').textContent=`${mode.toUpperCase()} · ${quality} · PlayCanvas ${pc.version}\nIdentical room / camera / placement · ${renderer}`;
}catch(error){qa.error=error.stack??String(error);document.getElementById('status').textContent=qa.error;console.error(error);}
