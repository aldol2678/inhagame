'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

class FakeParam{
  constructor(){this.value=1}
  setValueAtTime(v){this.value=v}
  exponentialRampToValueAtTime(v){this.value=v}
  linearRampToValueAtTime(v){this.value=v}
  setTargetAtTime(v){this.value=v}
  cancelScheduledValues(){}
}
class FakeNode{
  constructor(){this.gain=new FakeParam();this.frequency=new FakeParam();this.type='sine';this.onended=null}
  connect(){return this}
  disconnect(){}
  start(){}
  stop(){ if(this.onended)this.onended() }
}
class FakeContext{
  constructor(){this.state='running';this.currentTime=1;this.destination=new FakeNode()}
  createGain(){return new FakeNode()}
  createOscillator(){return new FakeNode()}
  resume(){this.state='running';return Promise.resolve()}
}
function load(){
  const window={AudioContext:FakeContext};
  const context={window,globalThis:window,performance:{now:()=>1000},Date,Math};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','audio-manager.js'),'utf8'),context);
  return context.window.InduckAudioManager;
}

test('AudioManager exposes P2.2 channels, events and BGM states',()=>{
  const api=load();
  assert(api);
  for(const name of ['fire','hit','kill','dash','hurt','quack','storm','ultimate','xp','level','evolve','objective','clear','fail','bossWarning','bossPhase','bossDown'])
    assert(api.EVENTS[name],name);
  assert.deepEqual(Array.from(api.BGM_STATES),['base','pressure','climax','resolve']);
});

test('AudioManager can unlock, switch BGM, update settings and play SFX',()=>{
  const api=load();
  const audio=api.create({musicEnabled:true,sfxEnabled:true,musicVolume:.25,sfxVolume:.45});
  assert.equal(audio.unlock(),true);
  audio.setBgmState('pressure');
  assert.equal(audio.snapshot().bgmState,'pressure');
  audio.setBgmState('climax');
  assert.equal(audio.snapshot().bgmState,'climax');
  audio.setSettings({musicEnabled:false,sfxEnabled:false});
  assert.equal(audio.snapshot().settings.musicEnabled,false);
  assert.equal(audio.play('dash'),false);
  audio.setSettings({sfxEnabled:true,sfxVolume:.5});
  assert.equal(audio.play('dash'),true);
});
