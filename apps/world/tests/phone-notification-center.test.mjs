import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPhoneNotificationCenter } from '../src/phone/phone-notification-center.js';
import { defaultPhonePreferences, normalizePhonePreferences } from '../src/phone/phone-preferences.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const descendants = n => [n,...n.children.flatMap(descendants)];
function fixture() {
  const data=new Map(), doc=createFakeDocument(), host=doc.createElement('main');
  let accountId=A, lastOpen=null, attendanceListeners=new Set(), quizListeners=new Set(), calls=0;
  const attendance={get accountId(){return accountId;},state:'READY',
    snapshot:{rewardDate:'2026-10-14',claimedToday:false},onChange(fn){attendanceListeners.add(fn);return ()=>attendanceListeners.delete(fn);}};
  const quiz={get accountId(){return accountId;},state:'READY',
    snapshot:{rewardDate:'2026-10-14',status:'AVAILABLE'},onChange(fn){quizListeners.add(fn);return ()=>quizListeners.delete(fn);}};
  const local={getItem:k=>data.get(k)||null,setItem:(k,v)=>{calls++;data.set(k,v);}};
  const center=createPhoneNotificationCenter({doc,getStorage:()=>local,getAttendance:()=>attendance,getQuiz:()=>quiz,
    onOpenApp:id=>{lastOpen=id;return true;}});
  return {center,host,attendance,quiz,data,get lastOpen(){return lastOpen;},get calls(){return calls;},
    swap(id){accountId=id;},tick(){for(const fn of attendanceListeners)fn();for(const fn of quizListeners)fn();},
    findButton(label){return descendants(host).find(n=>n.tagName==='BUTTON'&&n.textContent===label);}};
}
test('NOTI-01A uses only real account-scoped message count and server daily state',()=>{
 const f=fixture();f.center.setAccount(A);f.center.setMessageUnread(3);
 const state=f.center.snapshot();
 assert.equal(state.unreadCount,5);assert.deepEqual(state.rows.map(x=>x.appId),['messages','attendance','daily-quiz']);
 assert.equal(f.calls,0,'reads never write local data or send server actions');
 assert.equal(f.center.markRead('attendance:2026-10-14'),true);
 assert.equal(f.center.snapshot().unreadCount,4);
 f.center.markAllRead();
 assert.equal(f.center.snapshot().unreadCount,3,'the read-all control never changes server unread messages');
 f.center.setMessageUnread(0);
 assert.equal(f.center.snapshot().unreadCount,0);
 f.center.destroy();
});
test('account switch drops unread, hides stale domain responses and restores only own local seen state',()=>{
 const f=fixture();f.center.setAccount(A);f.center.markRead('attendance:2026-10-14');
 f.center.setMessageUnread(2);
 f.center.setAccount(B);
 assert.equal(f.center.snapshot().unreadCount,0,'old clients and message counts cannot leak');
 assert.equal(f.center.snapshot().rows.length,0);
 f.swap(B);f.tick();assert.equal(f.center.snapshot().unreadCount,2,'new account has its own daily state');
 f.center.setAccount(null);
 assert.equal(f.center.snapshot().unreadCount,0);
 f.swap(A);f.center.setAccount(A);
 assert.equal(f.center.snapshot().unreadCount,1,'A attendance read marker restored; quiz remains unread');
 f.center.destroy();
});
test('date-bound daily read IDs reset with server day, and unavailable state never fabricates notices',()=>{
 const f=fixture();f.center.setAccount(A);f.center.markAllRead();
 f.attendance.snapshot={rewardDate:'2026-10-15',claimedToday:false};
 f.quiz.snapshot={rewardDate:'2026-10-15',status:'ACTIVE'};f.tick();
 assert.equal(f.center.snapshot().unreadCount,2);
 f.attendance.state='UNAVAILABLE';f.quiz.state='LOADING';f.tick();
 assert.equal(f.center.snapshot().rows.length,0,'load failures do not masquerade as actionable notices');
 f.center.destroy();
});
test('Phone Notification UI filters, mutes, and deep-links without claiming daily rewards',()=>{
 const f=fixture();f.center.setAccount(A);f.center.setMessageUnread(1);f.center.mount(f.host);
 assert.ok(f.findButton('전체'));assert.ok(f.findButton('메시지'));assert.ok(f.findButton('오늘 할 일'));
 f.findButton('오늘 할 일').click();
 assert.equal(descendants(f.host).filter(n=>n.className==='phone-notification-item').length,2);
 f.findButton('출석부 열기').click();assert.equal(f.lastOpen,'attendance');
 assert.equal(f.center.snapshot().unreadCount,2,'only local attendance read flag changed');
 f.findButton('메시지').click();f.findButton('메시지 열기').click();assert.equal(f.lastOpen,'messages');
 f.center.setMuted('messages',true);assert.equal(f.center.snapshot().unreadCount,1);
 f.center.close();f.center.destroy();
});
test('old Phone layout gains one notification app without resetting existing apps',()=>{
 const p=defaultPhonePreferences();p.pages[0][1]=null;p.pages[0][11]='album';
 const next=normalizePhonePreferences(p);const ids=[...next.pages.flat(),...next.dock].filter(Boolean);
 assert.equal(ids.filter(x=>x==='notifications').length,1);assert.equal(ids.filter(x=>x==='messages').length,1);
 assert.deepEqual(next.dock,['maps','camera',null,null]);assert.equal(next.pages[0][11],'album');
 assert.deepEqual(normalizePhonePreferences(next),next);
});
test('integration keeps pre-existing Phone state/authority while wiring notifier',()=>{
 const s=readFileSync(new URL('../src/phone/smartphone.js',import.meta.url),'utf8');
 const m=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(s,/notifications\.setAccount\(userId\);messages\.setAccount\(userId\)/);
 assert.match(s,/app\.appId==='notifications'\)notifications\.mount\(content\)/);
 assert.match(m,/getDailyQuiz: \(\) => dailyQuiz, getAttendance: \(\) => attendance/);
 assert.doesNotMatch(readFileSync(new URL('../src/phone/phone-notification-center.js',import.meta.url),'utf8'),/\.rpc\(|serviceWorker|PushManager/);
});

test('NOTI-01B summary, filter counts, collapsed settings and compact cards',()=>{
 const f=fixture();f.center.setAccount(A);f.center.setMessageUnread(3);f.center.mount(f.host);
 const all=descendants(f.host);
 assert.ok(all.some(n=>n.className==='phone-notifications-summary' && n.textContent.includes('5건')));
 assert.equal(all.filter(n=>n.tagName==='H3').length,1,'one in-app heading, no repeated 알림센터');
 const tab=f.findButton('전체');
 assert.equal(tab.getAttribute('aria-pressed'),'true');
 assert.ok(tab.children.some(n=>n.textContent==='3'),'three source cards visible, not five invented records');
 const settings=all.find(n=>n.className==='phone-notifications-preferences');
 assert.equal(settings.hidden,true,'preferences are initially collapsed');
 f.findButton('표시 설정').click();
 const opened=descendants(f.host).find(n=>n.className==='phone-notifications-preferences');
 assert.equal(opened.hidden,false);
 assert.equal(f.findButton('표시 설정').getAttribute('aria-expanded'),'true');
 const toggles=descendants(f.host).filter(n=>n.attributes.role==='switch');
 assert.equal(toggles.length,2);
 toggles[0].click();
 assert.equal(f.center.snapshot().counts.messages,0,'category can be muted without changing server unread');
 assert.equal(f.center.snapshot().rows[0].unread,true);
 f.center.destroy();
});
test('NOTI-01B only marks daily read after an app actually opens',()=>{
 const doc=createFakeDocument(),host=doc.createElement('main'),seen=new Map(),account=A;
 const attendance={accountId:account,state:'READY',snapshot:{rewardDate:'2026-10-14',claimedToday:false}};
 let success=false,attempts=0;
 const c=createPhoneNotificationCenter({doc,getAttendance:()=>attendance,getQuiz:()=>null,
  getStorage:()=>({getItem:k=>seen.get(k)||null,setItem:(k,v)=>seen.set(k,v)}),
  onOpenApp:()=>{attempts++;return success;}});
 c.setAccount(account);c.mount(host);
 const action=()=>descendants(host).find(n=>n.tagName==='BUTTON'&&n.textContent==='출석부 열기');
 action().click();
 assert.equal(attempts,1);
 assert.equal(c.snapshot().unreadCount,1,'failed routing must not mark read');
 assert.ok(descendants(host).some(n=>n.className==='phone-notifications-error'));
 success=true;action().click();
 assert.equal(c.snapshot().unreadCount,0,'successful routing marks local task seen');
 c.destroy();
});
test('NOTI-01B all-daily-read is explicit and cannot mutate message unread',()=>{
 const f=fixture();f.center.setAccount(A);f.center.setMessageUnread(2);f.center.mount(f.host);
 assert.ok(f.findButton('할 일 알림 모두 확인'));
 f.findButton('할 일 알림 모두 확인').click();
 assert.equal(f.center.snapshot().unreadCount,2);
 assert.equal(f.findButton('할 일 알림 모두 확인'),undefined,'button disappears when nothing remains to mark');
 f.center.destroy();
});
