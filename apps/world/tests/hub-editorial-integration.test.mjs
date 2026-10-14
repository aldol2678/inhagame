import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=name=>readFile(new URL(name,import.meta.url),"utf8");
test("editorial portal adds R2 visual/navigation without replacing live account and social panels",async()=>{
 const [html,hub,css,arcade]=await Promise.all([read("../index.html"),read("../hub.js"),read("../hub-editorial.css"),read("../hub-editorial.js")]);
 for(const id of ["ranking","friends","messages","account","settings"])assert.ok(html.includes('data-view="'+id+'"'));
 for(const id of ["hub-login-form","hub-signup-form","hub-delete-account-confirm","hub-message-composer","hub-friends-list","game-cards"])assert.ok(html.includes('id="'+id+'"'));
 for(const game of ["classic","induckup","survival","induck-grow"])assert.ok(html.includes('data-game-id="'+game+'"'));
 assert.match(html,/href="\/campus\/\?lobby=1"/);
 assert.match(html,/INHA WORLD · Campus Éditorial/);
 assert.match(html,/hub-editorial\.css/);
 assert.match(html,/hub-editorial\.js/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(arcade,/MutationObserver/);
 assert.match(hub,/hub_game_click/);
 assert.match(hub,/hub_panel_view/);
});
test("support pages publish public-facing help, terms and the privacy policy without invented service history",async()=>{
 const [html,updates,support,terms,privacy]=await Promise.all([read("../index.html"),read("../updates.html"),read("../support.html"),read("../terms.html"),read("../privacy.html")]);
 for(const p of ["updates.html","support.html","terms.html","privacy.html"])assert.ok(html.includes('/'+p));
 assert.match(updates,/등록된 업데이트 소식이 없습니다/);
 assert.doesNotMatch(updates,/개발 브랜치·PR|정식 배포 확인을 기다리고 있습니다/);
 assert.match(support,/mailto:aldol@inha\.edu/);
 assert.match(support,/메일 앱에서 전송을 완료해 주세요/);
 assert.match(html, /href="\/terms\.html">이용약관<\/a>/);
 assert.doesNotMatch(html, /이용약관\(검토안\)/);
 for (let article = 1; article <= 15; article++) {
   assert.match(terms, new RegExp('<h2>제' + article + '조 '));
 }
 assert.equal((terms.match(/<h2>제\d+조 /g) || []).length, 15);
 assert.match(terms, /2026년 10월 15일\s*\(한국시간\)/);
 assert.match(terms, /최지석/);
 assert.match(terms, /aldol@inha\.edu/);
 assert.match(terms, /회원가입은 가입 신청일 현재 만 14세 이상인 사람만 할 수 있습니다/);
 assert.match(terms, /서비스 이용료는 무료입니다/);
 assert.match(terms, /실제 게시 이전의 이용에는 소급하여 적용하지 않습니다/);
 assert.match(terms, /약관 게시, 계정 보유, 침묵 또는 계속 이용만으로 동의한 것으로 처리하지 않습니다/);
 assert.match(terms, /연령 자기확인은 약관 동의나 법정대리인 동의를 대신하지 않습니다/);
 assert.doesNotMatch(terms, /아직 시행되지 않은 검토 문서|이용약관\(검토안\)/);
 assert.match(privacy, /<h2>1\. 처리 목적 및 항목<\/h2>/);
 assert.match(privacy, /<h2>8\. 변경 안내<\/h2>/);
 assert.doesNotMatch(privacy, /통합 전 점검|새로 작성하는 동안/);
});
