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
test("support pages are reachable and do not invent service state or replace existing privacy policy",async()=>{
 const [html,updates,support,terms,privacy]=await Promise.all([read("../index.html"),read("../updates.html"),read("../support.html"),read("../terms.html"),read("../privacy.html")]);
 for(const p of ["updates.html","support.html","terms.html","privacy.html"])assert.ok(html.includes('/'+p));
 assert.match(updates,/정식 배포 확인을 기다리고 있습니다/);
 assert.match(support,/mailto:aldol@inha\.edu/);
 assert.match(support,/현재 웹 문의 접수 폼과 티켓 추적 기능은 제공하지 않습니다/);
 assert.match(terms,/아직 시행되지 않은 검토 문서/);
 assert.match(privacy,/https:\/\/duck\.inhagame\.app\/privacy\.html/);
});
