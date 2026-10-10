import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiryongVillageDialogueRuntime } from '../src/biryong/biryong-village-dialogue-runtime.js';
const guidance = await import('../src/biryong/biryong-dialogue-guidance.js').catch(()=>({}));

class Element {
  constructor(){this.hidden=false;this.dataset={};this.style={};this.children=[];this.listeners=new Map();this.parts=new Map();this.textContent='';}
  setAttribute(){} focus(){} remove(){} appendChild(el){this.children.push(el);return el;} append(el){this.appendChild(el);}
  replaceChildren(...els){this.children=[...els];}
  querySelector(selector){if(!this.parts.has(selector))this.parts.set(selector,new Element());return this.parts.get(selector);}
  addEventListener(event,fn){if(!this.listeners.has(event))this.listeners.set(event,new Set());this.listeners.get(event).add(fn);}
  removeEventListener(event,fn){this.listeners.get(event)?.delete(fn);}
  click(){for(const fn of this.listeners.get('click')??[])fn({preventDefault(){},stopPropagation(){}});}
}
function rig({navigate=()=>true}={}) {
  const oldDocument=globalThis.document;
  const doc=new Element();doc.body=new Element();doc.createElement=()=>new Element();globalThis.document=doc;
  let npcId='BR_NPC_001';const calls=[];
  const runtime=createBiryongVillageDialogueRuntime({
    npcRuntime:{nearestNpc:()=>({id:npcId,name:'주민',distance:1}),pauseNpc:id=>calls.push(['pause',id]),resumeNpc:id=>calls.push(['resume',id]),
      actorSnapshot:id=>({id,name:'주민',role:'주민',faction:'마을',visible:true,destination:'STATION_WEST',activity:'WORK'}),status:()=>({period:'morning'})},
    onOpenChange:open=>calls.push(['open',open]),onNavigate:navigate
  });
  const panel=doc.body.children[0];
  return {runtime,calls,panel,actions:()=>panel.querySelector('[data-actions]').children,
    open(id='BR_NPC_001'){npcId=id;return runtime.getContextAction().trigger();},
    click(label){const button=this.actions().find(el=>el.textContent===label);assert.ok(button,label);button.click();return button;},
    cleanup(){runtime.destroy();globalThis.document=oldDocument;}};
}

test('NPC guidance allowlist maps only approved Stage-1 topics to current Biryong destinations',()=>{
  assert.equal(typeof guidance.biryongDialogueDestinations,'function');
  assert.deepEqual(guidance.biryongDialogueDestinations('BR_NPC_001','work'),['poi.biryong-realm.station','poi.biryong-realm.market']);
  assert.ok(guidance.biryongDialogueDestinations('BR_NPC_003','map').includes('poi.biryong-realm.return'));
  assert.deepEqual(guidance.biryongDialogueDestinations('BR_NPC_006','craft'),['poi.biryong-realm.workshop']);
  assert.deepEqual(guidance.biryongDialogueDestinations('BR_NPC_007','forest'),[]);
  assert.deepEqual(guidance.biryongDialogueDestinations('BR_NPC_001','S3_A'),[]);
});

test('real dialogue topic button sets one destination and closes/resumes the same NPC',()=>{
  const targets=[];const r=rig({navigate:id=>{targets.push(id);return true;}});
  try{r.open();r.click('화물 일');const btn=r.click('📍 중앙시장 · 창고거리 길안내');
    assert.deepEqual(targets,['poi.biryong-realm.market']);assert.equal(r.runtime.open,false);
    assert.deepEqual(r.calls.slice(-2),[['resume','BR_NPC_001'],['open',false]]);
    btn.click();assert.equal(targets.length,1,'retained closed callback is inert');
  }finally{r.cleanup();}
});

test('failed guidance retains dialogue and reports unavailable without fake navigation success',()=>{
  const r=rig({navigate:()=>false});
  try{r.open();r.click('화물 일');r.click('📍 비룡역 길안내');assert.equal(r.runtime.open,true);
    assert.match(r.panel.querySelector('[data-line]').textContent,/안내.*준비|길.*표시.*없/);
  }finally{r.cleanup();}
});

test('stale topic/old-session callbacks cannot guide after changing topic, NPC or reopening',()=>{
  const targets=[];const r=rig({navigate:id=>{targets.push(id);return true;}});
  try{r.open();r.click('화물 일');const old=r.actions().find(el=>el.textContent==='📍 비룡역 길안내');assert.ok(old);
    r.click('다른 이야기');old.click();assert.equal(targets.length,0);
    r.click('화물 일');const second=r.actions().find(el=>el.textContent==='📍 비룡역 길안내');
    r.runtime.close();r.open();second.click();assert.equal(targets.length,0);
    r.click('화물 일');const third=r.actions().find(el=>el.textContent==='📍 비룡역 길안내');
    r.runtime.close();r.open('BR_NPC_006');third.click();assert.equal(targets.length,0);
  }finally{r.cleanup();}
});
