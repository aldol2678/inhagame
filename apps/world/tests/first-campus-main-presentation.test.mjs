import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFirstCampusCompletion } from '../src/quest/first-campus-completion.js';
import { createCore15FunnelTelemetry } from '../src/core15-funnel-telemetry.js';
import { createToastQueue, rewardToastMessage } from '../src/events/zombie-university-2026/event-ui.js';
import { createProgressionClient } from '../src/progression/progression-client.js';
import { createProgressionHud } from '../src/progression/progression-hud.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('onQuestReward: reward => {') + 'onQuestReward: '.length;
let depth = 0, end = start;
for (; end < main.length; end++) {
  if (main[end] === '{') depth++;
  if (main[end] === '}' && --depth === 0) { end++; break; }
}
const rewardCallback = main.slice(start, end);
const reward = {
  rewardId: 'reward.quest.first_campus', rewardVersion: 2, rewardTransactionId: 'receipt-1',
  status: 'SUCCESS', replayed: false, completedAt: '2026-10-04T00:00:00Z',
  entries: [
    { grantType: 'ITEM', targetId: 'badge.main_gate', granted: 1, requested: 1, status: 'GRANTED' },
    { grantType: 'EXP', targetId: 'exp.campus', granted: 100, requested: 100, status: 'GRANTED' }
  ]
};
const snapshot = {
  totalExp: 100, level: 2, currentLevelStartExp: 100, nextLevelExp: 300,
  progressExp: 0, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false
};
const element = () => ({
  hidden: false, textContent: '', style: {}, dataset: {}, setAttribute() {},
  isConnected: true, parentElement: null,
  ownerDocument: { visibilityState: 'visible', defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) } },
  getClientRects: () => [{ width: 160, height: 60 }]
});
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

for (const replayed of [false, true]) test(`actual main callback completes ${replayed ? 'recovered' : 'fresh'} receipt only after displayed server readback`, async () => {
  let seq = 0, releaseRead;
  const delivered = [];
  const funnel = createCore15FunnelTelemetry({ storage: null,
    eventIdFactory: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    track: async (event, _surface, _target, { eventId }) => { delivered.push(event); return eventId; }
  });
  const flow = createFirstCampusCompletion({ storage: null, getFunnel: () => funnel });
  flow.setAccount('A'); flow.begin();
  const toastElement = element(), timers = [];
  const queue = createToastQueue({ element: toastElement, setTimer: fn => (timers.push(fn), fn), clearTimer() {}, now: () => 0 });
  queue.say('existing message', 1);
  const views = Object.fromEntries(['pill', 'pillLevel', 'pillExp', 'pillBar', 'pillFill', 'badge', 'badgeLevel', 'badgeBar', 'badgeFill', 'menuLine'].map(k => [k, element()]));
  const hud = createProgressionHud(views);
  const progression = createProgressionClient({ getClient: () => ({ rpc: async () => new Promise(resolve => { releaseRead = resolve; }) }), rewardRetryDelays: [] });
  progression.onChange(change => { hud.render(change.state, change.snapshot); flow.growthReadback(change); });
  const accountRead = progression.setAccount('A'); await flush(); releaseRead({ data: snapshot, error: null }); await accountRead;
  const invoke = new Function('firstCampusCompletion', 'core15Funnel', 'mcmEventUi', 'progression', 'wallet', 'inventory', 'FIRST_CAMPUS_REWARD_ID', 'lobbyWorld', 'lobbyTransition', `return (${rewardCallback});`)(
    flow, funnel, { showReward(result, { isValid = () => true, canPresent = () => true } = {}) { const message = rewardToastMessage(result); return queue.say(message.text, message.ms, null, isValid, canPresent); } },
    progression, { refresh() { assert.fail('First Campus has no currency'); } }, { refresh() {} }, reward.rewardId, { active: false }, { active: false }
  );
  invoke({ ...reward, replayed }); await flush();
  flow.observe({ growthVisible: true, nextGoalVisible: true }); await flush();
  assert.equal(delivered.includes('reward_seen'), false, 'queued receipt has not displayed');
  assert.equal(delivered.includes('core15_complete'), false);
  timers.shift()(); timers.shift()();
  flow.observe({ growthVisible: true, nextGoalVisible: true }); await flush();
  assert.equal(delivered.includes('reward_seen'), true);
  assert.equal(delivered.includes('growth_seen'), false, 'old HUD content is not a new reward readback');
  releaseRead({ data: snapshot, error: null }); await flush();
  assert.equal(views.pillLevel.textContent, 'Lv.2');
  flow.observe({ growthVisible: false, nextGoalVisible: true }); await flush();
  assert.equal(delivered.includes('growth_seen'), false, 'readback hidden by UI is not visible growth');
  flow.observe({ growthVisible: true, nextGoalVisible: false }); await flush();
  assert.equal(delivered.includes('growth_seen'), true);
  assert.equal(delivered.includes('core15_complete'), false, 'missing next goal cannot complete');
  flow.observe({ growthVisible: true, nextGoalVisible: true }); await flush();
  assert.equal(delivered.filter(e => e === 'core15_complete').length, 1);
  assert.equal(delivered.includes('core_loop_complete'), !replayed, 'legacy settlement metric remains fresh-only');
});
test('actual update gate observes final-talk toast while NPC dialogue blocks world input',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');const at=source.indexOf('firstCampusCompletion.observe({');const from=source.lastIndexOf('\n',at)+1;const to=source.indexOf('\n  });',at)+6;
 const events=[];const flow=createFirstCampusCompletion({storage:null,getFunnel:()=>Object.fromEntries(['firstReward','rewardSeen','growthSeen','nextGoalSeen'].map(k=>[k,()=>events.push(k)]))});flow.setAccount('A');flow.begin();const token=flow.accept(reward);let toastVisible=true;flow.trackToast(token,{isVisible:()=>toastVisible});flow.growthReadback({accountId:'A',reason:'core15-first-campus-reward',state:'READY',snapshot});
 let inputAllowed=false;
 const frame=new Function('firstCampusCompletion','inputFocus','lobbyWorld','lobbyTransition','isElementVisible','document','navigation','main2GuideNavigationTarget','nextDiscovery',source.slice(from,to));
 const run=()=>frame(flow,{can:()=>inputAllowed},{active:false},{active:false},()=>true,{getElementById:()=>({})},{},()=>({}),{status:()=>({id:'main2_back_gate_guide'})});
 run();assert.deepEqual(events,['firstReward','rewardSeen'],'visible reward counts while final dialogue is still open');
 toastVisible=false;inputAllowed=true;run();assert.deepEqual(events,['firstReward','rewardSeen','growthSeen','nextGoalSeen'],'closing dialogue resumes the remaining visible steps even after toast expires');
});
