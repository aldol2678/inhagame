import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { startSmoke } from './harness.mjs';
import { worldTimePayload, NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../../npc-factory/npc-world-time-contract.mjs';

export async function checkCampusLifeDiversity(smoke, outputDir) {
  const receipts = [];
  const cases = [ ['desktop',1440,900,0], ['portrait',390,844,1], ['landscape',844,390,1] ];
  for (const [name,width,height,cycle] of cases) {
    const page = await smoke.context.newPage();
    const fatal = smoke.watch(page);
    const serverNow = E + (cycle*5+1)*P + 799_000;
    await page.setViewportSize({width,height});
    await page.route('**/api/world-time', route => route.fulfill({status:200,
      contentType:'application/json',body:JSON.stringify(worldTimePayload(serverNow))}));
    try {
      await page.goto(smoke.origin+'/campus/?npcSync=ng2',{waitUntil:'domcontentloaded',timeout:90000});
      await Promise.race([page.waitForFunction(()=>{
        const n=window.__INHAGAME_P0__?.getStatus?.().npcTest;
        return n?.shared_schedule?.state==='SYNCED' && n?.purposeful_count===46;
      },null,{timeout:90000}),fatal]);
      const population = await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().npcTest);
      assert.equal(population.period,'class_time');
      const members=Object.values(population.purposeful);
      const attending=members.filter(n=>n.activity==='ACADEMIC' && n.currentGoal==='ATTEND_CLASS');
      assert.ok(attending.filter(n=>!n.visible).length>=10,'real runtime sinks class attendees');
      assert.ok(members.filter(n=>n.visible && n.activity==='ACADEMIC').length<=1,'outdoor class labels are no longer the majority');
      assert.ok(new Set(members.filter(n=>n.visible).map(n=>n.activity)).size>=3,'real runtime mixes free-time activity');
      // Frame the existing student-center crowd with the normal player-follow camera.
      await page.evaluate(()=>{
        const d=window.__INHAGAME_P0__, all=Object.values(d.getStatus().npcTest.purposeful);
        const npc=all.find(n=>n.visible && !n.moving && n.destination?.includes('life_student_center'));
        if(!npc) throw Error('No student-center free-time NPC');
        d.player.setLocalPosition(npc.position.x+2,d.controller.groundY,npc.position.z+2);
        d.orbit.distance=8;d.orbit.pitch=.65;d.orbit.yaw=3*Math.PI/4;
      });
      await page.waitForTimeout(1200);
      const labels=await page.locator('.npc-test-tag').evaluateAll(items=>items.filter(e=>!e.hidden).map(e=>{
        const r=e.getBoundingClientRect();return {text:e.textContent,status:e.dataset.status,x:r.x,y:r.y,w:r.width,h:r.height};
      }));
      if(outputDir) await page.screenshot({path:outputDir+'/'+name+'.png'});
      if(!labels.length) console.log('nameplate frame diagnostic',await page.evaluate(()=>{
        const d=window.__INHAGAME_P0__;return {player:d.player.getLocalPosition(),
          labels:[...document.querySelectorAll('.npc-test-tag')].map(e=>({text:e.textContent,hidden:e.hidden,status:e.dataset.status})),
          npc:d.getStatus().npcTest};
      }));
      assert.ok(labels.length>0,'actual nearby nameplates render');
      for(let i=0;i<labels.length;i++) {
        const a=labels[i];assert.ok(a.x>=6 && a.y>=6 && a.x+a.w<=width-6 && a.y+a.h<=height-6);
        for(let j=i+1;j<labels.length;j++) {
          const b=labels[j];assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y,'nameplates overlap');
        }
      }
      receipts.push({name,viewport:{width,height},cycle,hiddenClasses:attending.filter(n=>!n.visible).length,
        activities:[...new Set(members.filter(n=>n.visible).map(n=>n.activity))],labels});
    } finally { await page.close(); }
  }
  assert.deepEqual(smoke.problems,[]);
  if(outputDir) await writeFile(outputDir+'/receipt.json',JSON.stringify(receipts,null,2)+'\n');
  console.log('Campus life diversity browser PASS',JSON.stringify(receipts.map(({labels,...r})=>({...r,labelCount:labels.length}))));
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const outputDir=process.env.WORLD_SMOKE_EVIDENCE_DIR;
  if(outputDir) await mkdir(outputDir,{recursive:true});
  const smoke=await startSmoke();
  try { await checkCampusLifeDiversity(smoke,outputDir); } finally { await smoke.close(); }
}
