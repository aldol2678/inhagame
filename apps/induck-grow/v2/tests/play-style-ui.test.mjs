import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../ui.mjs',import.meta.url),'utf8');
test('style controls expose basic and simple only; details are informational',()=>{
 for(const id of ['start-play-style','play-style-select']){
  const select=html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)</select>'))?.[1];
  assert.ok(select);assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(x=>x[1]),['basic','simple']);
 }
 assert.match(html,/<details id="play-style-details">/);
 assert.match(html,/주간 자동 생활 활동 한도/);
 assert.match(html,/기본 생활비와 사건 지출은 별도/);
 assert.match(ui,/playStyle:\$\('start-play-style'\).value,autoBudget:0/);
});
test('configuration pauses scheduling without advancing a week',()=>{
 const body=ui.slice(ui.indexOf('function updatePlayStyle('),ui.indexOf("$('play-style-select').addEventListener"));
 const calls=[],config={budget:6000};
 const run=new Function('stop','session','render','announce',body+';return updatePlayStyle;')(
  (...args)=>calls.push(['stop',...args]),
  {setPlayStyle:value=>calls.push(['set',value])},
  ()=>calls.push(['render']),text=>calls.push(['announce',text]));
 run(config);
 assert.deepEqual(calls.slice(0,3),[['stop',null,false],['set',config],['render']]);
 assert.ok(!body.includes('nextWeek'));assert.ok(!body.includes('choose('));
});
test('locked plans stay visible in basic and retain plan-specific budget',()=>{
 assert.ok(ui.includes("$('simple-plan').hidden=!simple&&!plan?.locked"));
 assert.ok(ui.includes('currency.format(plan.budget)'));
 assert.ok(ui.includes("simple||plan?.locked||life.pendingEvent||completed"));
 assert.ok(ui.includes("settings.goal"));
 assert.ok(ui.includes("life.playStyle?.history||[]"));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(new Set(ids).size,ids.length);
});
