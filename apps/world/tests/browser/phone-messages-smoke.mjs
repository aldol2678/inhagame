// PHONE-MENU-02A: verified browser behavior with the *real* Hub client and synthetic RPC.
// No production credentials or live server writes. Exercises three viewport classes.
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.PHONE_HEAD_SHA,'Head must be exact pull request head');
const output='test-results/phone-messages';await mkdir(output,{recursive:true});
const sourcePaths=['src/phone/phone-messages.js','hub-messages-client.js','src/phone/smartphone.js','src/phone/phone-preferences.js','phone.css'];
const hashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(new URL('../../'+path,import.meta.url))).digest('hex')])));
const report={head,status:'RUNNING',sourceHashes:hashes,cases:[],limits:['Synthetic authenticated API responses, not actual authenticated backend/Production E2E.','NPC conversations and choice replies are excluded.']};
const save=()=>writeFile(output+'/report.json',JSON.stringify(report,null,2));
const calls=page=>page.evaluate(()=>window.fixture.calls);
const snap=page=>page.evaluate(()=>window.fixture.snapshot);
async function check(name,viewport,mobile) {
 const entry={name,viewport,status:'RUNNING',checks:[],screenshots:[]};report.cases.push(entry);await save();
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'}});
 let page;
 try {
  page=await smoke.context.newPage();page.setDefaultTimeout(25000);smoke.watch(page);
  await page.goto(smoke.origin+'/tests/browser/phone-messages-harness.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.fixture));
  const served=await page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async p=>{
   const b=await (await fetch('/'+p)).arrayBuffer();
   return [p,[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('')];
  }))),sourcePaths);
  assert.deepEqual(served,hashes);
  await page.evaluate(()=>window.fixture.open());
  await page.getByRole('button',{name:/검증 플레이어/}).first().waitFor();
  assert.equal((await snap(page)).unreadCount,2);
  await page.screenshot({path:output+'/'+name+'-inbox.png'});entry.screenshots.push(name+'-inbox.png');
  await page.getByRole('button',{name:/검증 플레이어/}).first().click();
  await page.getByText('안뇽! 캠퍼스에서 만나!',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.fixture.calls.some(x=>x.name==='mark_hub_conversation_read_v1'));
  await page.waitForFunction(()=>window.fixture.snapshot.unreadCount===0);
  const reportBtn=page.getByRole('button',{name:'신고',exact:true});
  await reportBtn.click();
  await page.waitForFunction(()=>window.fixture.calls.some(x=>x.name==='report_hub_message_v1'));
  await page.getByText('신고가 접수됐어요.').waitFor();
  await page.getByRole('textbox',{name:'메시지 내용'}).fill('답장 테스트');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.getByText('답장 테스트',{exact:true}).waitFor();
  const sent=(await calls(page)).filter(c=>c.name==='send_hub_message_v1');
  assert.equal(sent.length,1);assert.equal(sent[0].args.p_recipient,'33333333-3333-4333-8333-333333333333');
  await page.screenshot({path:output+'/'+name+'-thread.png'});entry.screenshots.push(name+'-thread.png');
  await page.getByRole('button',{name:'사용자 차단',exact:true}).click();
  await page.getByRole('button',{name:'차단 확정',exact:true}).click();
  await page.getByText('사용자를 차단했어요.').waitFor();
  assert.equal((await calls(page)).filter(x=>x.name==='block_world_user').length,1);
  assert.equal(await page.getByRole('textbox',{name:'메시지 내용'}).count(),0);
  entry.checks.push('A: unread/list, thread, read, report, one send, two-step block, composer permission');
  await page.evaluate(()=>window.fixture.switchAccount(window.fixture.B));
  await page.waitForFunction(()=>window.fixture.snapshot.accountId===window.fixture.B && !window.fixture.snapshot.busy);
  await page.getByText('아직 받은 쪽지가 없어요.').waitFor();
  assert.equal(await page.getByText('안뇽! 캠퍼스에서 만나!',{exact:true}).count(),0);
  await page.getByRole('textbox',{name:'새 쪽지 받을 사용자 ID'}).fill('33333333-3333-4333-8333-333333333333');
  await page.getByRole('button',{name:'새 대화',exact:true}).click();
  await page.getByText(/처음 연락하는 상대예요/).waitFor();
  await page.getByRole('textbox',{name:'메시지 내용'}).fill('계정 B에서 첫 쪽지');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.getByText('계정 B에서 첫 쪽지',{exact:true}).waitFor();
  await page.getByRole('button',{name:'대화 보관',exact:true}).click();
  await page.getByText('아직 받은 쪽지가 없어요.').waitFor();
  assert.equal((await calls(page)).filter(x=>x.name==='archive_hub_conversation_v1').length,1);
  entry.checks.push('B: account-specific inbox, server recipient eligibility, new send, archive');
  await page.evaluate(()=>window.fixture.switchAccount(window.fixture.A));
  await page.waitForFunction(()=>window.fixture.snapshot.accountId===window.fixture.A && !window.fixture.snapshot.busy);
  await page.getByRole('button',{name:/검증 플레이어/}).waitFor();
  await page.evaluate(()=>window.fixture.deferNextList());
  await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.holding);
  await page.evaluate(()=>window.fixture.switchAccount(window.fixture.B));
  await page.waitForFunction(()=>window.fixture.snapshot.accountId===window.fixture.B && !window.fixture.snapshot.busy);
  await page.getByText('아직 받은 쪽지가 없어요.').waitFor();
  await page.evaluate(()=>window.fixture.release());
  await page.waitForTimeout(70);
  assert.equal((await snap(page)).accountId,'22222222-2222-4222-8222-222222222222');
  assert.equal((await snap(page)).unreadCount,0);
  assert.equal(await page.getByText('안뇽! 캠퍼스에서 만나!',{exact:true}).count(),0);
  await page.evaluate(()=>window.fixture.close());
  assert.equal((await snap(page)).active,false);
  assert.equal(await page.locator('#host').locator('*').count(),0);
  entry.checks.push('A→B in-flight stale-list cancellation, close purges private DOM');
  const clip=await page.evaluate(()=>{const n=document.querySelector('.smartphone-content');return n.scrollWidth>n.clientWidth+2;});
  assert.equal(clip,false,'No horizontal overflow');
  entry.status='PASS';await save();
 }catch(err){entry.status='FAIL';entry.error=String(err.stack||err);await save();throw err;}
 finally{await page?.close().catch(()=>{});await smoke.close();}
}
try{
 for(const [n,v,m] of [['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]])await check(n,v,m);
 report.status='PASS';
}catch(err){report.status='FAIL';report.error=String(err.stack||err);process.exitCode=1;}
finally{await save();console.log(JSON.stringify(report,null,2));}
