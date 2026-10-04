// Hosted-only, read-only runtime control for the terrain diagnostic repair.
// The immutable main tree runs its ORIGINAL script first, then only the repaired
// QA script is substituted. No source, data, lockfile or harness is substituted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE='8416e387973058dc4e10adf70192839929c9eb89';
export const ORIGINAL_SCRIPT_SHA256='b981a0ece49ba0d1d2a5ef3ce0b2d808cd047d36c32376029595465bd37fb369';
const SCRIPT='apps/world/tests/browser/campus-terrain-smoke.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertHosted(env){
  assert.ok(env.GITHUB_ACTIONS==='true'&&env.RUNNER_ENVIRONMENT==='github-hosted','terrain baseline control requires a GitHub-hosted runner');
}
function checkFrame(frame){
  assert.ok(Number.isInteger(frame?.width)&&frame.width>0&&Number.isInteger(frame.height)&&frame.height>0,'valid framebuffer dimensions');
  assert.equal(frame.glError,0,'clean WebGL readback');
  assert.equal(frame.readbackFramebuffer,'resolved-default');
  for(const field of ['blue','changed','changedSky'])assert.ok(Number.isInteger(frame[field])&&frame[field]>=0&&frame[field]<=frame.width*frame.height,field);
}
function checkPair(before,after){
  checkFrame(before);checkFrame(after);
  assert.equal(before.width,after.width);assert.equal(before.height,after.height);
}
export function verifyOriginalFailure(report,command){
  assert.equal(command.status,1,'original script must fail normally, not time out or crash');
  assert.equal(command.signal,null);
  assert.equal(report.cases?.length,1,'original script must stop at the known first portrait assertion');
  const entry=report.cases[0];
  assert.equal(entry.name,'portrait');assert.deepEqual(entry.viewport,{width:390,height:844});
  assert.equal(entry.result,'FAIL');assert.equal(entry.renderer,'WebGL2');assert.deepEqual(entry.problems,[]);
  checkPair(entry.before,entry.after);
  const threshold=entry.after.width*entry.after.height*.003;
  assert.ok(entry.after.changedSky<=threshold,'original blue-to-ground predicate must fail');
  assert.ok(entry.after.changed>threshold,'terrain must actually change pixels despite the failed blue predicate');
  const message=`AssertionError [ERR_ASSERTION]: portrait: missing visible sky-to-ground repair (${entry.after.changedSky} pixels)`;
  assert.equal(entry.error.split('\n')[0],message,'only the identified assertion failure is accepted');
  return {status:'EXPECTED_FAILURE',name:entry.name,changed:entry.after.changed,changedSky:entry.after.changedSky,requiredGreaterThan:threshold,error:message};
}
export function verifyRepairedReport(report,command){
  assert.equal(command.status,0);assert.equal(command.signal,null);assert.equal(report.result,'PASS');
  assert.deepEqual(report.cases?.map(entry=>entry.name),['portrait','landscape','desktop']);
  for(const entry of report.cases){
    assert.equal(entry.result,'PASS');assert.equal(entry.renderer,'WebGL2');
    assert.equal(entry.diagnosticBackground?.mode,'isolated-blue-background');
    assert.equal(entry.diagnosticBackground.productionSkyValidated,false);
    assert.equal(entry.diagnosticBackground.skyVisualsEnabled,false);
    assert.deepEqual(entry.diagnosticBackground.clearColor,[.52,.71,.84,1]);
    checkPair(entry.before,entry.after);
    assert.ok(entry.after.changedSky>entry.after.width*entry.after.height*.003);
    assert.ok(entry.after.blue<entry.before.blue);
    assert.deepEqual(entry.water?.map(w=>w.id),['lmk_inkyung_pond','central-pool']);
    for(const water of entry.water){
      checkPair(water.before,water.after);
      assert.equal(water.before.sampled.length,27);assert.equal(water.after.sampled.length,27);
      for(const value of water.after.sampled)assert.ok(Number.isInteger(value)&&value>=0&&value<=255);
      assert.deepEqual(water.after.sampled,water.before.sampled,'unchanged projected 3x3 water-hole pixels');
    }
    if(entry.name==='desktop'){
      assert.deepEqual(entry.oblique?.map(ray=>ray.id),['garden','sports']);
      for(const ray of entry.oblique){checkPair(ray.before,ray.after);assert.ok(ray.after.changedSky>10);}
    }
  }
  return {status:'PASS',viewports:report.cases.map(entry=>({name:entry.name,changedSky:entry.after.changedSky,waterSamples:entry.water.length,obliqueRays:entry.oblique?.length||0}))};
}
export function changedTrackedFiles(before,after){
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(file=>before[file]!==after[file]).sort();
}

function main(){
  assertHosted(process.env); // Never install dependencies or launch browsers locally.
  const repo=fileURLToPath(new URL('../../../../',import.meta.url));
  const output=path.resolve(process.env.WORLD_TERRAIN_CONTROL_OUTPUT||'test-results/campus-terrain/baseline-control');
  mkdirSync(output,{recursive:true});
  const report={status:'RUNNING',baselineCommit:BASELINE,startedAt:new Date().toISOString(),scope:'Immutable main runtime control; original failure followed by QA-only isolated-blue-background repair. This does not validate production sky.',limits:{overallMs:660000,commandTerminationGraceMs:15000},commands:[]};
  const reportPath=path.join(output,'control-report.json');
  const began=Date.now(),flush=()=>writeFileSync(reportPath,JSON.stringify({...report,elapsedMs:Date.now()-began},null,2)+'\n');
  function command(label,executable,args,{cwd=repo,seconds=30,env=process.env,allowFailure=false}={}){
    // GNU timeout owns the process group, including browser/server descendants.
    // A second parent timeout is a final bound if timeout itself stops responding.
    seconds=Math.min(seconds,Math.floor((report.limits.overallMs-(Date.now()-began))/1000));
    assert.ok(seconds>0,`${label}: terrain baseline control overall deadline exceeded`);
    const receipt={label,seconds,status:'RUNNING'};report.commands.push(receipt);flush();
    console.log(`terrain control: ${label}`);
    const result=spawnSync('timeout',['--signal=TERM','--kill-after=5s',`${seconds}s`,executable,...args],{
      cwd,env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:(seconds+15)*1000,killSignal:'SIGKILL'
    });
    Object.assign(receipt,{status:result.status,signal:result.signal,error:result.error?.message||null});
    writeFileSync(path.join(output,`${label}.log`),`${result.stdout||''}${result.stderr||''}`);flush();
    assert.equal(result.error,undefined,`${label}: process error`);
    if(!allowFailure)assert.equal(result.status,0,`${label}: see ${label}.log`);
    return result;
  }
  try{
    const head=command('candidate-head','git',['rev-parse','HEAD']).stdout.trim();
    report.candidateCommit=head;
    command('fetch-immutable-main','git',['fetch','--no-tags','--depth=1','origin',BASELINE],{seconds:90});
    const resolved=command('baseline-identity','git',['rev-parse',`${BASELINE}^{commit}`]).stdout.trim();
    assert.equal(resolved,BASELINE);
    report.baselineTree=command('baseline-tree','git',['rev-parse',`${BASELINE}^{tree}`]).stdout.trim();
    const temporary=mkdtempSync('/tmp/campus-terrain-control-'),tree=path.join(temporary,'tree');
    mkdirSync(tree);report.temporaryTree=tree;flush();
    command('archive-main','git',['archive','--format=tar',`--output=${path.join(temporary,'main.tar')}`,BASELINE]);
    command('extract-main','tar',['-xf',path.join(temporary,'main.tar'),'-C',tree]);
    const tracked=command('tracked-main-files','git',['ls-tree','-r','--name-only','-z',BASELINE]).stdout.split('\0').filter(Boolean);
    const snapshot=()=>Object.fromEntries(tracked.map(file=>[file,hash(readFileSync(path.join(tree,file)))]));
    const original=snapshot();
    report.originalScriptSha256=original[SCRIPT];assert.equal(original[SCRIPT],ORIGINAL_SCRIPT_SHA256,'immutable baseline must contain the exact inherited QA script');
    report.originalTrackedManifestSha256=hash(JSON.stringify(original));
    const env={...process.env,WORLD_SMOKE_DISABLE_WEBGPU:'1',WORLD_SMOKE_BROWSER:'chrome',WORLD_SMOKE_TIMEOUT_MS:'30000'};
    command('install-baseline-pins','npm',['ci','--ignore-scripts','--no-audit','--no-fund',`--cache=${path.join(temporary,'npm-cache')}`],{cwd:path.join(tree,'apps/world/tests/browser'),seconds:180,env});
    assert.deepEqual(changedTrackedFiles(original,snapshot()),[],'npm ci must leave every baseline tracked file unchanged');
    const originalOutput=path.join(output,'original');
    const originalCommand=command('original-baseline','node',[SCRIPT],{cwd:tree,seconds:180,env:{...env,WORLD_TERRAIN_QA_OUTPUT:originalOutput},allowFailure:true});
    report.original=verifyOriginalFailure(JSON.parse(readFileSync(path.join(originalOutput,'report.json'),'utf8')),originalCommand);flush();
    assert.deepEqual(changedTrackedFiles(original,snapshot()),[],'original run must leave every baseline tracked file unchanged');
    // Only this single QA file changes. The harness, dependencies and runtime
    // remain those archived from the immutable main commit throughout both runs.
    const repaired=readFileSync(path.join(repo,SCRIPT));
    assert.notEqual(hash(repaired),ORIGINAL_SCRIPT_SHA256,'repair must differ from the original script');
    writeFileSync(path.join(tree,SCRIPT),repaired);
    report.repairedScriptSha256=hash(repaired);
    assert.deepEqual(changedTrackedFiles(original,snapshot()),[SCRIPT]);
    const repairedOutput=path.join(output,'repaired');
    const repairedCommand=command('repaired-baseline','node',[SCRIPT],{cwd:tree,seconds:270,env:{...env,WORLD_TERRAIN_QA_OUTPUT:repairedOutput}});
    report.repaired=verifyRepairedReport(JSON.parse(readFileSync(path.join(repairedOutput,'report.json'),'utf8')),repairedCommand);
    report.changedTrackedFiles=changedTrackedFiles(original,snapshot());
    assert.deepEqual(report.changedTrackedFiles,[SCRIPT],'only the repaired QA script may differ from immutable main');
    report.runtimePreservation={status:'PASS',trackedFiles:tracked.length,qaFilesChanged:report.changedTrackedFiles};
    assert.equal(command('candidate-head-after','git',['rev-parse','HEAD']).stdout.trim(),head,'control must not move candidate HEAD');
    report.status='PASS';console.log('campus terrain immutable-main original failure / repaired diagnostic: PASS');
  }catch(error){report.status='FAIL';report.error=String(error.stack||error);throw error;}
  finally{flush();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
