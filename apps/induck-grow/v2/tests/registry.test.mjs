import test from 'node:test';
import assert from 'node:assert/strict';
import {MAJOR_CATALOG, FOUNDATION_MAJOR_IDS, LEGACY_MAJOR_IDS, findMajor, listMajors} from '../major-registry.mjs';
import {validateMajorRegistry,assertValidMajorRegistry} from '../validate-major-registry.mjs';
import {applySignatureChoice} from '../signature-choice.mjs';

test('36 stable IDs / 8 families / 12 per wave / no missing content refs',()=>{
  assert.equal(assertValidMajorRegistry(),true);
  assert.equal(MAJOR_CATALOG.length,36);
  assert.equal(new Set(MAJOR_CATALOG.map(m=>m.family)).size,8);
  assert.deepEqual([1,2,3].map(w=>listMajors({wave:w}).length),[12,12,12]);
  assert.equal(listMajors({wave:1}).filter(m=>m.playability==='foundation').length,12);
  assert(LEGACY_MAJOR_IDS.every(id=>findMajor(id)));
  assert(FOUNDATION_MAJOR_IDS.every(id=>findMajor(id)?.signatureEvent));
  assert.equal(findMajor('premed').calendarTemplate,'six_year_professional');
  assert.equal(findMajor('undeclared'),null);
});

test('foundation signature events are deterministic, different, idempotent and immutable',()=>{
  for (const id of FOUNDATION_MAJOR_IDS) {
    const major=findMajor(id),choices=major.signatureEvent.choices;
    const start={stats:{analysis:20,creative:20,expression:20,collaboration:20,execution:20,recovery:20},completedEventInstances:[],memories:[],flags:{}};
    const results=choices.map(choice=>applySignatureChoice(id,choice.id,start));
    assert.deepEqual(start.completedEventInstances,[]);
    assert(results.every(result=>result.applied));
    assert.equal(new Set(results.map(result=>JSON.stringify(result.state.stats))).size,3,id);
    for (let i=0;i<results.length;i++) {
      const again=applySignatureChoice(id,choices[i].id,start);
      assert.deepEqual(again,results[i]);
      const repeat=applySignatureChoice(id,choices[i].id,again.state);
      assert.equal(repeat.applied,false);
      assert.deepEqual(repeat.state,again.state);
      assert.equal(again.state.memories.length,1);
      assert.equal(again.state.completedEventInstances.length,1);
      assert(again.state.flags[choices[i].outcomeFlag]);
    }
  }
});

test('incomplete major has no fake runtime content',()=>{
  for(const major of listMajors({wave:2}).concat(listMajors({wave:3}))) {
    assert.equal(major.signatureEvent,null);
    assert.equal(major.playability,'planned');
    assert.throws(()=>applySignatureChoice(major.id,'bad',{}),/not implemented/);
  }
});

test('validator rejects duplicates, broken refs and unsafe effects',()=>{
  const copy=()=>structuredClone(MAJOR_CATALOG);
  let catalog=copy(); catalog[1].id=catalog[0].id;
  assert.equal(validateMajorRegistry(catalog).ok,false);
  catalog=copy();catalog.find(m=>m.id==='ai').signatureEvent.choices[0].effects.delta=-500;
  assert.equal(validateMajorRegistry(catalog).ok,false);
  catalog=copy();catalog.find(m=>m.id==='mech').eventPackIds=['world.wallet.credit'];
  assert.equal(validateMajorRegistry(catalog).ok,false);
  catalog=copy();catalog.find(m=>m.id==='premed').calendarTemplate='four_year_8_terms';
  assert.equal(validateMajorRegistry(catalog).ok,false);
});

test('runtime resolver rejects unknown inputs without modifying state',()=>{
  const state={stats:{analysis:10},completedEventInstances:[],memories:[]};
  assert.throws(()=>applySignatureChoice('none','no',state));
  assert.throws(()=>applySignatureChoice('ai','bad',state));
  assert.throws(()=>applySignatureChoice('ai',findMajor('ai').signatureEvent.choices[0].id,{stats:{analysis:110},completedEventInstances:[],memories:[]}),RangeError);
  assert.deepEqual(state,{stats:{analysis:10},completedEventInstances:[],memories:[]});
});
