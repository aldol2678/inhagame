// Version 1 is a strict JSON contract, shared with private.learning_validate_progress.
// Native records are never coerced. Only the explicit legacy-import path may convert.
export const MAX_PROGRESS_WEIGHT=262144;
export const validLearningDay=v=>{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))return false;
  const d=new Date(`${v}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;
};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const fields=(v,ks)=>object(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const integer=(v,min=0,max=1000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const score=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100&&Number(v.toFixed(6))===v;
const qid=k=>/^qv:[a-zA-Z0-9_.-]{1,160}@[1-9]\d{0,8}$/.test(k);
const nullableDay=v=>v===null||validLearningDay(v);
// A deterministic conservative UTF-8 JSON bound. All accepted strings are ASCII;
// 32 bytes cover every accepted numeric representation. PostgreSQL uses the same cost.
export function progressWeight(v){
  if(v===null)return 4;if(typeof v==='number')return 32;if(typeof v==='boolean')return 5;
  if(typeof v==='string')return v.length+2;
  if(Array.isArray(v))return 2+v.reduce((n,x)=>n+progressWeight(x)+2,0);
  return 2+Object.entries(v).reduce((n,[k,x])=>n+k.length+4+progressWeight(x)+2,0);
}
export function validProgress(p){
  if(!fields(p,['version','completed','masteries','wrong','skillScores','languageSkills','learningHistory','bosses','languageBosses','speech'])||p.version!==1)return false;
  if(!Array.isArray(p.skillScores)||p.skillScores.length!==3||!p.skillScores.every(score)||!fields(p.languageSkills,['zh','ja'])||!Object.values(p.languageSkills).every(score))return false;
  for(const f of ['completed','masteries','wrong','learningHistory','bosses','languageBosses','speech']){
    if(!object(p[f])||Object.keys(p[f]).length>5000)return false;
    for(const [k,v] of Object.entries(p[f])){
      if(f==='completed'){if(!/^(e|zh|ja)\d{2}$/.test(k)||v!==true)return false;continue;}
      if(['masteries','wrong','speech'].includes(f)&&!qid(k))return false;
      if(f==='wrong'){if(v!==true)return false;continue;}
      if(f==='masteries'){
        if(!fields(v,['level','errors','streak','intervalDays','correctDays','lastCorrectDay','dueDate','needsRecheck'])||!integer(v.level,0,2)||!integer(v.intervalDays,1,14)||!['errors','streak','correctDays'].every(x=>integer(v[x]))||!nullableDay(v.lastCorrectDay)||!nullableDay(v.dueDate)||typeof v.needsRecheck!=='boolean')return false;
      }else if(f==='learningHistory'){
        if(!validLearningDay(k)||!fields(v,['answered','correct'])||!integer(v.answered)||!integer(v.correct,0,v.answered))return false;
      }else if(f==='speech'){
        if(!fields(v,['typed','mic','lastDay'])||!integer(v.typed)||!integer(v.mic)||!nullableDay(v.lastDay))return false;
      }else if(!(f==='bosses'?['0','1','2']:['zh','ja']).includes(k)||!fields(v,['count','best','passed','lastDate'])||!integer(v.count)||!integer(v.best,0,5)||typeof v.passed!=='boolean'||!nullableDay(v.lastDate))return false;
    }
  }
  return progressWeight(p)<=MAX_PROGRESS_WEIGHT;
}
export function sanitizeProgress(value){
  if(!validProgress(value))throw Error('INVALID_PROGRESS');
  return JSON.parse(JSON.stringify(value));
}
