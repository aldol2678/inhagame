import assert from 'node:assert/strict';
import { worldTimePayload, NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS } from '../../npc-factory/npc-world-time-contract.mjs';

// Two independent JS worlds consume one server timeline. The server clock is shifted to a
// moving lunch leg so CI does not wait 15 minutes. No production requests or client time cheats.
export async function checkSharedSchedule(smoke) {
  const pages = [];
  const origin = Date.now();
  const serverAtStart = NPC_WORLD_EPOCH_MS + 2 * NPC_WORLD_PERIOD_MS + 5000;
  async function open() {
    const page = await smoke.context.newPage();
    pages.push(page);
    const fatal = smoke.watch(page);
    page.on('console', message => {
      if (message.type() === 'warning' && message.text().includes('Campus NPC unavailable'))
        console.log('NG2 init warning:', message.text());
    });
    await page.route('**/api/world-time', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(worldTimePayload(serverAtStart + Date.now() - origin))
    }));
    // Prove the runtime does not use the client's wall clock.
    await page.addInitScript(offset => { const realNow=Date.now.bind(Date); Date.now=()=>realNow()+offset; }, pages.length*36*3600_000);
    await page.goto(smoke.origin+'/campus/?npcSync=ng2&npcSocial=ng15&npcConversation=p0',
      { waitUntil:'domcontentloaded', timeout:90000 });
    try { await Promise.race([page.waitForFunction(() => {
      const npc=window.__INHAGAME_P0__?.getStatus?.().npcTest;
      return npc?.shared_schedule?.state==='SYNCED' && npc?.purposeful_count===46;
    },null,{timeout:90000}),fatal]);
    } catch (error) {
      console.log('NG2 init status:', await page.evaluate(() => {
        const s=window.__INHAGAME_P0__?.getStatus?.();
        return {loading:s?.loading,npc:s?.npcTest?.shared_schedule,count:s?.npcTest?.purposeful_count};
      }));
      throw error;
    }
    // SwiftShader cannot continuously rasterize two full campuses on the small CI runner.
    // Only drawing is disabled after real boot. App.update and NPC motion keep running.
    await page.evaluate(() => {
      const app = window.__INHAGAME_P0__.app;
      app.autoRender = false;
      app.renderNextFrame = false;
    });
    console.log('NG2 client ready', pages.length);
    return page;
  }
  const read = page => page.evaluate(()=>window.__INHAGAME_P0__.getStatus().npcTest);
  function compare(a,b) {
    assert.equal(a.period,b.period);
    assert.equal(a.purposeful_count,46);
    assert.equal(a.social_ng1,null,'private social simulation disabled');
    assert.equal(a.social_ng15,null,'private meetup motion disabled');
    assert.equal(a.observed_conversation,null,'private dialogue scene disabled');
    const delta=Math.abs(a.shared_schedule.frameServerNowMs-b.shared_schedule.frameServerNowMs)/1000;
    for(const [id,first] of Object.entries(a.purposeful)){
      const second=b.purposeful[id];
      assert.equal(first.scheduleIndex,second.scheduleIndex,id);
      if (!first.moving && !second.moving) assert.equal(first.visible,second.visible,id);
      // Fastest existing purposeful profile is below 2 world units/s. Include RTT uncertainty.
      assert.ok(Math.hypot(first.position.x-second.position.x,first.position.z-second.position.z)
        <=2*(delta+.5),id+' diverged across clients');
    }
  }
  try {
    const a=await open(), b=await open();
    compare(await read(a),await read(b));
    const before=await read(a);
    assert.ok(before.moving_count>0,'real runtime has walking NPCs');
    await a.waitForFunction(previous=>{
      const next=window.__INHAGAME_P0__.getStatus().npcTest;
      return Object.entries(previous).some(([id,npc])=>npc.moving &&
        Math.hypot(next.purposeful[id].position.x-npc.position.x,next.purposeful[id].position.z-npc.position.z)>.2);
    },before.purposeful,{timeout:10000});
    await b.reload({waitUntil:'domcontentloaded',timeout:90000});
    await b.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().npcTest?.shared_schedule?.state==='SYNCED',
      null,{timeout:90000});
    await b.evaluate(() => {
      const app=window.__INHAGAME_P0__.app; app.autoRender=false; app.renderNextFrame=false;
    });
    compare(await read(a),await read(b));
    assert.equal((await read(b)).period,'lunch','reload never resets to morning');
    console.log('NG2 shared schedule: two runtime pages, skewed wall clock, walking and reload PASS');
  } finally { for(const page of pages) await page.close(); }
}
