// Pure diagnostics shared by the browser fixture and its Node regression tests.
export const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.4/build/playcanvas.mjs';
export const LIFE_VIEWPORTS = Object.freeze([
  { name:'desktop', width:1280, height:800 },
  { name:'portrait', width:390, height:844 },
  { name:'landscape', width:844, height:390 }
]);
const dot = (a,b) => a.reduce((sum,n,i) => sum+n*b[i],0);
const normalize = vector => {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) throw Error('Invalid camera direction');
  return vector.map(n => n/length);
};
export function fitDiagnosticPoints(points, { aspect, direction=[-1,.35,-2], fov=40, margin=.8 }={}) {
  if (!points?.length || !points.every(p => p.length===3 && p.every(Number.isFinite)) || !(aspect>0 && Number.isFinite(aspect))) throw Error('Invalid diagnostic mesh bounds/aspect');
  const target=[0,1,2].map(i => (Math.min(...points.map(p=>p[i])) + Math.max(...points.map(p=>p[i])))/2);
  const back=normalize(direction), right=normalize([back[2],0,-back[0]]);
  const up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
  const tan=Math.tan(fov*Math.PI/360);
  let distance=.01;
  for (const p of points) {
    const delta=p.map((n,i)=>n-target[i]), toward=dot(delta,back);
    distance=Math.max(distance,toward+.01,toward+Math.abs(dot(delta,right))/(tan*aspect*margin),toward+Math.abs(dot(delta,up))/(tan*margin));
  }
  return {position:target.map((n,i)=>n+distance*back[i]),target,back,right,up,tan,aspect,distance,fov};
}
export function framebufferEvidence(data,width,height,{previous=null,roi=null,clearRgb=Array.from(data.subarray(0,3))}={}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<=0 || height<=0 || data.length!==width*height*4 || (previous && previous.length!==data.length)) throw Error('Invalid framebuffer dimensions');
  if (roi && (!Object.values(roi).every(Number.isFinite) || roi.minX<0 || roi.maxX>width || roi.minY<0 || roi.maxY>height || roi.maxX<=roi.minX || roi.maxY<=roi.minY)) throw Error('Invalid framebuffer ROI');
  let hash=2166136261,foreground=0,changed=0,roiChanged=0;
  for (let i=0;i<data.length;i+=4) {
    if (Math.abs(data[i]-clearRgb[0])+Math.abs(data[i+1]-clearRgb[1])+Math.abs(data[i+2]-clearRgb[2])>15) foreground++;
    if (previous && Math.abs(data[i]-previous[i])+Math.abs(data[i+1]-previous[i+1])+Math.abs(data[i+2]-previous[i+2])>15) {
      changed++;
      const x=i/4%width,y=height-1-Math.floor(i/4/width);
      if (roi && x>=roi.minX && x<roi.maxX && y>=roi.minY && y<roi.maxY) roiChanged++;
    }
    for(let k=0;k<3;k++) hash=Math.imul((hash^data[i+k])>>>0,16777619);
  }
  return {width,height,hash:hash>>>0,foreground,changed,roiChanged,roi};
}
export function allowedFixtureRequest(url,method,origin) {
  if (!['GET','HEAD'].includes(method)) return false;
  if (url===ENGINE_URL) return true;
  const parsed=new URL(url);
  if(parsed.origin!==origin || parsed.search) return false;
  return parsed.pathname === '/data/reality/campus-landmarks.json'
    || /^\/tests\/browser\/life-props-browser-[a-z-]+\.(?:html|mjs)$/.test(parsed.pathname)
    || /^\/npc-factory\/[a-z0-9-]+\.mjs$/.test(parsed.pathname)
    || /^\/src\/[a-zA-Z0-9_/-]+\.js$/.test(parsed.pathname)
    || /^\/assets\/life-props-v1\/(?:[a-z_]+\.glb|attachment-spec\.json|manifest\.json)$/.test(parsed.pathname);
}
