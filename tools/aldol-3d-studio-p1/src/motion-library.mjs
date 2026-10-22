import {createHash} from 'node:crypto';

// Session-local, engine-neutral motion data. This module never touches WorldDocument,
// the GLB static-only renderer, filesystem, production assets, or network.
const fail = code => {throw Error(code);};
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => Object.keys(v).every(k => keys.includes(k));
const idOK = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v);
const jointOK = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(v) && !['constructor','prototype','__proto__'].includes(v);
const numeric = v => typeof v === 'number' && Number.isFinite(v);
const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(x=>numeric(x) && Math.abs(x)<=1e6);
const clone = x => structuredClone(x);
const keyOf = t => t.joint + '/' + t.channel;
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const maximum = (n, limit) => Number.isInteger(n) && n > 0 && n <= limit;
const channels = {translation:3, rotation:4, scale:3};

export function validateMotionClip(raw) {
  if (!obj(raw) || !only(raw,['id','name','duration','fps','skeleton','tracks']) || !idOK(raw.id) ||
      typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 100 ||
      !numeric(raw.duration) || raw.duration <= 0 || raw.duration > 600 ||
      !maximum(raw.fps,240) || !Array.isArray(raw.skeleton) || !raw.skeleton.length || raw.skeleton.length>128 ||
      !raw.skeleton.every(jointOK) || new Set(raw.skeleton).size !== raw.skeleton.length ||
      !Array.isArray(raw.tracks) || !raw.tracks.length || raw.tracks.length>256) fail('E_MOTION_SCHEMA');
  let encoded;
  try {encoded = JSON.stringify(raw);} catch {fail('E_MOTION_JSON');}
  if (!encoded || Buffer.byteLength(encoded) > 1024*1024) fail('E_MOTION_TOO_LARGE');
  const pairs = new Set(), skeleton = new Set(raw.skeleton);
  let frameCount=0;
  for (const track of raw.tracks) {
    if (!obj(track) || !only(track,['joint','channel','frames']) || !skeleton.has(track.joint) ||
        !Object.hasOwn(channels,track.channel) || !Array.isArray(track.frames) ||
        !track.frames.length || track.frames.length > 2048) fail('E_MOTION_TRACK');
    const key=keyOf(track); if(pairs.has(key))fail('E_MOTION_DUPLICATE_TRACK');pairs.add(key);
    let previous=-1;
    for(const frame of track.frames) {
      if(!obj(frame) || !only(frame,['time','value']) || !numeric(frame.time) ||
         frame.time<0 || frame.time>raw.duration || frame.time<=previous ||
         !vector(frame.value,channels[track.channel])) fail('E_MOTION_FRAME');
      if(track.channel==='rotation' && Math.abs(Math.hypot(...frame.value)-1)>0.005)fail('E_MOTION_QUATERNION');
      if(track.channel==='scale' && frame.value.some(x=>x<=0))fail('E_MOTION_SCALE');
      previous=frame.time;
      if(++frameCount>8192)fail('E_MOTION_FRAME_LIMIT');
    }
  }
  const clip=clone(raw);
  return {clip,sha256:digest(clip),stats:{joints:clip.skeleton.length,tracks:clip.tracks.length,frames:frameCount,duration:clip.duration}};
}
function sample(track,time) {
  const f=track.frames;
  if(time<=f[0].time)return [...f[0].value];
  if(time>=f.at(-1).time)return [...f.at(-1).value];
  let lo=0,hi=f.length-1;
  while(hi-lo>1){const m=(hi+lo)>>1;if(f[m].time<=time)lo=m;else hi=m;}
  const a=f[lo],b=f[hi],alpha=(time-a.time)/(b.time-a.time);
  return interpolate(a.value,b.value,alpha,track.channel);
}
function interpolate(a,b,t,channel){
  if(channel!=='rotation')return a.map((v,i)=>v+(b[i]-v)*t);
  const sign=a.reduce((s,v,i)=>s+v*b[i],0)<0?-1:1;
  const v=a.map((x,i)=>x*(1-t)+b[i]*sign*t);
  const magnitude=Math.hypot(...v);
  if(magnitude<1e-9)fail('E_MOTION_QUATERNION');
  return v.map(x=>x/magnitude);
}
export class MotionLibrary {
  constructor(){this.records=new Map();this.bytes=0;}
  library(){return {format:'aldol.motion.clip/1',sessionOnly:true,renderingSupported:false,clips:[...this.records.values()].map(({clip,sha256,stats})=>({id:clip.id,name:clip.name,sha256,...stats}))};}
  validate(args={}){
    const record=args.id!==undefined?this._record(args.id):validateMotionClip(args.clip);
    return {valid:true,sha256:record.sha256,...record.stats,engineRenderQA:'NOT_SUPPORTED',format:'aldol.motion.clip/1'};
  }
  _record(id){if(!idOK(id)||!this.records.has(id))fail('E_MOTION_NOT_FOUND');return this.records.get(id);}
  import(clip){
    const record=validateMotionClip(clip),before=this.records.get(record.clip.id);
    if(before){if(before.sha256!==record.sha256)fail('E_MOTION_ID_CONFLICT');return {status:'unchanged',id:record.clip.id,sha256:record.sha256};}
    const size=Buffer.byteLength(JSON.stringify(record.clip));
    if(this.records.size>=64 || this.bytes+size>8*1024*1024)fail('E_MOTION_LIBRARY_LIMIT');
    this.records.set(record.clip.id,record);this.bytes+=size;
    return {status:'imported',id:record.clip.id,sha256:record.sha256,sessionOnly:true,...record.stats};
  }
  retarget({sourceId,id,name,targetSkeleton,mapping={}}){
    const source=this._record(sourceId).clip;
    if(!idOK(id)||!obj(mapping)||!only(mapping,source.skeleton)||
       !Array.isArray(targetSkeleton)||targetSkeleton.length!==source.skeleton.length||
       !targetSkeleton.every(jointOK)||new Set(targetSkeleton).size!==targetSkeleton.length)fail('E_MOTION_RETARGET');
    const sourceTargets=source.skeleton.map(j=>Object.hasOwn(mapping,j)?mapping[j]:j);
    if(!sourceTargets.every(j=>targetSkeleton.includes(j))||new Set(sourceTargets).size!==sourceTargets.length)fail('E_MOTION_RETARGET_MAP');
    const rename=new Map(source.skeleton.map((j,i)=>[j,sourceTargets[i]]));
    const clip={id,name:name??source.name+' (retargeted)',duration:source.duration,fps:source.fps,skeleton:[...targetSkeleton],
      tracks:source.tracks.map(t=>({...clone(t),joint:rename.get(t.joint)}))};
    const result=this.import(clip);
    return {...result,method:'JOINT_NAME_MAPPING_ONLY',translationScaleCorrected:false,ikSolved:false};
  }
  blend({aId,bId,time,alpha}){
    const a=this._record(aId).clip,b=this._record(bId).clip;
    if(!numeric(time)||time<0||!numeric(alpha)||alpha<0||alpha>1)fail('E_MOTION_BLEND');
    const ka=new Map(a.tracks.map(t=>[keyOf(t),t])),kb=new Map(b.tracks.map(t=>[keyOf(t),t]));
    if(ka.size!==kb.size||[...ka.keys()].some(k=>!kb.has(k))||
       a.skeleton.length!==b.skeleton.length||a.skeleton.some(j=>!b.skeleton.includes(j)))fail('E_MOTION_SKELETON_MISMATCH');
    const tracks=[];
    for(const [key,t] of ka){
      const ta=Math.min(time,a.duration),tb=Math.min(time,b.duration);
      tracks.push({joint:t.joint,channel:t.channel,value:interpolate(sample(t,ta),sample(kb.get(key),tb),alpha,t.channel)});
    }
    return {format:'aldol.motion.pose/1',aId,bId,time,alpha,tracks,interpolation:'LINEAR_TRANSLATION_SCALE_NLERP_ROTATION',renderingSupported:false};
  }
  export(id) {
    const record=this._record(id);
    return {format:'aldol.motion.clip/1',sha256:record.sha256,clip:clone(record.clip),sessionOnly:true,glbExportSupported:false};
  }
}
