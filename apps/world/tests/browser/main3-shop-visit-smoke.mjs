// Narrow browser acceptance: real Main3 client + Cloud handler/local store + shared HUD and
// guide rendering + canonical world-entry controller. This does NOT claim full-campus 3D or SQL QA.
// No external network, real account, purchase, or operational service is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createLocalQuestStore } from '../../npc-factory/quest-store.mjs';
import { createQuestCloudHandler } from '../../npc-factory/quest-cloud-handler.mjs';
import { QUEST_ID } from '../../npc-factory/quest-contract.mjs';
import { MAIN2_QUEST_ID, MAIN2_QUEST_EVENTS } from '../../npc-factory/main2-quest-contract.mjs';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
if (process.env.CI === 'true') assert.match(process.env.EXPECTED_MAIN3_HEAD ?? '', /^[0-9a-f]{40}$/);
if (process.env.EXPECTED_MAIN3_HEAD) assert.equal(head, process.env.EXPECTED_MAIN3_HEAD, 'exact PR head required');
const sourcePaths = ['npc-factory/main3-quest-client.mjs','npc-factory/main3-guide-dialogue.mjs',
  'npc-factory/main3-quest-contract.mjs','npc-factory/quest-cloud-handler.mjs','npc-factory/quest-store.mjs',
  'src/quest/quest-runtime.js','src/quest/quest-registry.js','src/quest/legacy-quest-adapters.js',
  'src/quest/quest-hud.js','src/shop/shop-world-interaction.js','src/context-action.js'];
const sourceHashes = await Promise.all(sourcePaths.map(async source => ({ source,
  sha256: createHash('sha256').update(await readFile(new URL('../../'+source, import.meta.url))).digest('hex') })));
const servedHashes = new Map();
const store = createLocalQuestStore();
const calls = [];
const handler = createQuestCloudHandler({ store: async (user, event, questId) => {
  calls.push({ user, event, questId }); return store(user, event, questId);
}, verifyUser: async value => /^Bearer fixture-(desktop|mobile)$/.test(value ?? '') ? value.slice(7) : null });
for (const user of ['fixture-desktop', 'fixture-mobile']) {
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) await store(user, event, QUEST_ID);
  for (const event of MAIN2_QUEST_EVENTS.filter(e => e !== 'status')) await store(user, event, MAIN2_QUEST_ID);
}
const worldDir = fileURLToPath(new URL('../../', import.meta.url));
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Main3 local component acceptance</title>
<style>body{margin:20px;background:#f4f7f9;color:#172c39;font:16px/1.5 system-ui}section{padding:18px;border:1px solid #889aa7;border-radius:12px;margin:16px 0}button{font:inherit;padding:10px;margin:4px}#heading,#objective{display:block}#bearing{display:none}</style>
<h1>MAIN 3 · local component fixture</h1><p>Guide, shared HUD, world-entry and local HTTP authority. No live account or purchase.</p>
<section id="hud"><button id="hud-open">퀘스트</button><strong id="heading"></strong><span id="objective"></span><span id="bearing"></span></section>
<section id="guide"><h2>후문 안내 학생</h2><p id="line"></p><div id="choices"></div></section>
<button id="menu">메뉴에서 상점 열기</button><button id="entry">학생회관 입구 도착</button><button id="context" hidden>🛍 학생회관 상점</button>
<section id="shop" hidden>학생회관 상점 열림 (구매 fixture 없음)</section><button id="logout">로그아웃</button>
<script type="module">
import {createMain3QuestClient} from '/npc-factory/main3-quest-client.mjs';
import {renderMain3GuideDialogue} from '/npc-factory/main3-guide-dialogue.mjs';
import {createQuestRuntime} from '/src/quest/quest-runtime.js';
import {createTrackedQuestHud} from '/src/quest/quest-hud.js';
import {createShopWorldInteraction,STUDENT_CENTER_SHOP_ENTRY as anchor} from '/src/shop/shop-world-interaction.js';
import {createContextActionController} from '/src/context-action.js';
const el=id=>document.getElementById(id), mode=new URLSearchParams(location.search).get('mode')||'desktop';
const quest=createMain3QuestClient({enabled:true,endpoint:'/quest',getSession:async()=> 'fixture-'+mode});
const runtime=createQuestRuntime(); let closed=false;
quest.onChange(main3Quest=>runtime.update({main3Quest}));
createTrackedQuestHud({root:el('hud'),openButton:el('hud-open'),headingElement:el('heading'),objectiveElement:el('objective'),bearingElement:el('bearing'),runtime});
const render=()=>renderMain3GuideDialogue({quest,line:el('line'),clearChoices:()=>el('choices').replaceChildren(),
 addChoice:(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',fn);el('choices').append(b);return b;},
 closeDialogue:()=>{closed=true;el('guide').hidden=true;},isCurrent:()=>!closed});
const openShop=()=>{el('shop').hidden=false;return true;};
const world=createShopWorldInteraction({getAvailable:()=>quest.status().signedIn,openPanel:openShop,onEnter:()=>quest.visitStudentCenter()});
const slot=createContextActionController({button:el('context'),shortcut:'F',coarsePointer:mode==='mobile'});
el('menu').onclick=openShop;
el('entry').onclick=()=>{el('shop').hidden=true;slot.set('student-center-shop',world.observe(anchor,{placeZoneId:anchor.placeZoneId}));slot.refresh();};
window.addEventListener('keydown',e=>{if(e.code==='KeyF'&&!e.repeat)slot.trigger();});
el('logout').onclick=()=>quest.setSignedIn(false);
await quest.setSignedIn(true);render();window.fixture={quest,runtime,world,ready:true};
</script></html>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/quest') return handler(req, res);
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const local = path.resolve(worldDir, '.' + decodeURIComponent(url.pathname));
    if (!local.startsWith(worldDir)) throw Error('outside fixture');
    const content = await readFile(local);
    servedHashes.set(url.pathname.slice(1), createHash('sha256').update(content).digest('hex'));
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const output = path.resolve(process.env.MAIN3_QA_OUTPUT || 'test-results/main3-shop-visit');
await mkdir(output, { recursive: true });
if (process.env.MAIN3_SERVE_ONLY === '1') { console.log('MAIN3_FIXTURE_URL=' + origin); await new Promise(() => {}); }
const browser = await chromium.launch({ headless: true,
  ...(process.env.MAIN3_BROWSER_CHANNEL ? { channel: process.env.MAIN3_BROWSER_CHANNEL } : {}), ...(process.env.MAIN3_BROWSER_PATH ? { executablePath: process.env.MAIN3_BROWSER_PATH } : {}) });
const results = [];
let currentPage = null, currentMode = null;
try {
  for (const [mode, viewport] of [['desktop', {width:1280,height:720}], ['mobile', {width:390,height:844}]]) {
    const context = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile', serviceWorkers:'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); currentPage = page; currentMode = mode; const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(origin+'/?mode='+mode); await page.waitForFunction(()=>window.fixture?.ready);
    assert.equal(await page.locator('#objective').innerText(), '후문 안내 학생과 대화');
    await page.getByRole('button',{name:'굿즈샵 가보기',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.quest.stage===1);
    assert.equal(await page.locator('#objective').innerText(), '학생회관 굿즈샵으로 가 보자');
    await page.getByRole('button',{name:'알겠어요',exact:true}).click();
    await page.screenshot({path:path.join(output,mode+'-stage1.png'),fullPage:true});
    await page.locator('#menu').click(); assert.equal(await page.evaluate(()=>window.fixture.quest.stage),1,'menu open is not a world visit');
    await page.locator('#entry').click(); assert.equal(await page.evaluate(()=>window.fixture.quest.stage),1,'proximity is not entry');
    if(mode==='desktop')await page.keyboard.press('f'); else await page.locator('#context').tap();
    await page.waitForFunction(()=>window.fixture.quest.stage===2);
    assert.equal(await page.locator('#shop').isVisible(),true);
    assert.equal(await page.locator('#objective').innerText(),'굿즈샵에서 마음에 드는 물건을 하나 골라 보자');
    await page.screenshot({path:path.join(output,mode+'-stage2.png'),fullPage:true});
    await page.reload();await page.waitForFunction(()=>window.fixture?.ready);
    assert.equal(await page.evaluate(()=>window.fixture.quest.stage),2,'reload restores server stage');
    await page.locator('#logout').click();assert.equal(await page.locator('#hud').isVisible(),false);
    assert.deepEqual(errors,[]);
    const events=calls.filter(c=>c.user==='fixture-'+mode).map(c=>c.event);
    assert.deepEqual(events,['status','start','visit_student_center','status']);
    const screenshots = await Promise.all(['stage1','stage2'].map(async stage => {
      const filename=mode+'-'+stage+'.png'; const bytes=await readFile(path.join(output,filename));
      assert.ok(bytes.byteLength>2000,'rendered component screenshot bytes');
      return {filename,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.byteLength};
    }));
    results.push({mode,viewport,events,screenshots,pass:true});await context.close();
  }
  for (const item of sourceHashes.filter(item=>!['npc-factory/quest-cloud-handler.mjs','npc-factory/quest-store.mjs'].includes(item.source))) assert.equal(servedHashes.get(item.source),item.sha256,'browser served exact source '+item.source);
  const report={head,tree,sourceHashes,visualReview:'PENDING_INDEPENDENT_PIXEL_REVIEW',scope:'component browser acceptance, local HTTP authority only; not full-campus or PostgreSQL',browser:browser.version(),results};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch (error) {
  if (currentPage) await currentPage.screenshot({path:path.join(output,(currentMode ?? 'unknown')+'-failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(output,'failure.json'),JSON.stringify({head,tree,sourceHashes,results,error:String(error.stack ?? error)},null,2));
  throw error;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
