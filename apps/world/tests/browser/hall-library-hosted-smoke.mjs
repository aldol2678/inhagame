// Hosted-only actual WebGL2 evidence. No browser installation or credentials here.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startSmoke} from './harness.mjs';

const BASELINE = '316c8ff95f7a12618ec8db61342d153f3cbb29ea';
const PREFIX = '/__hall_library_baseline__/';
const output = process.env.WORLD_HALL_LIBRARY_QA_OUTPUT || 'test-results/hall-library-candidate';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const run = promisify(execFile);
const began = Date.now();
await mkdir(output, {recursive:true});
const reportPath = path.join(output,'report.json');
const report = {
  status:'RUNNING', startedAt:new Date().toISOString(), baselineCommit:BASELINE,
  scope:'Literal #108 baseline, local existing selector, and candidate exterior. No interior or actual floor-count claim.',
  approximation:'Main Hall retains illustrative four-row/nine-pier estimates; Jeongseok reuses the #108 exterior.',
  knownSourceIntersections:{count:4, color:'#eeece2', detailQuads:[512,532], nearQuads:[5,8,11,14],
    facadeDepth:-.23, yRange:[.845,.9], eachArea:.06*.055,
    note:'Existing same-color cross-tier sill/entrance-mullion intersections are preserved, not proof of zero coplanar overlap.'},
  limits:{operationMs:12000,pixelFrameMs:6000,overallMs:280000,cleanupMs:8000},
  baselineFiles:[], requests:{unexpectedRequests:[],api:[],offOrigin:[]}, cases:[], closeups:[], screenshots:[], progress:[]
};
const flush = () => writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const progress = async label => {
  const item={at:new Date().toISOString(),elapsedMs:Date.now()-began,label};
  report.progress.push(item); console.log(`[${item.at}] ${label}`); await flush();
};
async function withDeadline(label, operation, milliseconds=12000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label}: deadline ${milliseconds}ms exceeded`)),milliseconds);
  })]); } finally { clearTimeout(timer); }
}
// Last-resort process watchdog also bounds a stuck GPU/Playwright cleanup.
const watchdog=setTimeout(()=>{
  report.status='FAIL'; report.error='Overall hosted QA deadline exceeded';
  report.elapsedMs=Date.now()-began;
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n'); process.exit(1);
},280000);
let smoke, page, fatal;
const baselineCache=new Map();
async function sourceAtBaseline(relative) {
  if (!/^(src\/[A-Za-z0-9_./-]+\.js|data\/reality\/[A-Za-z0-9_./-]+\.json)$/.test(relative)
    || relative.split('/').some(part=>part==='.'||part==='..')) throw new Error('Unscoped baseline path');
  if (!baselineCache.has(relative)) {
    const {stdout}=await run('git',['show',`${BASELINE}:apps/world/${relative}`],{cwd:repo,timeout:5000,maxBuffer:10*1024*1024,encoding:'buffer'});
    baselineCache.set(relative,stdout);
    report.baselineFiles.push({path:`apps/world/${relative}`,sha256:createHash('sha256').update(stdout).digest('hex')});
  }
  return baselineCache.get(relative);
}
const checkPixels = pixels => {
  assert.equal(pixels.glError,0,'no GL error'); assert.equal(pixels.contextLost,false);
  assert.ok(pixels.foreground>100,'actual building pixels are present');
};
const checkStats = stats => {
  assert.equal(stats.device,'webgl2'); assert.equal(stats.activePresentations,1,'only one visible presentation');
  assert.equal(stats.scaleSign,stats.reflected?-1:1);
  assert.equal(stats.canvas.width,stats.canvas.cssWidth); assert.equal(stats.canvas.height,stats.canvas.cssHeight);
  assert.equal(stats.owners.length,3);
  for (const owner of stats.owners) {
    assert.equal(owner.owners,1,`${owner.tier}: exactly one owner`);
    assert.equal(owner.finite,true,`${owner.tier}: finite vertices and bounds`);
    if (owner.tier==='BASE') assert.ok(owner.meshes>0 && owner.vertices>0);
    // Jeongseok NEAR is legitimately empty; never require every tier to draw.
  }
};
const checkFrame = frame => {
  assert.ok(frame.points>0 && frame.minDepth>0);
  assert.ok(frame.minX>=.06 && frame.maxX<=.94 && frame.minY>=.06 && frame.maxY<=.94,JSON.stringify(frame));
  assert.equal(frame.captionOverlapsCanvas,false);
};
try {
  const {stdout:head}=await run('git',['rev-parse','HEAD'],{cwd:repo,timeout:5000,encoding:'utf8'});
  report.candidateCommit=head.trim(); assert.match(report.candidateCommit,/^[0-9a-f]{40}$/);
  if (process.env.GITHUB_RUN_ID) report.githubRunId=process.env.GITHUB_RUN_ID;
  await progress('Validate pinned baseline and start offline real-engine browser');
  await sourceAtBaseline('src/main-hall-blockout.js');
  smoke=await withDeadline('browser startup',()=>startSmoke({viewport:{width:1280,height:720},contextOptions:{deviceScaleFactor:1}}),30000);
  const html=await readFile(new URL('./hall-library-hosted-harness.html',import.meta.url),'utf8');
  const engineUrl=html.match(/"playcanvas":"([^"]+)"/)[1];
  smoke.context.on('request',request=>{
    const url=new URL(request.url());
    if (url.origin===smoke.origin && url.pathname.startsWith('/api/')) report.requests.api.push(url.pathname);
    if (url.origin!==smoke.origin && url.href!==engineUrl) report.requests.offOrigin.push(url.origin+url.pathname);
    if ((url.origin===smoke.origin && url.pathname.startsWith('/api/')) || (url.origin!==smoke.origin && url.href!==engineUrl)) report.requests.unexpectedRequests.push(url.origin+url.pathname);
  });
  await smoke.context.route(`**${PREFIX}**`,async route=>{
    try {
      const url=new URL(route.request().url());
      assert.equal(url.origin,smoke.origin);
      const relative=url.pathname.slice(PREFIX.length);
      const body=await sourceAtBaseline(relative);
      await route.fulfill({status:200,contentType:relative.endsWith('.json')?'application/json':'text/javascript; charset=utf-8',body});
    } catch(error) {
      report.requests.unexpectedRequests.push(`baseline route: ${String(error.message)}`);
      await route.abort('failed');
    }
  });
  page=await smoke.context.newPage(); fatal=smoke.watch(page);
  const evaluate = (label, fn, args) => withDeadline(label,()=>Promise.race([page.evaluate(fn,args),fatal]));
  const capture = () => evaluate('actual framebuffer read',()=>window.__HALL_LIBRARY_HOSTED_QA__.pixels());
  const view = options => evaluate('select presentation',options=>window.__HALL_LIBRARY_HOSTED_QA__.view(options),options);
  const shot = async name => {
    await withDeadline('screenshot '+name,()=>page.screenshot({path:path.join(output,name+'.png'),timeout:10000}));
    report.screenshots.push(name+'.png');
  };
  await withDeadline('fixture navigation',()=>Promise.race([page.goto(`${smoke.origin}/tests/browser/hall-library-hosted-harness.html`,{waitUntil:'domcontentloaded',timeout:20000}),fatal]),22000);
  await withDeadline('fixture readiness',()=>Promise.race([page.waitForFunction(()=>window.__HALL_LIBRARY_HOSTED_QA__?.ready||window.__HALL_LIBRARY_HOSTED_QA__?.error,null,{timeout:20000}),fatal]),22000);
  assert.equal(await evaluate('fixture error',()=>window.__HALL_LIBRARY_HOSTED_QA__.error),undefined);
  for (const [name,viewport] of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]) {
    await withDeadline('viewport resize',()=>page.setViewportSize(viewport));
    for (const id of ['bldg_01','bldg_jungseok']) for (const reflected of [true,false]) {
      const cell={name,viewport,id,reflected,status:'RUNNING'}; report.cases.push(cell);
      await progress(`${name} ${id} ${reflected?'reflected':'control'}: baseline / existing / candidate`);
      for (const presentation of ['baseline108','existing','candidate']) {
        const stats=await view({id,presentation,reflected,detail:'all',mode:'full'}); checkStats(stats);
        const pixels=await capture(); checkPixels(pixels); cell[presentation]={stats,pixels};
        assert.equal(pixels.width,viewport.width,'drawing buffer follows each viewport');
        assert.equal(pixels.width,stats.canvas.cssWidth); assert.equal(pixels.height,stats.canvas.cssHeight);
        assert.equal(pixels.width<pixels.height,name==='portrait','actual framebuffer orientation');
        assert.ok(pixels.height>viewport.height*.65 && pixels.height<viewport.height,'caption remains outside canvas');
        if (presentation==='existing') {
          assert.equal(pixels.exactChanged,0,'local existing renderer matches literal #108 pixels');
          assert.equal(pixels.hash,cell.baseline108.pixels.hash);
        }
        if (presentation==='candidate') {
          if (id==='bldg_jungseok') { assert.equal(pixels.exactChanged,0,'Jeongseok exact #108 parity'); assert.equal(pixels.hash,cell.baseline108.pixels.hash); }
          else assert.ok(pixels.changed>10,'Main Hall candidate changes actual pixels');
        }
        // 8 matrix images: desktop true baseline/candidate for both; mobile candidate both.
        if (reflected && ((name==='desktop' && presentation!=='existing') || (name!=='desktop' && presentation==='candidate'))) await shot(`${name}-${id}-${presentation}-reflected`);
      }
      cell.framing=await evaluate('full silhouette framing',()=>window.__HALL_LIBRARY_HOSTED_QA__.framing()); checkFrame(cell.framing);
      cell.stable=await capture(); checkPixels(cell.stable);
      assert.equal(cell.stable.exactChanged,0,'stationary exact pixels'); assert.equal(cell.stable.hash,cell.candidate.pixels.hash);
      if (name==='desktop' && reflected) {
        cell.lifecycle=await evaluate('detach, remount, destroy, rebuild',()=>window.__HALL_LIBRARY_HOSTED_QA__.lifecycle()); checkStats(cell.lifecycle.stats);
        for (const r of cell.lifecycle.receipt) { for (const key of ['repeated','detached','remounted','rebuilt']) assert.equal(r[key],true,`${r.tier} ${key}`); assert.equal(r.meshesBefore,r.meshesAfter); }
        cell.rebuilt=await capture(); checkPixels(cell.rebuilt); assert.equal(cell.rebuilt.exactChanged,0,'lifecycle rebuild preserves pixels');
        const baseStats=await view({detail:'base'}); checkStats(baseStats); cell.baseOnly=await capture(); checkPixels(cell.baseOnly);
        assert.ok(cell.baseOnly.changed>10,'detail visibility actually changes pixels');
        await view({detail:'all'}); cell.reattached=await capture(); checkPixels(cell.reattached); assert.equal(cell.reattached.hash,cell.candidate.pixels.hash,'tier re-enable restores pixels');
      }
      cell.status='PASS'; await flush();
      assert.deepEqual(smoke.problems,[]); assert.deepEqual(report.requests.unexpectedRequests,[]);
    }
  }
  // Two additional Main Hall entrance closeups show the four known source intersections.
  await withDeadline('closeup viewport',()=>page.setViewportSize({width:1280,height:720}));
  for (const presentation of ['baseline108','candidate']) {
    await progress(`Main Hall entrance oblique closeup: ${presentation}`);
    checkStats(await view({id:'bldg_01',presentation,reflected:true,detail:'all',mode:'entry'}));
    const pixels=await capture(), stable=await capture(); checkPixels(pixels); checkPixels(stable);
    assert.equal(stable.exactChanged,0); assert.equal(stable.hash,pixels.hash);
    report.closeups.push({id:'bldg_01',presentation,mode:'entry',scope:'Entrance crop, not full-building framing',pixels,stable});
    await shot(`desktop-bldg_01-${presentation}-entrance-oblique`); await flush();
  }
  assert.deepEqual(smoke.problems,[]); assert.deepEqual(report.requests.unexpectedRequests,[]);
  assert.equal(report.cases.length,12); assert.equal(report.screenshots.length,10);
  report.status='PASS'; await progress('12 matrix cells and 10 screenshots complete');
} catch(error) {
  report.status='FAIL'; report.error=String(error.stack||error); process.exitCode=1;
  console.error(report.error);
} finally {
  report.problems=smoke?.problems || []; report.finishedAt=new Date().toISOString(); report.elapsedMs=Date.now()-began;
  await flush();
  try { if(smoke) await withDeadline('browser cleanup',()=>smoke.close(),8000); }
  catch(error) { report.status='FAIL'; report.cleanupError=String(error); process.exitCode=1; }
  await flush(); clearTimeout(watchdog);
  // startSmoke can fail after spawning its server but before returning handles.
  // A failed run must still exit after persisting evidence, even with orphan pipes.
  if (report.status!=='PASS') setTimeout(()=>process.exit(1),1000);
}
