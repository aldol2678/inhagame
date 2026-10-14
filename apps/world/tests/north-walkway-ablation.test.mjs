import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./browser/north-walkway-ablation.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../../.github/workflows/north-walkway-browser.yml',import.meta.url),'utf8');
const compare=readFileSync(new URL('./browser/north-walkway-compare.mjs',import.meta.url),'utf8');
test('ablation is exact-head two-camera diagnostic with bracketed full controls',()=>{
 assert.match(source,/assert\.equal\(head,process\.env\.EXPECTED_WALKWAY_HEAD\)/);
 assert.match(source,/assert\.equal\(measured\.head,head\)/);
 assert.match(source,/\['CAM-B','CAM-C'\]/);
 assert.match(source,/\['full','no_paving','full','no_seams','full','no_props','full'\]/);
 assert.match(source,/i<60;i\+\+/);
 assert.match(source,/changedPixels===0/);
 assert.match(source,/DIAGNOSTIC_ONLY/);
 assert.doesNotMatch(source,/PASS_SURROGATE_ONLY/);
});
test('triangle selection rejects shared owners and preserves unrelated geometry',()=>{
 assert.match(source,/Shared mesh mutation forbidden/);
 assert.match(source,/Malformed source geometry/);
 assert.match(source,/verifySource\(r,g,true\)/);
 assert.match(source,/verifySource\(r,g,false\)/);
 assert.match(source,/color===C\.joint/);
 assert.match(source,/g\.positions\[index\*3\+1\]===G\.PAINT/);
 assert.match(source,/r\.primitive\.base=count/);
 assert.match(source,/r\.originalPrimitive\.count-count/);
 assert.match(source,/restored\.every\(\(value,i\)=>value===r\.indices\[i\]\)/);
 assert.match(source,/finally\{device\.draw=originalDraw;\}/);
 assert.match(source,/catch\(error\)\{reject\(error\);\}/);
});
test('existing admission gate precedes bounded supplemental diagnostics',()=>{
 const gate=workflow.indexOf('name: Performance regression gate');
 const parity=workflow.indexOf('name: Exact original-versus-batched paving pixel parity');
 const diagnostic=workflow.indexOf('name: Diagnostic-only portrait component ablation');
 const upload=workflow.indexOf('uses: actions/upload-artifact@v4');
 assert.ok(gate>0&&parity>gate&&diagnostic>parity&&upload>diagnostic);
 const step=workflow.slice(diagnostic,upload);
 assert.match(step,/timeout-minutes: 5/);
 assert.ok(step.includes('if: $'+'{{ !cancelled() }}'));
 assert.match(step,/EXPECTED_WALKWAY_HEAD:/);
 assert.match(step,/after\/report\.json test-results\/north-walkway\/ablation\/report\.json/);
 assert.doesNotMatch(workflow,/continue-on-error/);
});
test('exact completion values become visible without changing admission budgets',()=>{
 assert.match(compare,/p95Ratio:1\.15,p95SlackMs:2,drawCallDelta:16,triangleRatio:1\.05,vramRatio:1\.10,heapRatio:1\.15/);
 assert.match(compare,/completed-frame P95/);
 assert.match(compare,/failed-frame-distribution/);
 assert.match(compare,/if\(report\.status==='HOLD'\)process\.exitCode=1/);
});
