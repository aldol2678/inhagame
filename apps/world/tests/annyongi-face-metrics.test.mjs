import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeFaceMasks,faceContrastFailures,FACE_LINE_NAMES} from './browser/annyongi-face-metrics.mjs';
const line=new Uint8Array(401).fill(1);
test('one-pixel bridge loss fails even above 99 percent coverage',()=>{const dark=line.slice();dark[200]=0;const r=analyzeFaceMasks(line,line,dark,401,1);assert.ok(r.darkFraction>.99);assert.equal(r.brokenMeasuredComponents,1);});
test('an endpoint AA pixel does not invent a split',()=>{const dark=line.slice();dark[0]=0;const r=analyzeFaceMasks(line,line,dark,401,1);assert.equal(r.brokenMeasuredComponents,0);assert.equal(r.missing.largest,1);});
test('unmeasured dark-background pixels remain explicitly excluded',()=>{const measured=line.slice();measured.fill(0,0,81);const r=analyzeFaceMasks(line,measured,measured,401,1);assert.equal(r.measurement,'PARTIAL');assert.equal(r.excluded.largest,81);assert.ok(r.measuredFraction<.8);});
test('zero visible pixels are not a quality pass',()=>{const z=new Uint8Array(3);assert.equal(analyzeFaceMasks(z,z,z,3,1).measurement,'OCCLUDED_OR_SUBPIXEL');});
function fixture(){const connectivity=analyzeFaceMasks(line,line,line,401,1);return Object.fromEntries(FACE_LINE_NAMES.map(name=>['node:'+name,{contrast:{fixed:{samples:401,darkFraction:1,medianInkToSkin:.15,connectivity},white:{samples:401,darkFraction:0,medianInkToSkin:1}}}]));}
test('authored dark line and white negative meet the contrast contract',()=>assert.deepEqual(faceContrastFailures(fixture()),[]));
test('two identical white renders cannot pass',()=>{const x=fixture();x['node:'+FACE_LINE_NAMES[0]].contrast.fixed.darkFraction=0;x['node:'+FACE_LINE_NAMES[0]].contrast.fixed.medianInkToSkin=1;assert.ok(faceContrastFailures(x).length);});
test('high aggregate coverage cannot hide bridge loss',()=>{const x=fixture(),dark=line.slice();dark[200]=0;x['node:'+FACE_LINE_NAMES[0]].contrast.fixed.connectivity=analyzeFaceMasks(line,line,dark,401,1);assert.match(faceContrastFailures(x).join(),/fragmented/);});

test('missing required line is fail-closed',()=>assert.ok(faceContrastFailures({}).length));

test('excluded one-pixel bridge is unresolved even with 99 percent measured coverage',()=>{const measured=line.slice();measured[200]=0;const r=analyzeFaceMasks(line,measured,measured,401,1);assert.ok(r.measuredFraction>.99);assert.equal(r.unresolvedVisibleComponents,1);const x=fixture();x['node:'+FACE_LINE_NAMES[0]].contrast.fixed.connectivity=r;assert.match(faceContrastFailures(x).join(),/excluded pixels interrupt/);});
test('empty and non-finite old controls fail closed',()=>{for(const value of [null,NaN,Infinity]){const x=fixture();x['node:'+FACE_LINE_NAMES[0]].contrast.white.darkFraction=value;assert.ok(faceContrastFailures(x).length);}});
