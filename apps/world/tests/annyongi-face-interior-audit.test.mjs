import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTriangles } from './browser/annyongi-face-interior-audit.mjs';

// Synthetic data only. The feature's original vertices are in front of the
// head, but its interior crosses the head's convex center peak.
const a=[-1,-1,0],b=[1,-1,0],c=[1,1,0],d=[-1,1,0],peak=[0,0,.1];
const head=[[a,b,peak],[b,c,peak],[c,d,peak],[d,a,peak]];
const feature=[[[-1,-1,.05],[1,-1,.05],[0,1,.05]]];

test('detects triangle interior penetration even with clear original vertices',()=>{
  const result=auditTriangles(head,feature);
  assert.equal(result.interiorOnlyPenetratingTriangles,1);
  assert.equal(result.penetratingFeatureTriangles,1);
  assert.ok(Math.abs(result.minSeparation+.05)<1e-8);
  assert.ok(Math.abs(result.maxSeparation-.05)<1e-8);
});

test('separated feature does not produce a penetration',()=>{
  const result=auditTriangles(head,feature.map(t=>t.map(p=>[p[0],p[1],p[2]+.2])));
  assert.equal(result.penetratingPairs,0);
  assert.equal(result.interiorOnlyPenetratingTriangles,0);
  assert.ok(result.minSeparation>.14);
});

test('head winding reversal leaves the geometric result unchanged',()=>{
  const baseline=auditTriangles(head,feature);
  const result=auditTriangles(head.map(t=>[...t].reverse()),feature);
  assert.equal(result.interiorOnlyPenetratingTriangles,1);
  assert.equal(result.penetratingFeatureTriangles,baseline.penetratingFeatureTriangles);
  assert.ok(Math.abs(result.minSeparation-baseline.minSeparation)<1e-8);
});

test('nonoverlapping projections return no overlap and null separation',()=>{
  const result=auditTriangles(head,[[[4,4,0],[5,4,0],[4,5,0]]]);
  assert.equal(result.overlapPairs,0);
  assert.equal(result.penetratingPairs,0);
  assert.equal(result.minSeparation,null);
  assert.equal(result.maxSeparation,null);
});

test('back-head triangles are excluded by frontmost-height witnesses',()=>{
  const baseline=auditTriangles(head,feature);
  const back=head.map(t=>t.map(p=>[p[0],p[1],p[2]-1]));
  const result=auditTriangles([...head,...back],feature);
  assert.equal(result.minSeparation,baseline.minSeparation);
  assert.equal(result.maxSeparation,baseline.maxSeparation);
  assert.equal(result.overlapPairs,baseline.overlapPairs);
  assert.equal(result.penetratingPairs,baseline.penetratingPairs);
});
