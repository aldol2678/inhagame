import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const helperUrl = new URL('./browser/life-props-browser-helpers.mjs', import.meta.url);
const helpers = async () => { assert.ok(existsSync(helperUrl), 'life prop browser evidence helpers must exist'); return import(helperUrl); };

test('diagnostic camera fits actual asymmetric mesh corners in every requested viewport', async () => {
  const { fitDiagnosticPoints, LIFE_VIEWPORTS } = await helpers();
  assert.deepEqual(LIFE_VIEWPORTS.map(v => [v.width, v.height]), [[1280,800],[390,844],[844,390]]);
  const points = [-.8,.42].flatMap(x => [.11,.93].flatMap(y => [-.35,.2].map(z => [x,y,z])));
  for (const viewport of LIFE_VIEWPORTS) {
    const fit = fitDiagnosticPoints(points, { aspect: viewport.width / viewport.height, direction: [-1,.35,-2] });
    for (const point of points) {
      const delta = point.map((n,i) => n - fit.position[i]);
      const dot = vector => delta.reduce((n,x,i) => n + x * vector[i], 0);
      const depth = -dot(fit.back);
      assert.ok(depth > .001);
      assert.ok(Math.abs(dot(fit.right) / depth / fit.tan / fit.aspect) <= .800001);
      assert.ok(Math.abs(dot(fit.up) / depth / fit.tan) <= .800001);
    }
  }
});

test('camera rejects empty/nonfinite bounds rather than providing fake fit evidence', async () => {
  const { fitDiagnosticPoints } = await helpers();
  for (const points of [[], [[NaN,0,0]], [[1,2]]]) assert.throws(() => fitDiagnosticPoints(points, {aspect:1}));
  assert.throws(() => fitDiagnosticPoints([[0,0,0]], {aspect:0}));
});

test('framebuffer differences use GL bottom-up rows and a scoped model ROI', async () => {
  const { framebufferEvidence } = await helpers();
  const prior = new Uint8Array(4 * 4 * 4), pixels = prior.slice();
  pixels.set([250,140,80,255], (3 * 4 + 1) * 4); // top row, x=1
  pixels.set([250,140,80,255], (0 * 4 + 3) * 4); // bottom row, x=3
  const got = framebufferEvidence(pixels, 4, 4, { previous:prior, roi:{minX:0,maxX:2,minY:0,maxY:1}, clearRgb:[0,0,0] });
  assert.equal(got.changed,2); assert.equal(got.roiChanged,1); assert.equal(got.foreground,2);
  assert.notEqual(got.hash,framebufferEvidence(prior,4,4,{clearRgb:[0,0,0]}).hash);
});

test('framebuffer evidence refuses mismatched dimensions and invalid regions', async () => {
  const { framebufferEvidence } = await helpers();
  assert.throws(() => framebufferEvidence(new Uint8Array(4),4,4));
  assert.throws(() => framebufferEvidence(new Uint8Array(64),4,4,{roi:{minX:2,maxX:1,minY:0,maxY:1}}));
});

test('fixture request boundary permits only pinned engine and local read-only static data', async () => {
  const { allowedFixtureRequest, ENGINE_URL } = await helpers();
  const origin='http://127.0.0.1:1234';
  for (const file of ['/tests/browser/life-props-browser-harness.html','/tests/browser/life-props-browser-fixture.mjs',
    '/npc-factory/dev-human-avatar.mjs','/src/rooms/club-room-renderer.js','/assets/life-props-v1/open_book.glb']) {
    assert.equal(allowedFixtureRequest(origin+file,'GET',origin),true,file);
    assert.equal(allowedFixtureRequest(origin+file,'POST',origin),false,file);
  }
  assert.equal(allowedFixtureRequest(ENGINE_URL,'GET',origin),true);
  for (const url of [origin+'/api/world-time',origin+'/api/hub-event',origin+'/campus/',origin+'/assets/unapproved.glb',
    'https://example.com/src/x.js', ENGINE_URL+'?other=1']) assert.equal(allowedFixtureRequest(url,'GET',origin),false,url);
});

test('required reality-adapter campus-landmarks read is allowed without opening data/API/write/query access', async () => {
  const { allowedFixtureRequest } = await helpers();
  const origin='http://127.0.0.1:1234',required='/data/reality/campus-landmarks.json';
  assert.equal(allowedFixtureRequest(origin+required,'GET',origin),true,'actual room renderer dependency must load');
  for(const method of ['POST','PUT','PATCH','DELETE']) assert.equal(allowedFixtureRequest(origin+required,method,origin),false,method);
  for(const url of [origin+required+'?v=1',origin+'/data/reality/other.json',origin+required+'/extra',
    origin+'/api/world-time',origin+'/api/hub-event','https://example.com'+required]) {
    assert.equal(allowedFixtureRequest(url,'GET',origin),false,url);
  }
});

const contactUrl=new URL('./browser/life-props-browser-contact.mjs',import.meta.url);
const contactHelpers=async()=>{assert.ok(existsSync(contactUrl),'triangle contact geometry must exist');return import(contactUrl);};

test('hand clearance detects a penetrating triangle even when all triangle vertices are outside the hand',async()=>{
  const { closestTrianglePointToOrigin }=await contactHelpers();
  const point=closestTrianglePointToOrigin([-2,-2,0],[2,-2,0],[0,2,0]);
  assert.ok(Math.hypot(...point)<1e-10,'surface crosses the hand center');
});

test('triangle closest point distinguishes tangential contact, a floating prop, and degenerate edges',async()=>{
  const { closestTrianglePointToOrigin }=await contactHelpers();
  for(const y of [.5,.8]){
    const point=closestTrianglePointToOrigin([-1,y,-1],[1,y,-1],[0,y,1]);
    assert.ok(Math.abs(Math.hypot(...point)-y)<1e-10);
  }
  assert.deepEqual(closestTrianglePointToOrigin([1,0,0],[1,0,0],[1,0,0]),[1,0,0]);
});

test('contact gate rejects both penetration and floating gaps instead of validating a root coordinate',async()=>{
  const { contactAcceptable }=await contactHelpers();
  assert.equal(contactAcceptable({minimumEnvelopeClearance:-.01,penetrationDepthWorld:.02,contactGapWorld:.001}),false);
  assert.equal(contactAcceptable({minimumEnvelopeClearance:-.01,penetrationDepthWorld:0,contactGapWorld:.02}),false);
  assert.equal(contactAcceptable({minimumEnvelopeClearance:-.01,penetrationDepthWorld:0,contactGapWorld:.001}),true);
  assert.equal(contactAcceptable({minimumEnvelopeClearance:-.01,penetrationDepthWorld:NaN,contactGapWorld:.001}),false);
});


test('measured triangle contact rejects an outside but detached prop as well as a hand-crossing prop',async()=>{
  const { measureHandContact }=await contactHelpers();
  const x=[.5,0,0],nx=[-.5,0,0],y=[0,.5,0],ny=[0,-.5,0],z=[0,0,.5],nz=[0,0,-.5];
  const handTriangles=[[y,x,z],[y,z,nx],[y,nx,nz],[y,nz,x],[ny,z,x],[ny,nx,z],[ny,nz,nx],[ny,x,nz]];
  const measure=height=>measureHandContact({handTriangles,handWorldScale:[.05,.05,.05],propTriangles:[[[-1,height,-1],[1,height,-1],[0,height,1]]]});
  const touch=measure(.5),detached=measure(.8),crossing=measure(0);
  assert.equal(touch.acceptable,true);assert.equal(touch.contactGapWorld,0);
  assert.equal(detached.penetrationDepthWorld,0);assert.ok(detached.contactGapWorld>.0149);assert.equal(detached.acceptable,false);
  assert.ok(crossing.penetrationDepthWorld>.0249);assert.equal(crossing.acceptable,false);
});

test('continuous triangle-to-capsule-axis distance catches wrist crossings and tangent faces',async()=>{
  const { closestTrianglePointToSegment }=await contactHelpers();
  assert.equal(typeof closestTrianglePointToSegment,'function');
  const start=[0,-.5,0],end=[0,.5,0];
  const cross=closestTrianglePointToSegment([-2,0,-2],[2,0,-2],[0,0,2],start,end);
  assert.ok(cross.distance<1e-10);
  const tangent=closestTrianglePointToSegment([.5,-2,-2],[.5,2,-2],[.5,0,2],start,end);
  assert.ok(Math.abs(tangent.distance-.5)<1e-10);
  const tip=closestTrianglePointToSegment([-2,1,-2],[2,1,-2],[0,1,2],start,end);
  assert.ok(Math.abs(tip.distance-.5)<1e-10);
});

test('forearm gate rejects a small wrist overlap even when the separate hand could be clear',async()=>{
  const { measureCapsuleClearance }=await contactHelpers();
  assert.equal(typeof measureCapsuleClearance,'function');
  const x=[.5,0,0],nx=[-.5,0,0],y=[0,1,0],ny=[0,-1,0],z=[0,0,.5],nz=[0,0,-.5];
  const bodyTriangles=[[y,x,z],[y,z,nx],[y,nx,nz],[y,nz,x],[ny,z,x],[ny,nx,z],[ny,nz,nx],[ny,x,nz]];
  const measure=x=>measureCapsuleClearance({bodyTriangles,bodyWorldScale:[.1,.1,.1],propTriangles:[[[x,-1,-1],[x,1,-1],[x,0,1]]]});
  assert.equal(measure(.48).acceptable,false);
  assert.equal(measure(.5).acceptable,true);
});
