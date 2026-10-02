'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const audio=fs.readFileSync('audio-manager.js','utf8');

for(const id of ['musicEnabled','musicVolume','sfxEnabled','sfxVolume','impactFlash'])
  assert(html.includes(`id="${id}"`),`missing P2.2 UI #${id}`);

for(const token of [
  "./audio-manager.js",
  "InduckAudioManager?.create",
  "musicEnabled:gameSettings.musicEnabled",
  "sfxEnabled:gameSettings.sfxEnabled",
  "playSfx('fire')",
  "playSfx(e.isBoss||e.elite?'eliteHit':'hit')",
  "playSfx('xp')",
  "playSfx('heal')",
  "playSfx('objective')",
  "playSfx('stairStart')",
  "playSfx('bossWarning')",
  "playSfx('bossPhase')",
  "playSfx(clear?'clear':'fail')",
  "setBgmState('climax')",
  "function updateBgmMood()",
  "cameraImpulse=Math.max(0,cameraImpulse-dt*1.9)"
]) assert(html.includes(token),`missing P2.2 contract: ${token}`);

for(const token of ["fire:{","hit:{","quack:{","ultimate:{","bossDown:{","base:{","pressure:{","climax:{","resolve:{","min:65","voices:"])
  assert(audio.includes(token),`missing AudioManager contract: ${token}`);

new vm.Script(audio,{filename:'audio-manager.js'});
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1].trim()).filter(Boolean);
for(let i=0;i<inline.length;i++)new vm.Script(inline[i],{filename:`index-inline-${i}.js`});

console.log('P2.2 Feel & Audio contracts PASS');
