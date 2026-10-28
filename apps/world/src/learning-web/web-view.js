import {loadApprovedLearningContent,questionKey} from '../learning/learning-content.js';
import {learningDay} from '../learning/learning-progress.js';
import {createDailySession} from './daily-session.js';

export function createLearningWeb({host,doc=globalThis.document,win=globalThis.window,
  loadContent=()=>loadApprovedLearningContent(),getStorage=()=>globalThis.localStorage,account=null}={}) {
  let catalog=null,session=null,screen='today',loading=true,failed=false,disposed=false,backup='',backupMade=false;
  const el=(tag,text='',cls='')=>{const n=doc.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(label,action,value,cls='',disabled=false)=>{
    const b=el('button',label,cls);b.type='button';b.disabled=disabled;b.dataset.action=action;
    if(value!==undefined)b.dataset.value=String(value);
    b.addEventListener('click',()=>act(action,value));return b;
  };
  const text=(parent,tag,value,cls)=>{const n=el(tag,value,cls);if(tag==='h1')n.tabIndex=-1;parent.append(n);return n;};
  function render(focus){
    if(disposed)return;
    const shell=el('div','','study-shell'),rail=el('aside','','study-rail');
    const brand=el('div','','brand');brand.append(el('span','i.','brand-mark'),el('strong','인덕 스터디'));rail.append(brand);
    text(rail,'p','조금씩, 내 실력으로.','rail-caption');
    const nav=el('nav','','study-nav');nav.setAttribute('aria-label','학습 메뉴');
    for(const [name,to,icon] of [['오늘','today','01'],['복습','review','02'],['내 기록','stats','03']]){
      const b=button(`${icon}　${name}`,'screen',to);if(screen===to)b.setAttribute('aria-current','page');nav.append(b);
    }
    rail.append(nav);const railNote=el('div','','rail-note');railNote.append(el('span','INHA WORLD','eyebrow'),el('p','일상에 영어 한 칸.'));rail.append(railNote);shell.append(rail);
    const main=el('main');main.id='study-main';
    const top=el('header','','topbar');top.append(el('span','ENGLISH / DAILY PRACTICE','eyebrow'),el('span',account?'계정별 기기 기록':'게스트 · 이 기기에 저장','scope-chip'));main.append(top);
    const state=session?.status,run=session?.engine.run,progress=session?.progress.state;
    const heading=title=>{const h=text(main,'h1',title);h.tabIndex=-1;return h;};
    if(state?.blocked||state?.dirty){
      const warning=el('section','','warning');warning.setAttribute('role','alert');warning.append(el('strong',state.blocked?'기록 확인이 필요해요':'아직 저장되지 않았어요'),el('p',state.message));
      if(!state.blocked)warning.append(button('저장 다시 시도','retry',undefined,'secondary'));
      warning.append(button('현재 기록 백업','backup',undefined,'secondary'));main.append(warning);
    }
    if(screen==='today'){
      const hero=el('section','','hero');text(hero,'p','TODAY’S SMALL STEP','eyebrow');text(hero,'h1','오늘도, 영어 한 걸음.');
      text(hero,'p','복습할 표현부터 새 문제까지.\n오늘의 10문제를 차근차근 풀어보세요.','hero-description');
      const blocked=loading||!catalog||state?.blocked||state?.dirty;
      const active=run&&!run.finished;
      hero.append(button(loading?'준비하고 있어요':!catalog?'학습 콘텐츠 준비 중':active?`${Math.min(run.index+1,10)}번째 문제부터 이어하기`:'오늘의 학습 시작',active?'resume':'start',undefined,'primary',blocked));
      const ring=el('div','','hero-ring');ring.setAttribute('aria-hidden','true');ring.append(el('strong',active?String(Math.min(run.answers.length,10)):'10'),el('span',active?'이어갈 수 있어요':'하루의 작은 완성'));hero.append(ring);main.append(hero);
      const metrics=el('div','','metrics');const today=progress?.learningHistory[learningDay()];
      for(const [label,value,unit] of [['오늘 푼 문제',today?.answered||0,'문제'],['복습할 문제',session?.engine.reviewKeys().filter(k=>catalog.get(k)?.language==='en').length||0,'문제'],['학습한 날',Object.keys(progress?.learningHistory||{}).length,'일']]){
        const card=el('section','','metric');card.append(el('span',label),el('strong',String(value)),el('small',unit));metrics.append(card);
      }main.append(metrics);
      const grid=el('div','','home-grid'),route=el('section','','card');route.append(el('p','YOUR ROUTINE','eyebrow'),el('h2','오늘의 학습 순서'));
      for(const [n,title,desc] of [['01','복습 + 새로운 문제','오답과 복습 시기가 된 문제를 먼저 만나요.'],['02','해설로 한 번 더','정답을 확인하고 문장의 근거를 짚어요.'],['03','오답 재확인','10문제 뒤, 어려웠던 문제를 최대 3개 다시 풀어요.']]){
        const row=el('div','','routine-row'),copy=el('div');copy.append(el('h3',title),el('p',desc));row.append(el('span',n,'step-number'),copy);route.append(row);
      }
      const note=el('section','','card soft-card');note.append(el('p','ONE STEP AT A TIME','eyebrow'),el('h2','기억은 천천히\n단단해져요.'),el('p','힌트를 보고 맞힌 문제는 다시 확인해요. 다른 날에도 기억하는지 살펴보며 복습 간격을 늘려가요.'));
      grid.append(route,note);main.append(grid);
      if(!loading&&!catalog){const gate=el('section','','content-note');gate.setAttribute('role','status');gate.append(el('strong',failed?'학습 자료를 불러오지 못했어요':'학습 문제를 검수하고 있어요'),el('p',failed?'잠시 후 다시 시도해 주세요. 저장된 기록은 유지됩니다.':'검수가 끝난 콘텐츠부터 학습할 수 있어요. 현재는 어휘·문법 학습을 준비하고 있어요.'));if(failed)gate.append(button('다시 불러오기','reload'));main.append(gate);}
    }else if(screen==='question'&&run){
      const q=run.questions[run.index],a=run.attempt,recheck=run.index>=10;
      heading(recheck?'한 번 더, 내 것으로.':'오늘의 학습');
      const meta=el('div','','question-meta');meta.append(el('span',recheck?`오답 재확인 ${run.index-9} / ${run.questions.length-10}`:`문제 ${run.index+1} / 10`),el('span',`UNIT ${q.unit+1} · ${run.combo} 연속 정답`));main.append(meta);
      const meter=el('progress');meter.max=run.questions.length;meter.value=run.answers.length;meter.setAttribute('aria-label','세션 진행률');main.append(meter);
      const card=el('section','','card question-card');text(card,'p',recheck?'RECALL AGAIN':'FOCUS ON THE SENTENCE','eyebrow');text(card,'h2',q.prompt);if(q.passage)text(card,'p',q.passage,'passage');
      const options=el('div','','options');options.setAttribute('role','group');options.setAttribute('aria-label','답 선택');
      q.options.forEach((option,i)=>{const b=button('','choose',i,'option',a.checked||state.blocked||state.dirty);b.append(el('span',String.fromCharCode(65+i),'option-letter'),el('span',option));b.setAttribute('aria-pressed',String(a.selection===i));if(a.checked&&q.a===i)b.classList.add('correct');else if(a.checked&&a.selection===i)b.classList.add('incorrect');options.append(b);});card.append(options);
      if(a.hinted&&!a.checked)text(card,'p','빈칸 앞뒤의 문장 구조와 의미를 확인해 보세요. 필요한 품사나 표현을 먼저 생각하면 좋아요.','hint-note');
      if(a.checked){const feedback=el('div','',a.isCorrect?'feedback':'feedback retry-feedback');feedback.setAttribute('role','status');feedback.append(el('strong',a.isCorrect?(a.hinted?'힌트와 함께 맞혔어요':'정답이에요!'):'괜찮아요. 근거를 확인해 볼까요?'),el('p',`정답 ${String.fromCharCode(65+q.a)} · ${q.options[q.a]}`),el('p',q.why));if(a.hinted)text(feedback,'small','힌트를 사용한 정답은 독립 회상 숙련도를 올리지 않아요.');card.append(feedback);}
      const actions=el('div','','question-actions');
      if(!a.checked)actions.append(button(a.hinted?'힌트 사용 중':'생각할 힌트','hint',undefined,'text-button',a.hinted||state.blocked||state.dirty));
      actions.append(button(a.checked?(run.index+1===run.questions.length?'이번 단계 마치기':'다음 문제'):'정답 확인',a.checked?'next':'submit',undefined,'primary',state.blocked||state.dirty||(!a.checked&&a.selection===null)));card.append(actions);main.append(card);
      main.append(button('오늘 화면으로 · 위치 유지','screen','today','text-button'));
    }else if(screen==='result'&&run){
      heading('오늘의 한 걸음, 완료!');const first=run.answers.slice(0,10),firstCorrect=first.filter((a,i)=>a.selection===run.questions[i].a).length;
      const card=el('section','','card result-card');card.append(el('p','DAILY SESSION COMPLETE','eyebrow'),el('div',`${firstCorrect} / 10`,'result-score'),el('h2','처음 풀었을 때의 정답'),el('p',`힌트 사용 ${first.filter(a=>a.hinted).length}문제 · 추가 재확인 ${Math.max(0,run.answers.length-10)}문제`),el('p','오늘의 결과는 연습 기록이에요. 토익 예상 점수로 환산하지 않아요.'));main.append(card);
      const list=el('section','','card');list.append(el('h2','한눈에 보는 풀이'));
      first.forEach((a,i)=>{const q=run.questions[i];const row=el('div','','result-row');row.append(el('span',String(i+1).padStart(2,'0')),el('span',q.prompt),el('strong',a.selection===q.a?(a.hinted?'힌트 정답':'정답'):'복습'));list.append(row);});main.append(list,button('오늘 화면으로','screen','today','primary'));
    }else if(screen==='review'){
      heading('다시 만나면, 더 익숙하게.');text(main,'p','오답과 복습할 시기가 된 문제예요. 오늘의 학습에서 우선 만나게 돼요.','intro');
      const keys=session?.engine.reviewKeys().filter(k=>catalog.get(k)?.language==='en')||[];
      if(!keys.length)text(main,'p',catalog?'지금 복습할 문제는 없어요. 오늘의 학습을 시작해 보세요.':'콘텐츠 준비가 끝나면 복습 목록이 여기에 표시돼요.','card');
      for(const key of keys){const q=catalog.get(key),card=el('section','','card review-card');card.append(el('span',progress.wrong[key]?'오답':'간격 복습','tag'),el('h2',q.prompt));main.append(card);}
      main.append(button(run&&!run.finished?'풀던 문제 이어가기':'오늘의 학습 시작',run&&!run.finished?'resume':'start',undefined,'primary',!catalog||state?.blocked||state?.dirty));
    }else if(screen==='stats'){
      heading('쌓이고 있는 나의 기록.');text(main,'p','이 브라우저에 저장된 학습 기록이에요. 기기 간 동기화는 아직 연결되지 않았어요.','intro');
      const days=Object.entries(progress?.learningHistory||{}).sort().reverse();
      if(!days.length)text(main,'p','첫 학습을 마치면 기록이 여기에 쌓여요.','card');
      for(const [day,r] of days.slice(0,30)){const card=el('section','','card history-row');card.append(el('strong',day),el('span',`${r.answered}문제 학습 · ${r.correct}문제 정답`));main.append(card);}
      if(session)main.append(button('현재 기록 백업','backup',undefined,'secondary'));
    }
    if(backup){
      const panel=el('section','','card');panel.append(el('h2','기록 백업'));const area=el('textarea');area.readOnly=true;area.value=backup;area.setAttribute('aria-label','학습 기록 백업 JSON');panel.append(area,button('백업 파일 내려받기','download',undefined,'secondary'));
      if(state?.blocked||state?.dirty)panel.append(el('p','백업을 보관했다면 풀던 세션만 초기화할 수 있어요. 이미 저장된 학습 기록은 유지돼요.'),button('백업 보관 완료 · 세션만 초기화','reset',undefined,'text-button',!backupMade));main.append(panel);
    }
    const footer=el('footer','','study-footer');footer.setAttribute('role','status');
    footer.textContent=state?.blocked?'기록 확인 중 · 자동 덮어쓰기 중단':state?.dirty?'이 화면에 저장되지 않은 변경이 있어요':run?'풀던 위치까지 이 기기에 저장됨':'게스트 학습 · 이 브라우저에 기록';main.append(footer);
    shell.append(main);host.replaceChildren(shell);
    if(focus==='heading')host.querySelector('main h1')?.focus();
    else if(focus)host.querySelector(focus)?.focus();
  }
  function act(action,value){
    if(disposed)return;
    if(action==='screen'){screen=value;backup='';}
    else if(action==='resume'){screen=session.engine.run.finished?'result':'question';}
    else if(action==='backup'){backup=session.backup();backupMade=true;}
    else if(action==='download'){
      const url=win.URL.createObjectURL(new Blob([backup],{type:'application/json'}));const a=el('a');a.href=url;a.download='induck-study-backup.json';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);return;
    }else if(action==='reset'&&backupMade){if(session.resetAfterBackup()){backup='';backupMade=false;session=createDailySession({catalog,getStorage,account});screen='today';}}
    else if(action==='reload'){win.location.reload();return;}
    else if(action==='retry')session.retry();
    else {session?.act(action,value);if(action==='start'&&session?.engine.run)screen='question';if(session?.engine.run?.finished)screen='result';}
    render(action==='choose'?`[data-action="choose"][data-value="${value}"]`:['next','start','resume','screen'].includes(action)?'heading':undefined);
  }
  const beforeUnload=e=>{if(session?.status.dirty){e.preventDefault();e.returnValue='';}};
  win?.addEventListener('beforeunload',beforeUnload);render();
  const ready=Promise.resolve().then(loadContent).then(c=>{if(disposed)return;catalog=c;if(c)session=createDailySession({catalog,getStorage,account});}).catch(()=>{failed=true;}).finally(()=>{loading=false;render();});
  return {ready,snapshot:()=>({screen,available:!!catalog,run:session?.engine.snapshot(),progress:session?.progress.state,status:session?.status}),
    dispose(){disposed=true;win?.removeEventListener('beforeunload',beforeUnload);host.replaceChildren();session=null;catalog=null;backup='';}};
}
