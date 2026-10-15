import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {observeWorldTimeRequests} from './browser/world-time-request-evidence.mjs';

function fixture(fetch) {
  let now=0;
  const context=vm.createContext({fetch,URL,location:{origin:'http://127.0.0.1:1234',href:'http://127.0.0.1:1234/campus/'},
    performance:{now:()=>now}});
  vm.runInContext(`(${observeWorldTimeRequests.toString()})({origin:'http://127.0.0.1:1234'})`,context);
  return {context,setNow:value=>now=value,snapshot:()=>context.__WORLD_TIME_REQUEST_EVIDENCE__.snapshot()};
}
test('evidence preserves exact request options and response without consuming its body',async()=>{
  const response={status:200,json(){throw Error('observer must not read body');}};
  let received;
  const f=fixture(function(...args){received={args,owner:this};return Promise.resolve(response);});
  const options={cache:'no-store',signal:new AbortController().signal};
  const result=await f.context.fetch('/api/world-time',options);
  assert.equal(result,response);assert.equal(received.args[0],'/api/world-time');assert.equal(received.args[1],options);
  assert.equal(f.snapshot().events.map(x=>x.type).join(','),'start,headers');
});
test('signal abort before headers retains original rejection and elapsed evidence',async()=>{
  const controller=new AbortController(),error=new DOMException('timeout','AbortError');
  const f=fixture((_input,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(error))));
  const pending=f.context.fetch('/api/world-time',{signal:controller.signal});
  f.setNow(3000);controller.abort(error);
  await assert.rejects(pending,e=>e===error);
  const events=f.snapshot().events;
  assert.equal(events.map(x=>x.type).join(','),'start,signal-abort,fetch-reject');
  assert.equal(events[1].elapsedMs,3000);assert.equal(events[1].reasonName,'AbortError');
  assert.equal(events[2].signalAborted,true);
});
test('body-phase abort remains observable after headers; no success is fabricated',async()=>{
  const controller=new AbortController(),f=fixture(()=>Promise.resolve({status:200}));
  await f.context.fetch('/api/world-time',{signal:controller.signal});
  f.setNow(3000);controller.abort();
  assert.equal(f.snapshot().events.map(x=>x.type).join(','),'start,headers,signal-abort');
});
test('unrelated requests and query variants retain original promise identity and produce no evidence',()=>{
  const promise=Promise.resolve({status:204}),f=fixture(()=>promise);
  for(const url of ['/api/hub-event','https://example.org/api/world-time','/api/world-time?extra=1'])
    assert.equal(f.context.fetch(url),promise);
  assert.equal(f.snapshot().events.length,0);
});
test('network rejection without abort is distinguishable and not swallowed',async()=>{
  const error=new TypeError('network failure'),f=fixture(()=>Promise.reject(error));
  await assert.rejects(f.context.fetch('/api/world-time'),e=>e===error);
  assert.equal(f.snapshot().events.at(-1).signalAborted,false);
  assert.equal(f.snapshot().events.at(-1).errorName,'TypeError');
});
test('bounded evidence reports dropped records and snapshots do not mutate recorder',async()=>{
  const f=fixture(()=>Promise.resolve({status:200}));
  for(let i=0;i<70;i++)await f.context.fetch('/api/world-time');
  assert.equal(f.snapshot().events.length,128);assert.equal(f.snapshot().dropped,12);
  f.snapshot().events[0].type='tampered';assert.equal(f.snapshot().events[0].type,'start');
});
test('sampler retains strict failure guard and collects evidence before close',()=>{
  const source=readFileSync(new URL('./browser/furniture-showroom-world-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/assert\.deepEqual\(smoke\.problems,\[\]\)/);
  assert.ok(source.indexOf('report.worldTimeDiagnostics=')<source.indexOf('await smoke.close()'));
  assert.ok(source.indexOf('await page.evaluate(()=>({')<source.indexOf('report.worldTimeDiagnostics.failures='));
  assert.ok(source.indexOf('report.worldTimeDiagnostics.failures=')<source.indexOf('await smoke.close()'));
  assert.doesNotMatch(source,/problems\.(?:splice|filter)|timeoutMs\s*:/);
});
