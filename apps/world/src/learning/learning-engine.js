// Learning rules ported from v0.6.2.1: six adaptive questions, +5/-8 skill,
// separate-day mastery, combo and five-question boss (four correct to pass).
import {questionKey} from './learning-content.js';
import {learningDay,recordMastery,reconcileVersions} from './learning-progress.js';
export const normalizeSpoken=t=>String(t||'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
const clone=value=>JSON.parse(JSON.stringify(value));
export function makeAttempt(q) {
  return {selection:q.type==='order'?[]:null,checked:false,isCorrect:false,
    tokens:q.type==='order'?[...q.parts.slice(1),q.parts[0]]:[],matched:[],leftPick:null,
    rightOrder:q.type==='match'?q.pairs.map((_,i)=>i).reverse():[],mistakes:0};
}
export function createLearningEngine({catalog,progress,today=learningDay}) {
  let run=null;
  const state=()=>progress.state;
  const level=l=>Math.max(1,Math.min(4,1+Math.floor((l.lang==='en'?state().skillScores[l.unit]:state().languageSkills[l.lang])/25)));
  function adaptive(l,i) {
    if(i<3)return l.questions[i];
    const tier=level(l);
    if(l.lang==='en')return catalog.adaptive('en',l.unit,tier)[i-3];
    return tier<3?l.questions[i]:catalog.adaptive(l.lang,l.unit,tier)[(i-3+l.lang.length+l.id.charCodeAt(l.id.length-1))%3];
  }
  function begin(kind,questions,lesson=null) {
    run={kind,lesson,questions,index:0,correct:0,combo:0,maxCombo:0,finished:false,attempt:makeAttempt(questions[0])};return true;
  }
  function reviewKeys() {
    return catalog.questions.filter(q=>{const key=questionKey(q),r=state().masteries[key];return state().wrong[key]||r?.needsRecheck||r?.level>=1&&(r.dueDate?r.dueDate<=today():r.lastCorrectDay!==today());}).map(questionKey);
  }
  function bossReady(lang,unit) {const ls=catalog.lessons.filter(l=>l.lang===lang&&l.unit===unit);return ls.length===5&&ls.every(l=>state().completed[l.id]);}
  function submit() {
    if(!run||run.finished||run.attempt.checked)return false;
    const q=run.questions[run.index],a=run.attempt;
    if(q.type==='match'?a.matched.length!==q.pairs.length:q.type==='order'?!a.selection.length:a.selection===null)return false;
    a.checked=true;
    a.isCorrect=q.type==='match'?a.mistakes===0:q.type==='order'?JSON.stringify(a.selection.map(i=>a.tokens[i]))===JSON.stringify(q.parts):a.selection===q.a;
    run.combo=a.isCorrect?run.combo+1:0;run.maxCombo=Math.max(run.maxCombo,run.combo);if(a.isCorrect)run.correct++;
    const s=state(),key=questionKey(q),day=today();
    // A hinted answer is practice, not evidence of independent recall.
    if(run.kind!=='boss'&&!(a.isCorrect&&a.hinted)) {recordMastery(s,key,a.isCorrect,day);if(a.isCorrect)delete s.wrong[key];else s.wrong[key]=true;}
    if(run.kind==='daily')run.answers.push({selection:a.selection,hinted:!!a.hinted});
    const h=s.learningHistory[day]??={answered:0,correct:0};h.answered++;if(a.isCorrect)h.correct++;
    if(run.kind==='lesson'){
      const l=run.lesson,delta=a.isCorrect?5:-8;
      if(l.lang==='en')s.skillScores[l.unit]=Math.max(0,Math.min(100,s.skillScores[l.unit]+delta));
      else s.languageSkills[l.lang]=Math.max(0,Math.min(100,s.languageSkills[l.lang]+delta));
    }
    return progress.save();
  }
  function next() {
    if(!run||run.finished||!run.attempt.checked)return false;
    if(run.kind==='daily'&&run.index===9&&run.questions.length===10){
      // One bounded second pass, after all ten first attempts. No infinite retry loop.
      run.questions.push(...run.questions.filter((q,i)=>run.answers[i].selection!==q.a||run.answers[i].hinted).slice(0,3));
    }
    if(run.index+1<run.questions.length){run.index++;if(run.kind==='lesson')run.questions[run.index]=adaptive(run.lesson,run.index);run.attempt=makeAttempt(run.questions[run.index]);return true;}
    run.finished=true;
    if(run.kind==='lesson')state().completed[run.lesson.id]=true;
    if(run.kind==='boss'){
      const l=run.lesson,records=l.lang==='en'?state().bosses:state().languageBosses,key=l.lang==='en'?l.unit:l.lang;
      const before=records[key]||{count:0,best:0,passed:false};
      records[key]={count:before.count+1,best:Math.max(before.best,run.correct),passed:before.passed||run.correct>=4,lastDate:today()};
    }
    return progress.save();
  }
  reconcileVersions(state(),catalog,today());
  return {level,reviewKeys,bossReady,submit,next,
    get run(){return run;},reset(){run=null;reconcileVersions(state(),catalog,today());},
    snapshot:()=>run?clone(run):null,
    startDaily(){
      const due=new Set(reviewKeys());
      const rank=q=>{const key=questionKey(q),m=state().masteries[key];return state().wrong[key]?0:due.has(key)?1:!m?2:3;};
      const qs=catalog.questions.filter(q=>q.language==='en'&&Array.isArray(q.options))
        .sort((a,b)=>rank(a)-rank(b)||(state().masteries[questionKey(a)]?.lastCorrectDay||'').localeCompare(state().masteries[questionKey(b)]?.lastCorrectDay||'')||a.position-b.position||a.unit-b.unit).slice(0,10);
      if(qs.length!==10)return false;
      begin('daily',qs);run.answers=[];return true;
    },
    hint(){if(run?.kind!=='daily'||run.finished||run.attempt.checked)return false;run.attempt.hinted=true;return true;},
    dailyCheckpoint(){
      if(run?.kind!=='daily')return null;
      return {version:1,keys:run.questions.map(questionKey),index:run.index,answers:clone(run.answers),
        selection:run.attempt.selection,hinted:!!run.attempt.hinted,finished:run.finished};
    },
    restoreDaily(c){
      const fields=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
      if(!fields(c,['version','keys','index','answers','selection','hinted','finished'])||c.version!==1||!Array.isArray(c.keys)||c.keys.length<10||c.keys.length>13||
        !Number.isInteger(c.index)||c.index<0||c.index>=c.keys.length||!Array.isArray(c.answers)||![c.index,c.index+1].includes(c.answers.length)||
        typeof c.hinted!=='boolean'||typeof c.finished!=='boolean'||new Set(c.keys.slice(0,10)).size!==10)return false;
      const qs=c.keys.map(k=>catalog.get(k));
      if(qs.some(q=>!q||q.language!=='en'||!Array.isArray(q.options)))return false;
      const validPick=(p,q)=>Number.isInteger(p)&&p>=0&&p<q.options.length;
      if(c.answers.some((a,i)=>!fields(a,['selection','hinted'])||typeof a.hinted!=='boolean'||!validPick(a.selection,qs[i]))||
        !(c.selection===null||validPick(c.selection,qs[c.index])))return false;
      const checked=c.answers.length===c.index+1;
      if(checked&&(c.selection!==c.answers[c.index].selection||c.hinted!==c.answers[c.index].hinted))return false;
      const repeats=c.answers.slice(0,10).flatMap((a,i)=>a.selection!==qs[i].a||a.hinted?[c.keys[i]]:[]).slice(0,3);
      if(c.keys.length>10&&(c.index<10||JSON.stringify(c.keys.slice(10))!==JSON.stringify(repeats)))return false;
      if(c.finished&&(!checked||c.index!==c.keys.length-1||c.keys.length!==10+repeats.length))return false;
      begin('daily',qs);run.index=c.index;run.answers=clone(c.answers);run.finished=c.finished;
      run.attempt={...makeAttempt(qs[c.index]),selection:c.selection,hinted:c.hinted,checked,isCorrect:checked&&c.selection===qs[c.index].a};
      for(let i=0;i<c.answers.length;i++){const correct=c.answers[i].selection===qs[i].a;run.combo=correct?run.combo+1:0;run.maxCombo=Math.max(run.maxCombo,run.combo);if(correct)run.correct++;}
      return true;
    },
    startLesson(id){const l=catalog.lessons.find(l=>l.id===id);return l?begin('lesson',Array.from({length:6},(_,i)=>adaptive(l,i)),l):false;},
    startReview(key){const q=catalog.get(key);return q&&reviewKeys().includes(key)?begin('review',[q]):false;},
    startBoss(lang,unit){
      if(!bossReady(lang,unit))return false;
      const lessons=catalog.lessons.filter(l=>l.lang===lang&&l.unit===unit);
      const qs=lang==='en'?[...catalog.adaptive(lang,unit,3),...catalog.adaptive(lang,unit,4).slice(1)]:lessons.map((l,i)=>l.questions[[0,1,2,4,5][i]]);
      return begin('boss',qs,lessons[0]);
    },
    choose(action,index){
      if(!run||run.finished||run.attempt.checked||!Number.isInteger(index))return false;
      const a=run.attempt,q=run.questions[run.index];
      if(action==='option'&&q.options&&index>=0&&index<q.options.length)a.selection=index;
      else if(action==='token'&&q.type==='order'&&index>=0&&index<a.tokens.length&&!a.selection.includes(index))a.selection.push(index);
      else if(action==='remove'&&q.type==='order'&&index>=0&&index<a.selection.length)a.selection.splice(index,1);
      else if(action==='left'&&q.type==='match'&&index>=0&&index<q.pairs.length&&!a.matched.includes(index))a.leftPick=index;
      else if(action==='right'&&q.type==='match'&&a.leftPick!==null&&index>=0&&index<q.pairs.length&&!a.matched.includes(index)){
        if(a.leftPick===index){a.matched.push(index);a.leftPick=null;}else a.mistakes++;
      } else return false;
      return true;
    }
  };
}
