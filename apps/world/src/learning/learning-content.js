// Content is a capability injected by the release loader or a private test harness.
// No question text, answers, source HTML, demo banks, or remote-code loader belongs here.
export const LEARNING_RELEASE = Object.freeze({ enabled: false, manifest: null, resource: null });
export const questionKey = q => `qv:${q.questionId}@${q.version}`;
const languages = ['en','zh','ja'];
const banks = ['lesson','adaptive_english','adaptive_language'];
const optionTypes = ['choice','correction','scenario','reading','tone','kana'];
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 8000;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(v);
const fail = () => { throw Error('LEARNING_CONTENT_BLOCKED'); };
function freeze(value) {
  if(value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function createLearningCatalog(payload) {
  if(!Array.isArray(payload?.questions)||!payload.questions.length||payload.questions.length>2000||!Array.isArray(payload.lessons))fail();
  const keys=new Set(), ids=new Set();
  const questions=payload.questions.map(row=>{
    if(!id(row.questionId)||!Number.isSafeInteger(row.version)||row.version<1||ids.has(row.questionId)||
      !banks.includes(row.bank)||!languages.includes(row.language)||!text(row.prompt)||!text(row.explanation)||
      !Number.isInteger(row.unitIndex)||row.unitIndex<0||row.unitIndex>(row.language==='en'?2:0)||
      !Number.isInteger(row.position)||row.position<1||row.position>6)fail();
    if(row.bank==='adaptive_english'&&(row.language!=='en'||![1,2,3,4].includes(row.difficultyTier)))fail();
    if(row.bank==='adaptive_language'&&(row.language==='en'||![3,4].includes(row.difficultyTier)))fail();
    const q={questionId:row.questionId,version:row.version,bank:row.bank,language:row.language,
      lessonId:row.lessonId,unit:row.unitIndex,position:row.position,tier:row.difficultyTier,
      type:row.type,prompt:row.prompt,why:row.explanation};
    if(optionTypes.includes(q.type)) {
      if(!Array.isArray(row.options)||row.options.length<2||row.options.length>10||!row.options.every(text)||
        row.answer?.kind!=='option_index'||!Number.isInteger(row.answer.index)||row.answer.index<0||row.answer.index>=row.options.length)fail();
      q.options=[...row.options];q.a=row.answer.index;
      if(q.type==='reading'&&!text(row.passage))fail();
      if(row.passage)q.passage=row.passage;
    } else if(q.type==='order') {
      if(!Array.isArray(row.parts)||!row.parts.length||row.parts.length>30||!row.parts.every(text)||
        row.answer?.kind!=='ordered_parts'||JSON.stringify(row.answer.parts)!==JSON.stringify(row.parts))fail();
      q.parts=[...row.parts];
    } else if(q.type==='match') {
      if(!Array.isArray(row.pairs)||!row.pairs.length||row.pairs.length>20||!row.pairs.every(p=>Array.isArray(p)&&p.length===2&&p.every(text))||row.answer?.kind!=='matching_pairs'||JSON.stringify(row.answer.pairs)!==JSON.stringify(row.pairs))fail();
      q.pairs=row.pairs.map(p=>[...p]);
    } else fail();
    ids.add(q.questionId);keys.add(questionKey(q));return freeze(q);
  });
  const lessonIds=new Set();
  const lessons=payload.lessons.map(l=>{
    if(!/^(e|zh|ja)\d{2}$/.test(l.id)||!l.id.startsWith(l.lang==='en'?'e':l.lang)||lessonIds.has(l.id)||!text(l.name)||!languages.includes(l.lang)||!Number.isInteger(l.unit))fail();
    const qs=questions.filter(q=>q.bank==='lesson'&&q.lessonId===l.id).sort((a,b)=>a.position-b.position);
    const count=l.lang==='en'?3:6;
    if(qs.length!==count||qs.some((q,i)=>q.position!==i+1||q.language!==l.lang||q.unit!==l.unit))fail();
    lessonIds.add(l.id);return freeze({id:l.id,name:l.name,lang:l.lang,unit:l.unit,questions:qs});
  });
  // Preserve the complete 15-lesson English course. Optional languages are complete groups of five.
  for(const lang of languages) {
    const group=lessons.filter(l=>l.lang===lang);
    if((lang==='en'&&group.length!==15)||(lang!=='en'&&![0,5].includes(group.length)))fail();
    for(let unit=0;unit<(lang==='en'?3:1);unit++) {
      if(!group.length)continue;
      if(group.filter(l=>l.unit===unit).length!==5)fail();
      for(const tier of lang==='en'?[1,2,3,4]:[3,4]) {
        const set=questions.filter(q=>q.language===lang&&q.unit===unit&&q.tier===tier&&q.bank!=='lesson').sort((a,b)=>a.position-b.position);
        if(set.length!==3||set.some((q,i)=>q.position!==i+1))fail();
      }
    }
  }
  if(questions.some(q=>q.bank==='lesson'&&!lessonIds.has(q.lessonId)))fail();
  const byKey=new Map(questions.map(q=>[questionKey(q),q]));
  return Object.freeze({lessons:Object.freeze(lessons),questions:Object.freeze(questions),
    get:key=>byKey.get(key),has:key=>keys.has(key),latest:id=>questions.find(q=>q.questionId===id),
    adaptive:(lang,unit,tier)=>questions.filter(q=>q.bank!=='lesson'&&q.language===lang&&q.unit===unit&&q.tier===tier).sort((a,b)=>a.position-b.position)});
}
export async function loadApprovedLearningContent(release=LEARNING_RELEASE,{fetcher=globalThis.fetch,crypto=globalThis.crypto,signal}={}) {
  if(release.enabled!==true)return null;
  const m=release.manifest;
  if(m?.format!=='induck.learning.approved.v1'||m.publicationEligible!==true||m.reviewStatus!=='approved'||
    m.rightsReview!=='verified'||!text(m.approvalReference)||!id(m.version)||!Array.isArray(m.questions)||
    !/^[a-f0-9]{64}$/.test(m.sha256)||!/^\/learning-content\/[a-zA-Z0-9_.-]+\.json$/.test(release.resource||''))fail();
  const response=await fetcher(release.resource,{signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response.ok)fail();
  const bytes=await response.arrayBuffer();if(bytes.byteLength>2_000_000)fail();
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==m.sha256)fail();
  const payload=JSON.parse(new TextDecoder().decode(bytes));
  const expected=new Set(m.questions.map(q=>questionKey(q)));
  if(expected.size!==m.questions.length||payload.questions?.length!==expected.size||payload.questions.some(q=>
    q.publicationEligible!==true||q.reviewStatus!=='approved'||q.rightsReview!=='verified'||!expected.has(questionKey(q))))fail();
  return createLearningCatalog(payload);
}
