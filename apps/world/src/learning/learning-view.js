// All UI is inside a caller-owned host. textContent/DOM APIs keep content inert.
export function renderLearningView({host,doc,model,act,input,guard}) {
  const {catalog,progress,engine,screen,lang,notice,speechIndex,speechText,speechSupport,backup,importReady,importText,saveState,exportedRecovery,recoveryChoices=[]}=model;
  const root=doc.createElement('section');root.className='learning-app';root.setAttribute('aria-label','인덕캠퍼스 학습');
  const el=(tag,text='',cls='')=>{const n=doc.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(label,action,value,disabled=false)=>{
    const b=el('button',label);b.type='button';b.disabled=disabled;
    b.addEventListener('click',()=>guard(()=>act(action,value)));return b;
  };
  const box=(title)=>{const n=el('section','','learning-card');n.append(el('h3',title));root.append(n);return n;};
  const languages={en:'영어',zh:'중국어',ja:'일본어'};
  const available=Object.keys(languages).filter(l=>catalog.lessons.some(x=>x.lang===l));
  const ls=catalog.lessons.filter(l=>l.lang===lang),done=ls.filter(l=>progress.completed[l.id]).length;
  const nav=el('nav','','learning-nav');nav.setAttribute('aria-label','학습 메뉴');
  for(const [label,to] of [['학습 홈','home'],['전체 레슨','lessons'],['오답 복습','review'],['학습 기록','stats']])nav.append(button(label,'screen',to));
  root.append(nav);
  if(saveState?.status==='unsaved'){
    const warning=box('이 기기에 저장되지 않은 결과');warning.setAttribute('role','alert');
    warning.append(el('p','현재 화면의 풀이와 완료 기록은 메모리에만 남아 있을 수 있어요. 닫기·새로고침·계정 전환 전에 백업하세요. 다른 탭과 충돌했다면 백업 후 최신 기록에 가져오세요.'),button('저장 다시 시도','retry-save'),button('현재 결과 백업하기','screen','backup'));
  }
  const status=el('p',notice,'learning-status');status.setAttribute('role','status');root.append(status);
  const languagePicker=()=>{const n=el('div','','learning-languages');for(const l of available){const b=button(languages[l],'language',l);b.setAttribute('aria-pressed',String(l===lang));n.append(b);}root.append(n);};
  if(screen==='home'){
    const hero=box('오늘은 어떤 실력을 키워 볼까? 🦆');hero.append(el('p',`${languages[lang]} · ${done} / ${ls.length} 레슨 완료`));languagePicker();
    root.append(button('이어서 배우기','lesson',(ls.find(l=>!progress.completed[l.id])||ls[0]).id));
    root.append(button('듣기 · 말하기 연습','screen','speech'),button('오늘의 퀴즈','daily'));
    root.append(el('p','학습 기록은 이 브라우저에 계정별로 저장됩니다. 서버 저장은 준비 중입니다.','learning-note'));
  } else if(screen==='lessons') {
    root.append(el('h2','단원별 학습 코스'));languagePicker();
    for(const unit of [...new Set(ls.map(l=>l.unit))]){
      const section=box(`UNIT ${unit+1} · Lv.${engine.level(ls.find(l=>l.unit===unit))}`);
      for(const l of ls.filter(l=>l.unit===unit))section.append(button(`${progress.completed[l.id]?'✓ ':''}${l.name} · 6문제`,'lesson',l.id));
      section.append(button('보스 시험 · 5문항 중 4문항 정답으로 합격','boss',unit,!engine.bossReady(lang,unit)));
    }
  } else if(screen==='question'&&engine.run) {
    const run=engine.run,q=run.questions[run.index],a=run.attempt;
    root.append(el('p',`${run.index+1} / ${run.questions.length} · ${run.combo}콤보${run.combo>=3?' 🔥':''}`));
    const card=box(q.prompt);if(q.passage)card.append(el('p',q.passage));
    const answers=el('div','','learning-answers');answers.setAttribute('aria-label','문제 선택지');
    if(q.type==='order'){
      const selected=el('div','','learning-word-slot');selected.setAttribute('aria-label','선택한 단어');
      a.selection.forEach((i,pos)=>selected.append(button(`${a.tokens[i]} ×`,'remove',pos,a.checked)));answers.append(selected);
      a.tokens.forEach((t,i)=>{if(!a.selection.includes(i))answers.append(button(t,'token',i,a.checked));});
    } else if(q.type==='match') {
      const grid=el('div','','learning-match'),left=el('div'),right=el('div');
      q.pairs.forEach((p,i)=>{const b=button(p[0],'left',i,a.checked||a.matched.includes(i));b.setAttribute('aria-pressed',String(a.leftPick===i));left.append(b);});
      a.rightOrder.forEach(i=>right.append(button(q.pairs[i][1],'right',i,a.checked||a.matched.includes(i)||a.leftPick===null)));
      grid.append(left,right);answers.append(grid,el('p',`${a.matched.length}/${q.pairs.length} 연결 · 실수 ${a.mistakes}회`));
    } else q.options.forEach((v,i)=>{const b=button(`${String.fromCharCode(65+i)}. ${v}`,'option',i,a.checked);b.setAttribute('aria-pressed',String(a.selection===i));answers.append(b);});
    card.append(answers);
    if(a.checked){const feedback=el('div','','learning-feedback');feedback.setAttribute('role','status');feedback.append(el('strong',a.isCorrect?'정답! 잘했어 ✨':'아쉬워! 해설 확인 📘'),el('p',q.why));card.append(feedback);}
    const checkable=q.type==='match'?a.matched.length===q.pairs.length:q.type==='order'?a.selection.length>0:a.selection!==null;
    root.append(button(a.checked?(run.index+1===run.questions.length?'결과 확인하기':'다음 문제'):'정답 확인하기',a.checked?'next':'submit',null,!a.checked&&!checkable));
  } else if(screen==='result'&&engine.run){
    const r=engine.run,card=box(saveState?.status==='unsaved'?'풀이 종료 · 기록 미저장':r.kind==='boss'?(r.correct>=4?'보스 합격! 🏆':'다시 도전해 보세요'):'학습 완료! 🌱');
    card.append(el('p',`${r.correct} / ${r.questions.length} 정답 · 최고 ${r.maxCombo}콤보`));
    root.append(button('오답 복습하기','screen','review'),button('전체 레슨 보기','screen','lessons'));
  } else if(screen==='review') {
    const keys=engine.reviewKeys();root.append(el('h2','오답 · 간격 복습'));
    if(!keys.length)root.append(el('p','지금 복습할 문항이 없어요.'));
    for(const key of keys){const q=catalog.get(key);root.append(button(`${progress.wrong[key]?'오답':'복습'} · ${q.prompt}`,'review',key));}
  } else if(screen==='stats') {
    root.append(el('h2','학습 기록'));
    const mastered=catalog.questions.filter(q=>progress.masteries[`qv:${q.questionId}@${q.version}`]?.level===2).length;
    root.append(el('p',`현재 문항 숙달 ${mastered} / ${catalog.questions.length}`));
    for(const [day,record] of Object.entries(progress.learningHistory).sort().reverse().slice(0,30))root.append(el('p',`${day} · ${record.correct} / ${record.answered} 정답`));
    root.append(button('기록 백업 · 가져오기','screen','backup'));
  } else if(screen==='speech') {
    const qs=catalog.questions.filter(q=>q.language===lang&&q.type==='order'),q=qs[speechIndex%qs.length];
    root.append(el('h2','듣기 · 말하기 연습'));languagePicker();
    if(q){
      root.append(el('p',q.parts.join(' ')),button('문장 음성 재생','play'),button('마이크로 문장 인식','listen',null,!speechSupport.recognition));
      const label=el('label','연습 문장 직접 입력'),field=el('textarea');field.setAttribute('aria-label','연습 문장 직접 입력');field.value=speechText;
      field.addEventListener('input',()=>input('speech',field.value));label.append(field);root.append(label,button('입력 확인','typed'),button('다음 문장','speech-next'));
      root.append(el('p','음성 인식은 발음 채점이 아닙니다. 브라우저의 음성 서비스가 외부 처리를 사용할 수 있습니다. 미지원·권한 거부 시 직접 입력하세요.','learning-note'));
    }
  } else if(screen==='backup') {
    root.append(el('h2','학습 기록 백업'),el('p','다른 주소의 로컬 기록은 자동으로 읽을 수 없습니다. 원본에서 내보낸 JSON을 붙여 넣고 현재 계정에 병합하세요. 원본 백업 파일을 보관하세요.'));
    root.append(button('백업 JSON 만들기','export'),button('충돌 복구 사본 내보내기','recovery-export'));
    if(exportedRecovery)root.append(el('p','아래 JSON을 파일로 보관한 뒤 정리하세요. 사본은 자동으로 삭제되지 않습니다.'),button('백업 파일 보관 확인 · 사본 정리','recovery-cleanup'));
    recoveryChoices.forEach((p,i)=>root.append(button(`복구 사본 ${i+1} · ${Object.keys(p.completed||{}).length}레슨 선택`,'recovery-pick',i)));
    if(backup){const area=el('textarea');area.readOnly=true;area.value=backup;area.setAttribute('aria-label','백업 JSON');root.append(area);}
    const area=el('textarea');area.setAttribute('aria-label','가져올 기록 JSON');area.value=importText||'';area.addEventListener('input',()=>input('import',area.value));root.append(area,button('가져오기 검토','import-preview'));
    if(importReady)root.append(el('p','이 브라우저의 현재 계정에 학습 기록만 병합합니다. 기존 충돌 기록은 유지하고 코인·EXP·순위·문항 원문은 제외합니다.'),button('현재 계정에 병합 확인','import-confirm'));
  }
  const localNote=el('p',saveState?.status==='saved'?'이 기기에 저장 확인 완료':saveState?.status==='unsaved'?'이 기기에 저장하지 못함':'저장할 학습 기록 없음','learning-local-status');localNote.setAttribute('role','status');root.append(localNote);
  host.replaceChildren(root);
}
