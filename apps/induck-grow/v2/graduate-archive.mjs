import {CAMPUS_STORY_VERSION,buildTurningPoints} from './campus-stories.mjs';
import {PLAY_STYLE_VERSION,playStyleSummary} from './play-style.mjs';
import {ECONOMY_VERSION,spendingCards} from './life-spending.mjs';
import {growthCards,earnedTraits,GROWTH_VERSION} from './campus-growth.mjs';
export const GRADUATE_ARCHIVE_KEY='induck-grow-v2-graduates-1';
export const GRADUATE_ARCHIVE_SCHEMA='grow2-graduates-1';
const LIMIT=50,MAX_BYTES=2*1024*1024;
export function graduateSummary(life) {
  if(life?.status!=='complete'||life.weeksCompleted!==120||life.semesters?.length!==8||!life.ending)
    throw new Error('Only completed lives can be archived');
  const playStyle=playStyleSummary(life);
  return {...(life.campusStories?{campusStoryVersion:CAMPUS_STORY_VERSION,turningPoints:buildTurningPoints(life)}:{}),...(playStyle?{playStyle}:{}),...(life.spending?{economy:life.spending.version}:{}),engine:life.version,content:life.contentVersion||'grow2-content-0.1',
    growth:life.growth?.version||'legacy',majorId:life.majorId,seed:life.seed,
    gpa:life.gpa,title:life.ending.title,
    semesters:life.semesters.map(s=>({gpa:s.gpa})),
    cards:[...growthCards(life),...spendingCards(life)],traits:earnedTraits(life),
    epilogue:life.ending.epilogue?.chapters.map(x=>x.text)||[]};
}
function validTurningPoints(x) {
  if(x.campusStoryVersion===undefined)return x.turningPoints===undefined;
  return x.campusStoryVersion===CAMPUS_STORY_VERSION&&Array.isArray(x.turningPoints)&&
    x.turningPoints.length===2&&x.turningPoints[0]?.id==='campus.friend'&&
    ['campus.retry','campus.project'].includes(x.turningPoints[1]?.id)&&
    new Set(x.turningPoints.map(c=>c?.id)).size===x.turningPoints.length&&
    x.turningPoints.every(c=>c&&Object.keys(c).sort().join(',')==='id,kind,text,title'&&
      ['id','kind','title','text'].every(k=>typeof c[k]==='string'&&c[k].length>0&&c[k].length<2000));
}
function validRecord(x) {
  return x&&validTurningPoints(x)&&(x.playStyle===undefined||(
    x.playStyle&&Object.keys(x.playStyle).sort().join(',')==='basicWeeks,simpleWeeks,version'&&
    x.playStyle.version===PLAY_STYLE_VERSION&&Number.isInteger(x.playStyle.simpleWeeks)&&
    x.playStyle.simpleWeeks>=0&&x.playStyle.simpleWeeks<=120&&Number.isInteger(x.playStyle.basicWeeks)&&
    x.playStyle.basicWeeks>=0&&x.playStyle.basicWeeks+x.playStyle.simpleWeeks===120))&&(x.economy===undefined||x.economy===ECONOMY_VERSION)&&x.engine==='grow2-life-engine-0.1'&&
    ['grow2-content-0.1','grow2-content-major-stories-1'].includes(x.content)&&
    ['legacy',GROWTH_VERSION].includes(x.growth)&&typeof x.majorId==='string'&&x.majorId.length<50&&
    Number.isInteger(x.seed)&&x.seed>=0&&x.seed<=0xffffffff&&Number.isFinite(x.gpa)&&x.gpa>=0&&x.gpa<=4.5&&
    typeof x.title==='string'&&x.title.length<300&&Array.isArray(x.semesters)&&x.semesters.length===8&&
    x.semesters.every(s=>Number.isFinite(s?.gpa)&&s.gpa>=0&&s.gpa<=4.5)&&
    x.gpa===Number((x.semesters.reduce((a,s)=>a+s.gpa*18,0)/144).toFixed(2))&&
    Array.isArray(x.cards)&&x.cards.length<=100&&x.cards.every(c=>['id','kind','title','text'].every(k=>typeof c?.[k]==='string'&&c[k].length<2000))&&
    Array.isArray(x.traits)&&x.traits.length<=20&&x.traits.every(t=>typeof t?.id==='string'&&typeof t.title==='string'&&t.title.length<100)&&
    Array.isArray(x.epilogue)&&x.epilogue.length<=3&&x.epilogue.every(t=>typeof t==='string'&&t.length<3000);
}
export function rankGraduates(records) {
  const groups=new Map();
  records.forEach((record,index)=>{
    const group=[record.engine,record.content,record.growth,record.economy||'legacy',record.majorId,record.playStyle?.simpleWeeks>0?'simple-used':'basic-only',...(record.campusStoryVersion?[record.campusStoryVersion]:[])].join('|');
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push({record,index,group});
  });
  return [...groups.values()].flatMap(list=>{
    list.sort((a,b)=>b.record.gpa-a.record.gpa||a.index-b.index);
    let previous=null,rank=0;
    return list.map((x,i)=>{if(x.record.gpa!==previous)rank=i+1;previous=x.record.gpa;return {...x,rank};});
  });
}
export function createGraduateArchive(storage) {
  function read() {
    if(!storage)return {ok:false,records:[],error:'졸업 기록실 저장소를 사용할 수 없어요.'};
    try {
      const raw=storage.getItem(GRADUATE_ARCHIVE_KEY);
      if(raw===null)return {ok:true,records:[],raw};
      if(raw.length>MAX_BYTES)throw Error('size');
      const p=JSON.parse(raw);
      if(p?.schema!==GRADUATE_ARCHIVE_SCHEMA||!Array.isArray(p.records)||p.records.length>LIMIT||!p.records.every(validRecord))throw Error('invalid');
      return {ok:true,records:p.records,raw};
    }catch{return {ok:false,records:[],error:'졸업 기록실을 읽을 수 없어요. 원본은 보존했어요.'};}
  }
  function add(life) {
    const snapshot=read();if(!snapshot.ok)return snapshot;
    try {
      const record=graduateSummary(life);
      if(!validRecord(record))throw Error('invalid summary');
      const key=JSON.stringify(record);
      if(snapshot.records.some(r=>JSON.stringify(r)===key))return {...snapshot,duplicate:true};
      if(snapshot.records.length>=LIMIT)return {ok:false,error:'졸업 기록실 50건이 가득 찼어요. 기존 기록은 보존했어요.'};
      const raw=JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[...snapshot.records,record]});
      if(raw.length>MAX_BYTES)throw Error('size');
      if(storage.getItem(GRADUATE_ARCHIVE_KEY)!==snapshot.raw)throw Error('changed');
      storage.setItem(GRADUATE_ARCHIVE_KEY,raw);
      if(storage.getItem(GRADUATE_ARCHIVE_KEY)!==raw)throw Error('readback');
      return {ok:true,records:[...snapshot.records,record]};
    }catch{return {ok:false,error:'졸업 기록 보관에 실패했어요. 새 게임으로 교체하지 말고 다시 시도해 주세요.'};}
  }
  function exportSnapshot() {
    const snapshot=read();
    if(!snapshot.ok)return snapshot;
    return {ok:true,count:snapshot.records.length,json:JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:snapshot.records},null,2)};
  }
  function remove(recordKey,guard=()=>true) {
    const snapshot=read();if(!snapshot.ok)return snapshot;
    const matches=snapshot.records.map((r,i)=>JSON.stringify(r)===recordKey?i:-1).filter(i=>i>=0);
    const index=matches[0];
    if(matches.length!==1)return {ok:false,error:'선택한 기록이 변경되었어요. 목록을 새로고침해 주세요.'};
    const records=snapshot.records.filter((_,i)=>i!==index);
    const raw=JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records});
    try {
      if(storage.getItem(GRADUATE_ARCHIVE_KEY)!==snapshot.raw || !guard())throw Error('changed');
      storage.setItem(GRADUATE_ARCHIVE_KEY,raw);
      if(storage.getItem(GRADUATE_ARCHIVE_KEY)!==raw)throw Error('readback');
      return {ok:true,records};
    }catch{return {ok:false,error:'기록 정리를 확인하지 못했어요. 목록을 다시 읽어 확인해 주세요.'};}
  }
  return Object.freeze({read,add,exportSnapshot,remove});
}
