// Exercises the actual /learn/ entry; fixture injection exists only in this test.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.WORLD_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root))throw Error();const data=await readFile(file);
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.statusCode=404;res.end('not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const output=resolve('test-results/learning-web');await mkdir(output,{recursive:true});
try{
  browser=await chromium.launch({headless:true,...(process.env.WORLD_SMOKE_EXECUTABLE?{executablePath:process.env.WORLD_SMOKE_EXECUTABLE}:{})});
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:360,height:780}]]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce',...(name==='mobile'?{isMobile:true,hasTouch:true}:{}),serviceWorkers:'block'});
    const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push(r.url()));
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/learn/');await page.getByRole('button',{name:'학습 콘텐츠 준비 중'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'학습 콘텐츠 준비 중'}).isDisabled(),true);
    assert.equal(requests.some(u=>u.includes('/learning-content/')),false);assert.equal(requests.every(u=>u.startsWith(origin)),true);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
    await page.screenshot({path:output+'/'+name+'-gate.png',fullPage:true});
    await context.route('**/src/learning-web/entry.js',r=>r.fulfill({contentType:'text/javascript',body:`
      import {createLearningWeb} from './web-view.js';
      import {createLearningCatalog} from '../learning/learning-content.js';
      import {learningFixture} from '../../tests/support/learning-fixture.mjs';
      const catalog=createLearningCatalog(learningFixture());
      window.testStudy=createLearningWeb({host:document.querySelector('#study-app'),loadContent:async()=>catalog});
      await window.testStudy.ready;
    `}));
    await page.reload();await page.getByRole('button',{name:'오늘의 학습 시작',exact:true}).waitFor();
    await page.screenshot({path:output+'/'+name+'-home.png',fullPage:true});
    const snapshot=()=>page.evaluate(()=>window.testStudy.snapshot());
    await page.getByRole('button',{name:'오늘의 학습 시작',exact:true}).click();
    await page.locator('[data-action="choose"][data-value="1"]').click();await page.reload();
    await page.getByRole('button',{name:/번째 문제부터 이어하기/}).click();assert.equal((await snapshot()).run.attempt.selection,1);
    await page.getByRole('button',{name:'정답 확인',exact:true}).click();
    assert.equal((await snapshot()).run.attempt.isCorrect,false);await page.reload();
    await page.getByRole('button',{name:/번째 문제부터 이어하기/}).click();
    assert.equal((await snapshot()).run.attempt.checked,true);assert.equal(Object.values((await snapshot()).progress.learningHistory)[0].answered,1);
    await page.getByRole('button',{name:'다음 문제',exact:true}).click();
    await page.getByRole('button',{name:'생각할 힌트'}).click();await page.locator('[data-action="choose"][data-value="0"]').click();await page.getByRole('button',{name:'정답 확인',exact:true}).click();
    await page.screenshot({path:output+'/'+name+'-question.png',fullPage:true});
    await page.getByRole('button',{name:'다음 문제',exact:true}).click();
    while(!(await snapshot()).run.finished){
      const r=(await snapshot()).run;
      if(!r.attempt.checked){await page.locator('[data-action="choose"][data-value="0"]').click();await page.getByRole('button',{name:'정답 확인',exact:true}).click();}
      await page.locator('[data-action="next"]').click();
    }
    assert.equal((await snapshot()).run.answers.length,12);assert.equal(Object.values((await snapshot()).progress.learningHistory)[0].answered,12);
    await page.getByRole('heading',{name:'오늘의 한 걸음, 완료!'}).waitFor();assert.equal(await page.locator('.result-score').textContent(),'9 / 10');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:output+'/'+name+'-result.png',fullPage:true});
    await page.reload();assert.equal(Object.values((await snapshot()).progress.learningHistory)[0].answered,12);
    // Start fresh, then force cursor-only quota failure; the visible grade survives retry.
    await page.getByRole('button',{name:'오늘의 학습 시작',exact:true}).click();await page.locator('[data-action="choose"][data-value="0"]').click();
    await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('learning-daily-v1'))throw new DOMException('full','QuotaExceededError');return window.originalSet.call(this,k,v);};});
    await page.getByRole('button',{name:'정답 확인',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal((await snapshot()).status.dirty,true);
    await page.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});await page.getByRole('button',{name:'저장 다시 시도'}).click();assert.equal((await snapshot()).status.dirty,false);
    // Two actual tabs: the stale view must not overwrite the first tab's cursor.
    const other=await context.newPage();await other.goto(origin+'/learn/');await other.getByRole('button',{name:/번째 문제부터 이어하기/}).click();
    await page.getByRole('button',{name:'다음 문제',exact:true}).click();await other.getByRole('button',{name:'다음 문제',exact:true}).click();
    assert.equal((await other.evaluate(()=>window.testStudy.snapshot())).status.blocked,true);
    await other.getByRole('button',{name:'현재 기록 백업'}).click();assert.match(await other.getByRole('textbox',{name:'학습 기록 백업 JSON'}).inputValue(),/induck.learning.daily.recovery/);
    assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${name}: gate, ten questions, hint, two rechecks, reload, quota retry, two tabs, no overflow/errors`);
  }
}finally{await browser?.close();await new Promise(r=>server.close(r));}
