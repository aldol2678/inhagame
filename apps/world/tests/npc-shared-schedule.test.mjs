import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedScheduleController } from '../npc-factory/npc-shared-schedule.mjs';
import { createNpcWorldClock } from '../npc-factory/npc-world-clock.mjs';
import { worldTimePayload, worldScheduleAt, NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../npc-factory/npc-world-time-contract.mjs';
import handler from '../api/world-time.js';

const navigator = { route: (a, b) => [{ x: b.x, z: a.z }, b] };
function fixture(now, options = {}) {
  const destinations = Object.fromEntries([0,1,2,3,4].map(i => ['d'+i, { position: { x: i*10, z: i*10 } }]));
  const schedule = [0,1,2,3,4].map(i => ({ destination: 'd'+i, need: 'CLASS', goal: 'ATTEND', activity: 'READING' }));
  return createSharedScheduleController({ id: 'test', schedule, destinations, navigator, speed: 1, now, ...options });
}
test('late join and reload sample the same path without replaying frames', () => {
  let t = E + P + 15_000;
  const a = fixture(() => t), b = fixture(() => t);
  assert.deepEqual(a.status(), b.status());
  assert.deepEqual(a.status().position, { x: 10, z: 5 });
  a.tick(.001); a.pause(); a.setScheduleIndex(4); a.beginDetour({});
  assert.deepEqual(a.status(), b.status(), 'local commands cannot change shared motion');
  t += 3000;
  assert.deepEqual(fixture(() => t).status(), a.status(), 'reload rejoins current leg');
  assert.deepEqual(a.status().position, { x: 10, z: 8 });
});
test('different frame rates, tab suspension and full-cycle wrap do not accumulate drift', () => {
  let t = E + P;
  const a = fixture(() => t), b = fixture(() => t);
  for (let i=0;i<120;i++) { t += 10; a.tick(.01); }
  assert.deepEqual(a.status(), b.tick(1.2));
  t = E + 5*P + 10_000;
  assert.equal(a.status().scheduleIndex, 0);
  assert.deepEqual(a.status(), fixture(() => t).status());
  assert.deepEqual(a.status().position, { x: 30, z: 40 });
  t = E + 5*P + 80_000;
  assert.equal(a.status().phase, 'ACTING');
  assert.deepEqual(a.status().position, { x: 0, z: 0 });
});
test('period and arrival boundaries are exact', () => {
  const a = fixture(() => E + P + 20_000);
  assert.equal(a.sample(E+P+19_999).moving, true);
  assert.equal(a.status().moving, false);
  assert.equal(a.status().activity, 'READING');
  assert.equal(worldScheduleAt(E+P-1).index, 0);
  assert.equal(worldScheduleAt(E+P).index, 1);
  assert.equal(a.sample(E+2*P).scheduleIndex, 2);
});
test('sink visibility and remote residence preserve explicit transfers', () => {
  const schedule = [0,1,2,3,4].map(i=>({ destination:'d'+i, activity:'WAITING', sink:i===1, remote:i===3 }));
  const a=fixture(()=>E+P,{schedule});
  assert.equal(a.sample(E+P+10_000).visible,true);
  assert.equal(a.sample(E+P+20_000).visible,false);
  assert.equal(a.sample(E+2*P).visible,true);
  assert.deepEqual(a.sample(E+3*P).position,{x:30,z:30});
  assert.deepEqual(a.sample(E+4*P).position,{x:40,z:40});
  assert.equal(a.sample(E+3*P).moving,false);
});
test('invalid routes fail explicitly; absent server time never becomes a private morning', () => {
  assert.throws(()=>fixture(()=>E,{navigator:{route:()=>null}}).status(),/unavailable/);
  assert.throws(()=>fixture(()=>E,{speed:.0001}).status(),/exceeds/);
  assert.equal(fixture(()=>null).status().visible,false);
  assert.equal(fixture(()=>null).status().phase,'SYNCING');
});
test('server anchor includes half RTT and ignores local wall-clock skew', async () => {
  let local=100;
  const clock=createNpcWorldClock({monotonicNow:()=>local, fetcher:async()=>{
    local+=100;return {ok:true,json:async()=>worldTimePayload(E+P)};
  }});
  await clock.sync();
  assert.equal(clock.now(),E+P+50);
  local+=1000;
  assert.equal(clock.now(),E+P+1050);
  assert.equal(clock.status().rttMs,100);
  clock.dispose(); assert.equal(clock.now(),null);
});
test('failure holds over briefly then hides; reconnection restores shared time', async () => {
  let local=0, fail=true;
  const clock=createNpcWorldClock({monotonicNow:()=>local,fetcher:async()=>{
    if(fail) throw new Error('offline');
    return {ok:true,json:async()=>worldTimePayload(E+local)};
  }});
  await clock.sync();assert.equal(clock.now(),null);
  fail=false;await clock.sync();assert.equal(clock.now(),E);
  local=60_000;fail=true;await clock.sync();assert.equal(clock.status().state,'HOLDOVER');
  local=120_001;assert.equal(clock.now(),null);
  fail=false;await clock.sync();assert.equal(clock.now(),E+120_001);
});
test('incompatible revision, high RTT and HTTP errors are rejected', async () => {
  for(const kind of ['revision','rtt','http']){
    let local=0;
    const clock=createNpcWorldClock({monotonicNow:()=>local,fetcher:async()=>{
      if(kind==='rtt')local=2500;
      return {ok:kind!=='http',json:async()=>({...worldTimePayload(E),
        ...(kind==='revision'?{revision:'old'}:{})})};
    }});
    await clock.sync(); assert.equal(clock.now(),null,kind);
  }
});
test('refresh deduplicates in-flight requests and clock never reverses', async () => {
  let local=0, server=E+1000, calls=0;
  const clock=createNpcWorldClock({monotonicNow:()=>local,fetcher:async()=>{
    calls++;return {ok:true,json:async()=>worldTimePayload(server)};
  }});
  await Promise.all([clock.sync(),clock.sync()]); assert.equal(calls,1);
  assert.equal(clock.now(),E+1000);
  server=E+950;await clock.sync();assert.equal(clock.now(),E+1000);
  local+=100;assert.equal(clock.now(),E+1050);
});
test('server endpoint is read-only, non-cacheable and carries the same time contract', async () => {
  function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},
    status(v){this.code=v;return this;},json(v){this.body=v;return this;},end(){return this;}};}
  const res=response();await handler({method:'GET'},res);
  assert.equal(res.code,200);assert.equal(res.body.periodMs,P);
  assert.equal(res.headers['Vercel-CDN-Cache-Control'],'no-store');
  assert.ok(Math.abs(res.body.serverNowMs-Date.now())<1000);
  const rejected=response();await handler({method:'POST'},rejected);assert.equal(rejected.code,405);
});
