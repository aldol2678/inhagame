import {dragTransform,projectedAxis,sceneHierarchy,canReparent,screenToGround} from './interaction.mjs';
const $=id=>document.getElementById(id);
const canvas=$('canvas');
const gl=canvas.getContext('webgl2',{antialias:true})||canvas.getContext('webgl',{antialias:true});
const ctx2d=!gl?canvas.getContext('2d'):null;
let scene={nodes:[],revisionToken:''},health={allowWrite:false,mode:'unknown'},selectedId=null,busy=false;
let yawCam=.7,pitchCam=.48,distance=18,moved=false,toolMode='move',snapEnabled=false;
let activeGizmo=null,liveTransform=null,pendingKind=null,placementPoint=null;
const collapsedNodes=new Set();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const status=(msg)=>{$('status').textContent=msg;};
const api=async(path,opts={})=>{const r=await fetch(path,{cache:'no-store',...opts});const x=await r.json();if(!r.ok)throw Error(x.error||'Request failed');return x;};
async function refresh(){scene=await api('/api/scene');$('node-count').textContent=scene.nodes.length;$('revision').textContent=scene.revisionToken.split(':').slice(0,2).join(' ').toUpperCase();if(!scene.nodes.some(n=>n.id===selectedId))selectedId=null;paintNodes();paintInspector();$('empty-hint').hidden=scene.nodes.length!==0;}
function chooseNode(id){selectedId=id;liveTransform=null;paintNodes();paintInspector();}
function reparentNode(id,parentId){
 if(!health.allowWrite||!canReparent(scene.nodes,id,parentId)){status('부모 변경 불가: 순환 또는 권한 제한');return;}
 send('node.reparent',{parentId},id);
}
function paintNodes(){
 const list=$('nodes');list.textContent='';
 const search=$('scene-search').value.trim().toLocaleLowerCase('ko');let hiddenDepth=-1;
 for(const row of sceneHierarchy(scene.nodes)){
  const n=row.node;
  if(hiddenDepth>=0){if(row.depth>hiddenDepth)continue;hiddenDepth=-1;}
  if(collapsedNodes.has(n.id))hiddenDepth=row.depth;
  if(search && !n.name.toLocaleLowerCase('ko').includes(search) && !n.id.toLowerCase().includes(search))continue;
  const wrapper=document.createElement('div');wrapper.className='node-row'+(selectedId===n.id?' selected':'');wrapper.style.setProperty('--depth',row.depth);wrapper.dataset.id=n.id;
  const indent=document.createElement('span');indent.className='indent';indent.style.width=`${Math.min(row.depth,8)*11}px`;
  const fold=document.createElement('button');fold.type='button';fold.className='fold';fold.textContent=row.hasChildren?(collapsedNodes.has(n.id)?'▸':'▾'):'·';fold.disabled=!row.hasChildren;fold.setAttribute('aria-label',`${n.name} 하위 오브젝트 접기/펼치기`);
  fold.onclick=()=>{if(collapsedNodes.has(n.id))collapsedNodes.delete(n.id);else collapsedNodes.add(n.id);paintNodes();};
  const button=document.createElement('button');button.className='node'+(selectedId===n.id?' selected':'');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(selectedId===n.id));button.draggable=health.allowWrite;
  const ico=document.createElement('span');ico.textContent='⬡';ico.className='mini-cube';
  const name=document.createElement('span');name.className='node-text';name.textContent=n.name;
  const desc=document.createElement('span');desc.className='desc';desc.textContent=n.componentKeys?.includes('core.renderable')?'ASSET':'OBJECT';
  button.append(ico,name,desc);button.onclick=()=>chooseNode(n.id);
  button.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-aldol-node',n.id);e.dataTransfer.effectAllowed='move';});
  wrapper.addEventListener('dragover',e=>{if(health.allowWrite&&e.dataTransfer.types.includes('application/x-aldol-node')){e.preventDefault();wrapper.classList.add('drop-target');}});
  wrapper.addEventListener('dragleave',()=>wrapper.classList.remove('drop-target'));
  wrapper.addEventListener('drop',e=>{e.preventDefault();wrapper.classList.remove('drop-target');const id=e.dataTransfer.getData('application/x-aldol-node');if(id)reparentNode(id,n.id);});
  wrapper.append(indent,fold,button);list.appendChild(wrapper);
 }
}
$('scene-search').addEventListener('input',paintNodes);
$('scene-root').addEventListener('dragover',e=>{if(health.allowWrite&&e.dataTransfer.types.includes('application/x-aldol-node')){e.preventDefault();$('scene-root').classList.add('drop-target');}});
$('scene-root').addEventListener('dragleave',()=>$('scene-root').classList.remove('drop-target'));
$('scene-root').addEventListener('drop',e=>{e.preventDefault();$('scene-root').classList.remove('drop-target');const id=e.dataTransfer.getData('application/x-aldol-node');if(id)reparentNode(id,null);});
const number=(n)=>Number(n.toFixed(3));
function paintInspector(){const n=scene.nodes.find(x=>x.id===selectedId);$('no-selection').hidden=Boolean(n);$('properties').hidden=!n;if(!n)return;
 $('node-name').value=n.name;$('node-id').textContent=n.id;$('components').textContent=n.componentKeys.length;
 const parent=$('node-parent');parent.textContent='';const root=document.createElement('option');root.value='';root.textContent='◇ 씬 루트';parent.append(root);for(const candidate of scene.nodes){if(candidate.id===n.id)continue;const opt=document.createElement('option');opt.value=candidate.id;opt.textContent=candidate.name;opt.disabled=!canReparent(scene.nodes,n.id,candidate.id);parent.append(opt);}parent.value=n.parentId??'';parent.disabled=!health.allowWrite;
 document.querySelectorAll('input[data-vector]').forEach(el=>{el.value=number(n.transform[el.dataset.vector][Number(el.dataset.axis)]);el.disabled=!health.allowWrite;});
 const r=n.transform.rotation;const yy=Math.atan2(2*(r[3]*r[1]+r[0]*r[2]),1-2*(r[1]*r[1]+r[2]*r[2]));$('yaw').value=number(yy*180/Math.PI);
 for(const id of ['node-name','yaw','duplicate','delete'])$(id).disabled=!health.allowWrite;
}
function cmd(operation,payload,targetId){return {commandId:(globalThis.crypto?.randomUUID?.()||'c.'+Date.now()+Math.random()),expectedRevision:scene.revisionToken,operation,payload,...(targetId?{targetId}:{})};}
async function mutate(url,payload){if(!health.allowWrite||busy)return false;busy=true;try{const result=await api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(result.status==='rejected'||result.status==='conflict')throw Error(result.diagnosticCode||result.status);await refresh();status(result.status==='applied'?'변경 반영':'변경 없음');return result.status==='applied';}catch(e){status('오류: '+e.message);await refresh().catch(()=>{});return false;}finally{busy=false;}}
async function send(operation,payload,targetId){return mutate('/api/command',cmd(operation,payload,targetId));}
const presets={Box:{name:'상자',scale:[1,1,1],y:.5},Column:{name:'기둥',scale:[.8,2.8,.8],y:1.4},Floor:{name:'바닥',scale:[6,.16,6],y:.08}};
async function create(kind,ground=[0,0,0]){
 if(!presets[kind]||!health.allowWrite)return false;
 const id=kind.toLowerCase()+'.'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));const config=presets[kind];
 const nth=scene.nodes.filter(n=>n.name.startsWith(config.name)).length+1;
 const ok=await send('node.create',{id,name:`${config.name} ${nth}`,kind:'prop',transform:{position:[ground[0],config.y,ground[2]],rotation:[0,0,0,1],scale:config.scale},components:{'world.structure':{shape:'box',sizeMeters:[1,1,1],color:'#b5a48c'}}});
 if(ok){chooseNode(id);setPlacement(null);}return ok;
}
function setPlacement(kind){pendingKind=kind;placementPoint=null;$('placement-banner').hidden=!kind;document.querySelector('.viewport').classList.toggle('placing',Boolean(kind));document.querySelectorAll('[data-prefab]').forEach(b=>b.classList.toggle('armed',b.dataset.prefab===kind));status(kind?`${presets[kind].name} 배치: 장면을 터치하거나 드롭하세요`:'Ready');}
for(const [id,kind] of [['add-box','Box'],['add-tall','Column'],['add-floor','Floor']]){
 const b=$(id);b.onclick=()=>setPlacement(pendingKind===kind?null:kind);
 b.addEventListener('dragstart',e=>{if(!health.allowWrite){e.preventDefault();return;}e.dataTransfer.setData('application/x-aldol-prefab',kind);e.dataTransfer.effectAllowed='copy';});
}
$('cancel-placement').onclick=()=>setPlacement(null);
$('node-parent').addEventListener('change',e=>{if(selectedId)reparentNode(selectedId,e.target.value||null);});
$('node-name').addEventListener('change',async e=>{const n=scene.nodes.find(x=>x.id===selectedId);if(n&&e.target.value.trim())await send('node.rename',{name:e.target.value.trim()},n.id);});
document.querySelectorAll('input[data-vector]').forEach(el=>el.addEventListener('change',async()=>{const n=scene.nodes.find(x=>x.id===selectedId);if(!n)return;const t=structuredClone(n.transform);t[el.dataset.vector][Number(el.dataset.axis)]=Number(el.value);await send('node.transform',{transform:t},n.id);}));
$('yaw').addEventListener('change',async()=>{const n=scene.nodes.find(x=>x.id===selectedId);if(!n)return;const t=structuredClone(n.transform),a=Number($('yaw').value)*Math.PI/360;t.rotation=[0,Math.sin(a),0,Math.cos(a)];await send('node.transform',{transform:t},n.id);});
$('duplicate').onclick=async()=>{if(selectedId)await send('node.duplicate',{},selectedId);};
$('delete').onclick=async()=>{if(selectedId)await send('node.delete',{},selectedId);};
$('undo').onclick=()=>mutate('/api/undo',{expectedRevision:scene.revisionToken});$('redo').onclick=()=>mutate('/api/redo',{expectedRevision:scene.revisionToken});
$('export').onclick=()=>{const a=document.createElement('a');a.href='/api/export';a.download='world.json';a.click();};
$('reset-view').onclick=()=>{yawCam=.7;pitchCam=.48;distance=18;};
function setTool(mode){if(!['move','rotate','scale'].includes(mode))return;toolMode=mode;document.querySelectorAll('[data-tool]').forEach(b=>{const active=b.dataset.tool===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('gizmo-overlay').className='gizmo-overlay '+mode;}
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool);
$('snap').onclick=()=>{snapEnabled=!snapEnabled;$('snap').setAttribute('aria-pressed',String(snapEnabled));};
window.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||''))return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$('undo').click();}else if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();$('redo').click();}else if(e.key==='Delete'&&selectedId){$('delete').click();}else if(e.key==='Escape'){if(activeGizmo){cancelGizmo();}else if(pendingKind){setPlacement(null);}else{chooseNode(null);}}else if(!e.ctrlKey&&!e.metaKey){const mode={w:'move',e:'rotate',r:'scale'}[e.key.toLowerCase()];if(mode)setTool(mode);}});

// WebGL primitive viewport. No external JS/CDN dependency, all rendering is local.
const vertex=`attribute vec3 aPos;attribute float aShade;uniform mat4 uMVP;varying float vShade;void main(){gl_Position=uMVP*vec4(aPos,1.);vShade=aShade;}`;
const frag=`precision mediump float;varying float vShade;uniform vec3 uColor;void main(){gl_FragColor=vec4(uColor*vShade,1.);}`;
const cube=[];const face=(v,shade)=>{const [a,b,c,d]=v;for(const p of [a,b,c,a,c,d])cube.push(...p,shade);};
face([[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],.98);
face([[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],.64);
face([[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]],.78);
face([[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],.86);
face([[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]],1.2);
face([[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],.6);
const grid=[];const line=(a,b)=>{grid.push(...a,1,...b,1);};for(let x=-10;x<=10;x++){line([x,0,-10],[x,0,10]);line([-10,0,x],[10,0,x]);}
const axis=[];const axisLine=(a,b)=>{axis.push(...a,1,...b,1);};axisLine([-10,.01,0],[10,.01,0]);axisLine([0,.01,-10],[0,.01,10]);
let prog,bufCube,bufGrid,bufAxes,uMVP,uColor,aPos,aShade,proj,view,pv;
const mat4mul=(a,b)=>{const o=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;};
const perspective=(fov,aspect,near,far)=>{const f=1/Math.tan(fov/2),r=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*r,-1,0,0,2*far*near*r,0]);};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const d=Math.hypot(...a)||1;return a.map(v=>v/d);};
const lookAt=(e,t)=>{const z=norm(e.map((v,i)=>v-t[i])),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1]);};
const modelMatrix=(pos,q,scale)=>{const [x,y,z,w]=q,[sx,sy,sz]=scale,[px,py,pz]=pos;
 return new Float32Array([(1-2*(y*y+z*z))*sx,(2*(x*y+z*w))*sx,(2*(x*z-y*w))*sx,0,(2*(x*y-z*w))*sy,(1-2*(x*x+z*z))*sy,(2*(y*z+x*w))*sy,0,(2*(x*z+y*w))*sz,(2*(y*z-x*w))*sz,(1-2*(x*x+y*y))*sz,0,px,py,pz,1]);};
function nodeModelMatrix(n,ancestors=new Set()){
 // Parent chain is applied in the renderer without changing legacy document data.
 const t=n.id===selectedId&&liveTransform?liveTransform:n.transform;
 const local=modelMatrix(t.position,t.rotation,t.scale);
 if(!n.parentId || ancestors.has(n.id))return local;
 const parent=scene.nodes.find(x=>x.id===n.parentId);
 if(!parent)return local;
 const next=new Set(ancestors);next.add(n.id);
 return mat4mul(nodeModelMatrix(parent,next),local);
}
function parentMatrix(n){
 const p=scene.nodes.find(x=>x.id===n.parentId);return p?nodeModelMatrix(p,new Set([n.id])):null;
}
function worldPoint(n,local){
 const parent=parentMatrix(n);if(!parent)return [...local];
 return [0,1,2].map(i=>parent[12+i]+parent[i]*local[0]+parent[4+i]*local[1]+parent[8+i]*local[2]);
}
function screenAxis(n,axis){
 const pos=n.id===selectedId&&liveTransform?liveTransform.position:n.transform.position;
 const base=worldPoint(n,pos),unit=[...pos];unit['xyz'.indexOf(axis)]++;
 const far=worldPoint(n,unit),pa=projected(base),pb=projected(far),dx=pb[0]-pa[0],dy=pb[1]-pa[1],len=Math.hypot(dx,dy);
 return {direction:len>1e-5?[dx/len,dy/len]:[1,0],pixelsPerMeter:len};
}
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function newBuf(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return b;}
if(gl){try{prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,frag));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));gl.useProgram(prog);aPos=gl.getAttribLocation(prog,'aPos');aShade=gl.getAttribLocation(prog,'aShade');uMVP=gl.getUniformLocation(prog,'uMVP');uColor=gl.getUniformLocation(prog,'uColor');bufCube=newBuf(cube);bufGrid=newBuf(grid);bufAxes=newBuf(axis);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);}catch(e){status('WebGL 오류: '+e.message);}}
else status(ctx2d?'Canvas 렌더러 활성화':'그래픽 컨텍스트 미지원');
const draw=(buf,arr,mvp,col,mode)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(aPos);gl.enableVertexAttribArray(aShade);gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,16,0);gl.vertexAttribPointer(aShade,1,gl.FLOAT,false,16,12);gl.uniformMatrix4fv(uMVP,false,mvp);gl.uniform3fv(uColor,col);gl.drawArrays(mode,0,arr.length/4);};
const projected=(pos)=>{const v=[...pos,1],out=[0,0,0,0];for(let r=0;r<4;r++)for(let c=0;c<4;c++)out[r]+=pv[c*4+r]*v[c];const w=out[3]||1;return [(out[0]/w*.5+.5)*canvas.clientWidth,(.5-out[1]/w*.5)*canvas.clientHeight,out[2]/w];};
function drawCanvasFallback(){
 const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
 if(canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));}
 ctx2d.setTransform(dpr,0,0,dpr,0,0);ctx2d.fillStyle='#14202c';ctx2d.fillRect(0,0,w,h);
 proj=perspective(Math.PI/4,w/Math.max(h,1),.1,150);
 const eye=[Math.sin(yawCam)*Math.cos(pitchCam)*distance,Math.sin(pitchCam)*distance,Math.cos(yawCam)*Math.cos(pitchCam)*distance];
 view=lookAt(eye,[0,0,0]);pv=mat4mul(proj,view);
 function stroke(a,b,color='#293748'){const pa=projected(a),pb=projected(b);ctx2d.beginPath();ctx2d.moveTo(pa[0],pa[1]);ctx2d.lineTo(pb[0],pb[1]);ctx2d.strokeStyle=color;ctx2d.lineWidth=1;ctx2d.stroke();}
 for(let x=-10;x<=10;x++){stroke([x,0,-10],[x,0,10],x===0?'#42566a':'#293748');stroke([-10,0,x],[10,0,x],x===0?'#42566a':'#293748');}
 const corner=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]];
 const faces=[[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[7,6,2,3],[0,1,5,4]];
 const drawables=[];
 for(const n of visualNodes()){if(!n.enabled)continue;const m=n.ghost?modelMatrix(n.transform.position,n.transform.rotation,n.transform.scale):nodeModelMatrix(n);
  const transformed=corner.map(v=>{const p=[];for(let row=0;row<3;row++)p[row]=m[12+row]+m[row]*v[0]+m[4+row]*v[1]+m[8+row]*v[2];return p;});
  faces.forEach((f,i)=>{const pts=f.map(j=>projected(transformed[j]));const depth=pts.reduce((s,p)=>s+p[2],0)/4;drawables.push({pts,depth,i,selected:n.id===selectedId});});
 }
 drawables.sort((a,b)=>b.depth-a.depth);
 const shade=[.93,.63,.70,.84,1,.54];
 for(const d of drawables){ctx2d.beginPath();d.pts.forEach((p,i)=>i?ctx2d.lineTo(p[0],p[1]):ctx2d.moveTo(p[0],p[1]));ctx2d.closePath();const n=shade[d.i];ctx2d.fillStyle=d.selected?`rgb(${Math.round(230*n)},${Math.round(187*n)},${Math.round(104*n)})`:`rgb(${Math.round(146*n)},${Math.round(183*n)},${Math.round(208*n)})`;ctx2d.fill();ctx2d.lineWidth=d.selected?1.3:.7;ctx2d.strokeStyle=d.selected?'#ffdd9a':'#2e4658';ctx2d.stroke();}
}
function frame(){if(!gl&&ctx2d){drawCanvasFallback();}if(gl&&prog){const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));}gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.075,.106,.145,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);proj=perspective(45*Math.PI/180,w/Math.max(h,1),.1,150);const eye=[Math.sin(yawCam)*Math.cos(pitchCam)*distance,Math.sin(pitchCam)*distance,Math.cos(yawCam)*Math.cos(pitchCam)*distance];view=lookAt(eye,[0,0,0]);pv=mat4mul(proj,view);gl.useProgram(prog);draw(bufGrid,grid,pv,[.17,.23,.31],gl.LINES);draw(bufAxes,axis,pv,[.32,.43,.56],gl.LINES);
 for(const n of visualNodes()){if(!n.enabled)continue;const model=n.ghost?modelMatrix(n.transform.position,n.transform.rotation,n.transform.scale):nodeModelMatrix(n),mat=mat4mul(pv,model);const color=n.id===selectedId?[.93,.74,.4]:n.ghost?[.92,.57,.26]:[.57,.71,.79];draw(bufCube,cube,mat,color,gl.TRIANGLES);}}
 syncGizmo();requestAnimationFrame(frame);}
requestAnimationFrame(frame);
function visualNodes(){
 const nodes=scene.nodes.map(n=>n.id===selectedId&&liveTransform?{...n,transform:liveTransform}:n);
 if(pendingKind&&placementPoint){const p=presets[pendingKind];nodes.push({id:'~placement',name:'배치 미리보기',enabled:true,ghost:true,transform:{position:[placementPoint[0],p.y,placementPoint[2]],rotation:[0,0,0,1],scale:p.scale}});}
 return nodes;
}
const overlay=$('gizmo-overlay'), svg=$('gizmo-lines'), handles=[...document.querySelectorAll('[data-gizmo-axis]')];
function syncGizmo(){
 const n=scene.nodes.find(x=>x.id===selectedId);
 if(!pv||!n||!health.allowWrite||pendingKind){overlay.hidden=true;return;}
 overlay.hidden=false;
 const pos=worldPoint(n,liveTransform?.position??n.transform.position);
 const center=projected(pos);const w=canvas.clientWidth,h=canvas.clientHeight;
 if(center[2]<-1||center[2]>1||center[0]<-100||center[0]>w+100||center[1]<-100||center[1]>h+100){overlay.hidden=true;return;}
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
 for(const b of handles){const axis=b.dataset.gizmoAxis;
  const v=screenAxis(n,axis);const vec=v.direction;const length=toolMode==='rotate'?77:65;
  b.hidden=toolMode==='move'&&v.pixelsPerMeter<3; if(b.hidden)continue;
  const x=center[0]+vec[0]*length,y=center[1]+vec[1]*length;
  b.style.left=`${x}px`;b.style.top=`${y}px`;
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [key,val] of Object.entries({x1:center[0],y1:center[1],x2:x,y2:y,stroke:{x:'#e77775',y:'#81c59b',z:'#78a8f4'}[axis],'stroke-width':'3','stroke-linecap':'round'}))line.setAttribute(key,val);svg.append(line);
 }
}
function cancelGizmo(){if(activeGizmo){activeGizmo=null;liveTransform=null;paintInspector();status('조작 취소');}}
for(const handle of handles){
 handle.addEventListener('pointerdown',e=>{
  const n=scene.nodes.find(x=>x.id===selectedId);if(!n||!health.allowWrite||busy||pendingKind)return;
  e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);
  activeGizmo={pointerId:e.pointerId,axis:handle.dataset.gizmoAxis,mode:toolMode,startX:e.clientX,startY:e.clientY,startTransform:structuredClone(n.transform),screenAxis:screenAxis(n,handle.dataset.gizmoAxis),selectedId};
 });
 handle.addEventListener('pointermove',e=>{
  if(!activeGizmo||activeGizmo.pointerId!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();const g=activeGizmo;
  liveTransform=dragTransform(g.startTransform,g.mode,g.axis,[e.clientX-g.startX,e.clientY-g.startY],g.screenAxis,{snap:snapEnabled});
 });
 handle.addEventListener('pointerup',async e=>{
  if(!activeGizmo||activeGizmo.pointerId!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();const g=activeGizmo;activeGizmo=null;
  const next=liveTransform;liveTransform=null;
  if(next&&JSON.stringify(next)!==JSON.stringify(g.startTransform))await send('node.transform',{transform:next},g.selectedId);
  else paintInspector();
 });
 handle.addEventListener('pointercancel',cancelGizmo);
 handle.addEventListener('lostpointercapture',()=>{if(activeGizmo)cancelGizmo();});
}
const touches=new Map();
function canvasPoint(e){const b=canvas.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];}
function getGround(e){const [x,y]=canvasPoint(e);return screenToGround(x,y,canvas.clientWidth,canvas.clientHeight,yawCam,pitchCam,distance);}
function pickNode(e){if(!scene.nodes.length||!pv)return;const [px,py]=canvasPoint(e);let nearest=null,best=50;for(const n of scene.nodes){const p=projected(worldPoint(n,n.transform.position));const d=Math.hypot(p[0]-px,p[1]-py);if(d<best&&p[2]>-1&&p[2]<1){best=d;nearest=n.id;}}if(nearest)chooseNode(nearest);else chooseNode(null);}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===1)moved=false;});
canvas.addEventListener('pointermove',e=>{
 if(pendingKind){placementPoint=getGround(e);}
 if(!touches.has(e.pointerId))return;
 const old=touches.get(e.pointerId);const dx=e.clientX-old.x,dy=e.clientY-old.y;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
 if(touches.size===1){if(!pendingKind){yawCam-=dx*.008;pitchCam=clamp(pitchCam+dy*.007,-1.3,1.3);}}
 else if(touches.size===2){const both=[...touches.values()];const d=Math.hypot(both[0].x-both[1].x,both[0].y-both[1].y);if(canvas._pinch)distance=clamp(distance*canvas._pinch/d,3,60);canvas._pinch=d;}
});
canvas.addEventListener('pointerup',async e=>{
 if(!moved&&touches.size===1){if(pendingKind){const p=getGround(e);if(p)await create(pendingKind,p);else status('바닥이 보이는 위치를 눌러 주세요');}else pickNode(e);}
 touches.delete(e.pointerId);if(touches.size<2)canvas._pinch=null;
});
canvas.addEventListener('pointercancel',e=>{touches.delete(e.pointerId);canvas._pinch=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();distance=clamp(distance*(e.deltaY>0?1.12:.89),3,60);},{passive:false});
canvas.addEventListener('dragover',e=>{if(health.allowWrite&&e.dataTransfer.types.includes('application/x-aldol-prefab')){e.preventDefault();e.dataTransfer.dropEffect='copy';placementPoint=getGround(e);}});
canvas.addEventListener('drop',async e=>{e.preventDefault();const kind=e.dataTransfer.getData('application/x-aldol-prefab');if(presets[kind]&&health.allowWrite){const p=getGround(e);if(p)await create(kind,p);else status('바닥 배치 지점이 유효하지 않음');}});
(async()=>{try{health=await api('/api/health');$('mode').textContent=health.mode==='demo-mock'?'DEMO · MOCK':'LEGACY · '+(health.allowWrite?'LOCAL':'READ ONLY');$('mode').classList.toggle('mock',health.mode==='demo-mock');$('connection').textContent='● '+(health.mode==='demo-mock'?'모의 장면':'INHA WORLD 편집기')+' / 127.0.0.1';for(const id of ['add-box','add-tall','add-floor','undo','redo'])$(id).disabled=!health.allowWrite;await refresh();status('Ready');}catch(e){status('서버 연결 오류: '+e.message);}})();
