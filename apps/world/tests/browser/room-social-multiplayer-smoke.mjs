// Actual isolated browser contexts + production room/chat/input/render modules.
// Transport/auth here are explicit deterministic doubles, not live Supabase evidence.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { browserSocialServer, socialUser } from '../support/room-social-browser-server.mjs';
const output=path.resolve(process.env.ROOM_SOCIAL_QA_OUTPUT||'test-results/room-social');
await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_ROOM_HEAD)assert.equal(head,process.env.EXPECTED_ROOM_HEAD);
const report={head,validation:'production-client-two-isolated-browser-contexts-synthetic-auth-and-transport',scenarios:[]};
let failure;
const viewports=[{name:'desktop',width:1280,height:720,mobile:false},{name:'portrait',width:390,height:844,mobile:true},{name:'landscape',width:844,height:390,mobile:true}];
for(const viewport of viewports)for(const kind of ['personal','club']){
  const server=browserSocialServer(),smokes=[],pages=[];
  const row={viewport,kind,checks:[],pass:false};report.scenarios.push(row);
  const tick=setInterval(()=>server.club.advance(50),50);
  try{
    for(let n=1;n<=2;n++){
      const smoke=await startSmoke({viewport,contextOptions:{isMobile:viewport.mobile,hasTouch:viewport.mobile}});smokes.push(smoke);
      const uid=socialUser(n);
      await smoke.context.exposeBinding('__socialRpc',(_s,name,args)=>server.rpc(uid,name,args));
      await smoke.context.exposeBinding('__socialSubscribe',({page},id,topic,options)=>server.subscribe(uid,id,topic,options,event=>{
        void page.evaluate(data=>window.__socialDeliver(data),{id,...event}).catch(error=>{if(!page.isClosed())smoke.problems.push(String(error));});
      }));
      await smoke.context.exposeBinding('__socialTrack',(_s,id,p)=>server.track(id,p));
      await smoke.context.exposeBinding('__socialSend',(_s,id,p)=>server.send(id,p));
      await smoke.context.exposeBinding('__socialRemove',(_s,id)=>server.remove(id));
      const page=await smoke.context.newPage();page.setDefaultTimeout(TIMEOUT_MS);pages.push(page);smoke.watch(page);
      await page.goto(`${smoke.origin}/tests/browser/room-social-multiplayer-harness.html?member=${n}&kind=${kind}`);
      await page.waitForFunction(()=>window.__SOCIAL_QA__?.ready||window.__SOCIAL_QA__?.error,null,{timeout:TIMEOUT_MS});
      assert.equal(await page.evaluate(()=>window.__SOCIAL_QA__.error??null),null);
    }
    const [a,b]=pages;
    await a.evaluate(()=>window.__SOCIAL_QA__.revalidate());
    for(const page of pages)await page.waitForFunction(()=>{const s=window.__SOCIAL_QA__.snapshot();return s.remoteCount===1&&s.state.online&&s.chat.ready;},null,{timeout:TIMEOUT_MS});
    row.checks.push('two isolated contexts, two production avatars, room session and chat READY');
    if(kind==='club'){
      for(const page of pages)await page.evaluate(()=>window.__SOCIAL_QA__.positionBy('chair_s0'));
      const claims=await Promise.all(pages.map(page=>page.evaluate(()=>window.__SOCIAL_QA__.sit())));
      assert.equal(claims.filter(Boolean).length,1,'synthetic seat race has exactly one winner');
      const other=claims[0]?b:a;await other.evaluate(()=>window.__SOCIAL_QA__.positionBy('chair_s1'));
      assert.equal(await other.evaluate(()=>window.__SOCIAL_QA__.sit()),true);
      for(const page of pages)await page.evaluate(()=>window.__SOCIAL_QA__.revalidate());
      row.checks.push('simultaneous browser seat intent, unique winner and second separate chair');
    }
    // Direct Chromium capture avoids Playwright's additional two-animation-frame preparation,
    // which can outlive a four-second bubble on software-rendered CI. No clock or UI is frozen.
    const captureSessions=await Promise.all(pages.map(page=>page.context().newCDPSession(page)));
    const captureOptions={format:'png',fromSurface:true,captureBeyondViewport:false};
    await Promise.all(captureSessions.map(session=>session.send('Page.captureScreenshot',captureOptions)));
    await a.locator('#chat-toggle').click();
    await a.locator('#chat-input').fill('안녕, 같은 방 친구!');
    await a.locator('#chat-input').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true});
    assert.equal(await a.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0,'IME composition does not send');
    const before=await a.evaluate(()=>window.__SOCIAL_QA__.snapshot().position);
    await a.locator('#chat-input').press('w');
    assert.deepEqual(await a.evaluate(()=>window.__SOCIAL_QA__.snapshot().position),before,'typing does not move player');
    await a.locator('#chat-input').fill('안녕, 같은 방 친구!');
    await a.locator('#chat-input').press('Enter');
    row.captures=await Promise.all(pages.map(async(page,i)=>{
      const text='안녕, 같은 방 친구!';
      await page.waitForFunction(text=>window.__SOCIAL_QA__.captureChat(text).visible,text);
      const before=await page.evaluate(text=>window.__SOCIAL_QA__.captureChat(text),text);
      const file=`${viewport.name}-${kind}-${i+1}-chat.png`;
      const image=await captureSessions[i].send('Page.captureScreenshot',captureOptions);
      const after=await page.evaluate(text=>window.__SOCIAL_QA__.captureChat(text),text);
      await writeFile(path.join(output,file),Buffer.from(image.data,'base64'));
      return {file,method:'Chromium Page.captureScreenshot fromSurface',before,after};
    }));
    for(const [i,capture] of row.captures.entries()){
      const {before,after}=capture,text='안녕, 같은 방 친구!',expected=i===0?text:`방주인: ${text}`;
      for(const receipt of [before,after]){
        assert.match(receipt.messageId,/^[0-9a-f-]{36}$/i,'server message ID is captured');
        assert.ok(receipt.feedId>0);assert.equal(receipt.text,text);assert.equal(receipt.modelBubble,expected);
        assert.equal(receipt.visible,true,'same production bubble is visible before AND after screenshot');
        assert.equal(receipt.insideViewport,true,'speech bubble fits viewport');
        assert.equal(receipt.annotationClear,true,'QA annotation does not cover speech bubble');
        assert.equal(receipt.inputValue,'');assert.notEqual(receipt.activeInput,'chat-input');
      }
      assert.equal(after.messageId,before.messageId);assert.equal(after.feedId,before.feedId);
    }
    assert.equal(row.captures[0].before.messageId,row.captures[1].before.messageId,'both contexts captured the same server message');
    row.checks.push('real input IME/Enter, no movement while typing, server-named feed + rendered remote bubble, focus released');
    row.checks.push('same message ID and visible production bubble verified before and after both screenshots');
    await b.locator('#chat-toggle').click();await b.locator('#chat-input').fill('<img src=x onerror=window.__xss=1>');await b.locator('#chat-input').press('Enter');
    await a.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().feed.some(e=>e.text.startsWith('<img')));
    assert.equal(await a.locator('#chat-feed img').count(),0);assert.equal(await a.evaluate(()=>window.__xss??null),null);
    await a.evaluate(()=>window.__SOCIAL_QA__.panel.setOpen(true));await a.locator('#chat-input').fill('취소할 문장');await a.locator('#chat-input').press('Escape');
    assert.equal(await a.locator('#chat-form').isVisible(),false);assert.notEqual(await a.evaluate(()=>document.activeElement?.id),'chat-input');
    row.checks.push('XSS remains inert text and Escape releases composer');
    const feedBefore=await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length);
    const target=[...server.leases.values()].find(l=>l.userId===socialUser(2));
    const source=[...server.leases.values()].find(l=>l.userId===socialUser(1));
    for(const sub of server.subscribers.values())if(sub.userId===socialUser(2)&&sub.topic.startsWith('world:room-chat:')) {
      for(const inboxNonce of [undefined,source.inboxNonce])sub.deliver({kind:'broadcast',event:'room_chat_v1',payload:{v:1,id:'30000000-0000-4000-8000-000000009999',kind:target.kind,roomId:target.roomId,sessionId:source.sessionId,userId:source.userId,name:'위조',text:'forged cached provider packet',inboxNonce}});
    }
    await new Promise(r=>setTimeout(r,100));assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),feedBefore);
    row.checks.push('cached provider forgery with missing or cross-recipient nonce adds zero feed entries');
    server.resetLimits();
    for(const text of ['limit-1','limit-2','limit-3'])assert.equal(await a.evaluate(text=>window.__SOCIAL_QA__.chat.submit(text),text).then(v=>v.result),'sent');
    assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('limit-4'))).result,'rate_limited');
    assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('👋'.repeat(121)))).result,'too_long');
    row.checks.push('client Unicode limit and synthetic server rate feedback');
    if(kind==='club'){
      await a.locator('#qa-wave').click();await b.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().remoteEmote==='wave');
      row.checks.push('production emote transport and remote avatar action');
    }
    server.block(socialUser(1),socialUser(2)); server.resetLimits();
    await b.evaluate(uid=>window.__SOCIAL_QA__.chat.removeSender(uid),socialUser(1));
    const blockedCount=await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length);
    assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('차단 후 숨김'))).result,'sent');
    await new Promise(r=>setTimeout(r,150));assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),blockedCount);
    server.unblock(socialUser(1),socialUser(2));
    row.checks.push('block clears sender messages and excludes subsequent cached-inbox fanout in the synthetic contract');
    await b.evaluate(()=>window.__SOCIAL_QA__.reconnectChat());
    assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0);
    assert.equal((await b.evaluate(()=>window.__SOCIAL_QA__.chat.submit('offline'))).result,'room_unavailable');
    await b.evaluate(()=>window.__SOCIAL_QA__.reenterChat());await b.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().chat.ready);
    assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0);
    server.resetLimits();assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('다시 연결됨'))).result,'sent');
    await b.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().feed.some(e=>e.text==='다시 연결됨'));
    row.checks.push('disconnect clears feed, offline send refused, fresh join without history replay');
    await b.evaluate(()=>window.__SOCIAL_QA__.switchRoom());await b.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().chat.ready);
    assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('이전 방 메시지'))).result,'sent');
    await new Promise(r=>setTimeout(r,150));assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0);
    row.checks.push('room switch clears draft/transcript and isolates subsequent traffic');
    server.denied.add(socialUser(1));
    assert.equal(await a.evaluate(()=>window.__SOCIAL_QA__.chat.revalidateNow()),false);
    assert.equal(await a.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0);
    assert.equal((await a.evaluate(()=>window.__SOCIAL_QA__.chat.submit('권한 없음'))).result,'room_unavailable');
    row.checks.push('permission recheck denial clears feed and fails closed');
    await b.evaluate(()=>window.__SOCIAL_QA__.identityChange());
    assert.equal(await b.evaluate(()=>window.__SOCIAL_QA__.snapshot().chat.active),false);
    await a.locator('#qa-leave').click();await a.waitForFunction(()=>window.__SOCIAL_QA__.snapshot().channels===0);
    assert.equal(await a.evaluate(()=>window.__SOCIAL_QA__.snapshot().feed.length),0);
    row.checks.push('account switch and exit clean channels, bubbles and feed');
    row.snapshots=await Promise.all(pages.map(page=>page.evaluate(()=>window.__SOCIAL_QA__.snapshot())));
    assert.deepEqual(smokes.flatMap(s=>s.problems),[]);row.pass=true;
  }catch(error){row.error=String(error?.stack??error);failure=error;
    row.snapshots=await Promise.all(pages.map(page=>page.evaluate(()=>window.__SOCIAL_QA__?.snapshot?.()).catch(error=>({error:String(error)}))));
    row.server={sessions:[...server.club.sessions.values()].map(({inboxNonce,...safe})=>safe),calls:server.club.calls.slice(-40)};
    await Promise.all(pages.map((page,i)=>page.screenshot({path:path.join(output,`${viewport.name}-${kind}-${i+1}-failure.png`)}).catch(()=>{})));
  }finally{clearInterval(tick);await Promise.all(smokes.map(s=>s.close()));await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  if(failure)throw failure;
}
console.log(`Room social browser PASS: ${report.scenarios.length} scenarios at ${head}`);
