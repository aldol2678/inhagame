const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
function el() {
  return {style:{setProperty(){}},dataset:{},value:'0',innerHTML:'',textContent:'',disabled:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    appendChild(){},remove(){},setAttribute(){},querySelectorAll(){return []},
    querySelector(){return null},addEventListener(){}};
}
const storage = new Map();
const ctx = vm.createContext({console,Math,Date,JSON,Number,Object,Array,Set,Map,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},
    createElement:el,querySelectorAll(){return []},querySelector(){return null},addEventListener(){}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  setTimeout(fn){fn()}, scrollTo(){},confirm(){return true},
  navigator:{clipboard:{writeText:async()=>{}}}
});
vm.runInContext(js,ctx,{timeout:3000});
const run = src => vm.runInContext(src,ctx,{timeout:3000});
assert.equal(run('initState().money'),70000);
assert.equal(run('initState().bagLevel'),0);
assert.equal(run('DEPTS && Object.keys(DEPTS).length'),6);
// Captured with the original M5.7 HTML's startSemester() and save() path.
const legacySave=JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures/m5.7-save.json'),'utf8'));
assert.equal(legacySave.version,'p0-html-0.10-m5.7');
storage.set('induck-grow-p0',JSON.stringify(legacySave));
let migrated=run('load()');
assert.equal(migrated.version,'p0-html-0.10-m5.8');
assert.equal(migrated.week,5);
assert.equal(migrated.bagLevel,1);
assert.equal(migrated.subscriptionNextCharge.music,9);
assert.equal(migrated.relationshipStates.cse_peer.bond,22);
assert.equal(migrated.councilId,'department');
assert.equal(migrated.councilTrack,'dept');
assert.equal(migrated.career.language.progress,18);
assert.equal(migrated.courseStates.length,legacySave.courseStates.length);
run('state=load();save()');
assert.equal(run('load().bagLevel'),1);
for (const version of ['p0-html-0.10-m5.7','p0-html-0.10-m5.8']) {
  run(`state=initState();state.version=${JSON.stringify(version)};state.department='cse';state.bagLevel=1;
    state.subscriptionNextCharge={music:5};state.instantSpendUsed={1:['meal']};
    state.relationshipStates={peer_1:{bond:22}};save();`);
  const loaded=run('load()');
  assert.equal(loaded.bagLevel,1,version+' bag must not auto-upgrade');
  assert.equal(loaded.subscriptionNextCharge.music,5);
  assert.deepEqual([...loaded.instantSpendUsed[1]],['meal']);
  assert.equal(loaded.department,'cse');
  run('state=load();save()');
  assert.equal(run('load().bagLevel'),1);
}
run("state=initState();state.department='cse';state.otChoice='academic';state.priorityCourseId=0;startSemester();openPlanner()");
assert.equal(run('freeBudget()'),6);
run("instantSpend('meal');instantSpend('culture')");
assert.equal(run('state.money'),47000);
assert.equal(run('freeBudget()'),6);
run("instantSpend('meal');instantSpend('culture')");
assert.equal(run('state.money'),47000);
run("toggleSubscription('music')");
assert.equal(run('state.subscriptionNextCharge.music'),5);
run('state=load()');
assert.equal(run("state.instantSpendUsed['1:meal']"),true);
assert.equal(run("state.instantSpendUsed['1:culture']"),true);
assert.equal(run('state.subscriptionNextCharge.music'),5);
run("state.week=2;save()");
assert.equal(run("instantSpendUsed('meal')"),false);
run("state.week=5;state.money=70000;processSubscriptionRenewals();save()");
assert.equal(run('state.subscriptionNextCharge.music'),9);
assert.equal(run("state.subscriptionHistory.at(-1).type"),'renew');
run("toggleSubscription('music')");
assert.equal(run('state.subscriptionNextCharge.music'),undefined);
run("state=initState();state.department='cse';state.otChoice='academic';state.priorityCourseId=0;startSemester()");
assert.equal(run('bagSize()'),3);
run('renderCouncilStatus()');
assert.match(elements.get('councilStatus').innerHTML,/WEEK 2부터/);
run("state.week=2;renderCouncilStatus()");
assert.match(elements.get('councilStatus').innerHTML,/지원하기/);
run("joinCouncil('department','dept')");
assert.equal(run('state.councilId'),'department');
assert.equal(run('state.councilTrack'),'dept');
run("state.money=100000;selectBagShopItem('notes');confirmBagPurchase()");
assert.equal(run('state.inventory[0].type'),'notes');
run("state=load()");
assert.equal(run('state.inventory[0].type'),'notes');
assert.equal(run('state.councilId'),'department');
const depts=run('Object.keys(DEPTS)');
for(const d of depts){
  run(`newGame();selectDept(${JSON.stringify(d)});chooseOT('academic');finishOT();choosePriority(0);openConfirm();startSemester()`);
  assert.equal(run('state.week'),1);
  assert.equal(run('state.courseStates.length'),run(`DEPTS[${JSON.stringify(d)}].courses.length`));
  for(let w=1;w<=15;w++) {
    run(`openPlanner();state.plan=[{uid:'qa',action:'study',slots:[15],target:0}];commitPlan();afterResolve();
      while(state.evaluationSession){chooseEvaluation(evaluationOptions(state.evaluationSession)[0].id);continueEvaluation()}
      if(currentEvent){
        if(currentEvent.id==='club_offer')skipClubFair(true);
        else if(currentEvent.id==='relationship_moment')relationshipMomentChoice(relationshipRoster()[0].id);
        else chooseEvent(currentEvent.choices[0][1]);
      }`);
    assert.equal(run('state.weeklyHistory.length'),w);
    if(w===8){
      run(`nextWeek();while(!state.examSession.done){state.examSession.selected=examQuestion().correct;submitExamAnswer()}finishMidterm();`);
      assert.equal(run('state.week'),9);
    } else if(w<15) run('nextWeek()');
  }
  run('nextWeek()');
  assert.equal(run('state.phase'),'final');
  assert(Number.isFinite(run('state.gpa')));
  assert(!/undefined|NaN/.test(elements.get('gradeBody').innerHTML));
  console.log(d+' 15-week semester and final PASS');
}
assert(html.includes('v1.0 · 공식 출시'));
assert(!html.includes('P0.10-M5.8 RC'));
assert(html.includes("growSaveKey='induck-grow-p0'"));
assert.equal(run('growSaveKey'),'induck-grow-p0');
run("switchGrowSaveKey('induck-grow-p0-account-00000000-0000-0000-0000-000000000001')");
assert.equal(run('load()'),null);
run("state=initState();state.department='cse';save()");
assert.equal(run('load().department'),'cse');
run("switchGrowSaveKey('induck-grow-p0')");
assert.equal(run('load().phase'),'final');
console.log('M5.7/M5.8 save migration, local save roundtrip, six departments PASS');
