// Original synthetic software-test data, NOT an approved curriculum or an R4 copy.
export function learningFixture() {
  const questions=[],lessons=[];
  function row(language,unitIndex,position,lessonId,difficultyTier) {
    const bank=lessonId?'lesson':language==='en'?'adaptive_english':'adaptive_language';
    const q={questionId:`test.${language}.${lessonId||`u${unitIndex}t${difficultyTier}`}.p${position}`,version:1,
      bank,language,unitIndex,position,lessonId,difficultyTier,prompt:`TEST ${language} ${lessonId||difficultyTier} ${position}`,
      explanation:'Synthetic test explanation',publicationEligible:true,reviewStatus:'approved',rightsReview:'verified'};
    if(lessonId&&position===2)Object.assign(q,{type:'order',parts:['test-one','test-two'],answer:{kind:'ordered_parts',parts:['test-one','test-two']}});
    else if(lessonId&&position===3)Object.assign(q,{type:'match',pairs:[['test-left-1','test-right-1'],['test-left-2','test-right-2']],answer:{kind:'matching_pairs',pairs:[['test-left-1','test-right-1'],['test-left-2','test-right-2']]}});
    else Object.assign(q,{type:lessonId?'choice':['correction','scenario','reading'][position-1],options:['test-correct','test-incorrect'],answer:{kind:'option_index',index:0},passage:'Synthetic test passage'});
    questions.push(q);
  }
  for(const lang of ['en','zh','ja'])for(let unit=0;unit<(lang==='en'?3:1);unit++){
    for(let i=0;i<5;i++){
      const id=(lang==='en'?'e':lang)+String(unit*5+i+1).padStart(2,'0');lessons.push({id,lang,unit,name:`TEST Lesson ${id}`});
      for(let p=1;p<=(lang==='en'?3:6);p++)row(lang,unit,p,id);
    }
    for(const tier of lang==='en'?[1,2,3,4]:[3,4])for(let p=1;p<=3;p++)row(lang,unit,p,null,tier);
  }
  return {lessons,questions};
}
export function memoryStorage(){const rows=new Map();return {rows,get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};}
export function answerCorrect(engine){
  const r=engine.run,q=r.questions[r.index];
  if(q.type==='order')for(const part of q.parts){const i=r.attempt.tokens.findIndex((t,i)=>t===part&&!r.attempt.selection.includes(i));engine.choose('token',i);}
  else if(q.type==='match')q.pairs.forEach((_,i)=>{engine.choose('left',i);engine.choose('right',i);});
  else engine.choose('option',q.a);
  engine.submit();engine.next();
}
