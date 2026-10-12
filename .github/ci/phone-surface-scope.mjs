// Conservative opt-out of unrelated *browser* suites for an isolated Phone member-messages change.
// This never disables Public verify, Smartphone, Photo, Housing, Mounted Maps, Life Housing,
// Private Character or World asset canary. Unknown input always runs the full suite.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PHONE_FILES = new Set([
  'apps/world/src/phone/phone-messages.js',
  'apps/world/src/phone/smartphone.js',
  'apps/world/src/phone/phone-preferences.js',
  'apps/world/phone.css',
  'apps/world/tests/browser/phone-messages-harness.html',
  'apps/world/tests/browser/phone-messages-smoke.mjs',
  'apps/world/tests/browser/phone-campus-smoke.mjs',
  'apps/world/tests/phone-preferences.test.mjs'
]);
const MAIN = 'apps/world/src/main.js';
// No context-free main.js edits qualify. This is the reviewed player-card handoff only.
// Changes to Phone admission, rendering, ownership, lifecycle, game integrations, etc. fail closed.
const MAIN_ADDED = Object.freeze([
  '    playerCard.close();',
  '    if (smartphone?.openMessages?.(userId)) return true;'
]);


// Only the reviewed MENU-02A registry and badge binding may count as a safe
// smartphone.js or preferences.js edit. All other Phone shell/input changes run full.
const REVIEWED_PHONE_DELTAS = Object.freeze({
  "apps/world/src/phone/smartphone.js": Object.freeze([
  "+import { createPhoneMessages } from './phone-messages.js';",
  "+  let messageUnread=0;",
  "+  const messages=createPhoneMessages({getClient,onUnread:count=>{",
  "+    messageUnread=count;",
  "+    const badge=root.querySelector('.smartphone-app[data-app-id=\"messages\"] .smartphone-notification-badge');",
  "+    if(badge){badge.hidden=!count;badge.textContent=count>99?'99+':String(count);}",
  "+  }});",
  "-    {id:'attendance',name:'출석부',icon:'📅',available:()=>!!getAttendancePanel(),open(){},close:()=>closeDailySurface('attendance')}",
  "+    {id:'attendance',name:'출석부',icon:'📅',available:()=>!!getAttendancePanel(),open(){},close:()=>closeDailySurface('attendance')},",
  "+    {id:'messages',name:'메시지',icon:'💬',available:()=>true,open:params=>messages.activate(params),close:()=>messages.close()}",
  "-    if(app?.available())n.append(el('span','smartphone-app-icon',app.icon),el('span','smartphone-app-name',app.name));",
  "+    if(app?.available()){n.append(el('span','smartphone-app-icon',app.icon),el('span','smartphone-app-name',app.name));",
  "+      if(id==='messages'){const badge=el('b','smartphone-notification-badge',messageUnread>99?'99+':String(messageUnread));badge.hidden=!messageUnread;badge.setAttribute('aria-label','읽지 않은 메시지');n.append(badge);}",
  "+    }",
  "+      else if(app.appId==='messages')messages.mount(content);",
  "-    setAccount(userId){albumManager.reset();shell.close();student.invalidate();album.setScope(userId);warning='';preferences.load();history.load();wallpaperKey='';void setWallpaper();},",
  "+    setAccount(userId){albumManager.reset();shell.close();messages.setAccount(userId);student.invalidate();album.setScope(userId);warning='';preferences.load();history.load();wallpaperKey='';void setWallpaper();},",
  "+    openMessages(recipientId){if(shell.state==='CLOSED'&&!open())return false;return shell.ownsInput && launch('messages',{recipientId});},",
  "-    status:()=>({...shell.snapshot(),scope:album.scope,preferences:preferences.snapshot(),albumError:album.error}),",
  "-    destroy(){albumManager.reset();shell.close();destroyed=true;clearHold();win.clearInterval(clockTimer);shell.destroy();album.destroy();unsubscribePhoto();",
  "+    status:()=>({...shell.snapshot(),scope:album.scope,preferences:preferences.snapshot(),albumError:album.error,messages:messages.status()}),",
  "+    destroy(){albumManager.reset();shell.close();messages.setAccount(null);destroyed=true;clearHold();win.clearInterval(clockTimer);shell.destroy();album.destroy();unsubscribePhoto();"
]),
  "apps/world/src/phone/phone-preferences.js": Object.freeze([
  "-export const PHONE_APP_IDS = Object.freeze(['student-id','maps','camera','album','settings','daily-quiz','attendance']);",
  "+export const PHONE_APP_IDS = Object.freeze(['student-id','maps','camera','album','settings','daily-quiz','attendance','messages']);"
]),
  "apps/world/phone.css": Object.freeze([
  "+",
  "+/* PHONE-MENU-02A · single account-scoped Hub messages view inside the Phone. */",
  "+.smartphone .smartphone-app { position:relative; }",
  "+.smartphone .smartphone-notification-badge { position:absolute; top:0; right:8px; z-index:2; min-width:18px; padding:2px 5px; color:#132e45; background:#ffe393; border-radius:20px; font-size:11px; }",
  "+.smartphone .smartphone-notification-badge[hidden] { display:none; }",
  "+.phone-messages { display:grid; gap:10px; min-width:0; }",
  "+.phone-messages h3 { margin:0; }",
  "+.phone-messages-controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:space-between; }",
  "+.phone-messages-unread { font-size:12px; }",
  "+.phone-messages-new { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; }",
  "+.phone-messages input, .phone-messages textarea { min-width:0; width:100%; box-sizing:border-box; border:1px solid #ffffff55; border-radius:10px; background:#15394e; color:#fff; font:inherit; padding:10px; }",
  "+.phone-messages input:focus-visible, .phone-messages textarea:focus-visible { outline:3px solid #ffe9a4; }",
  "+.phone-messages-inbox { display:grid; gap:6px; }",
  "+.smartphone .phone-messages-inbox-item { display:grid; grid-template-columns:1fr auto; text-align:left; gap:3px; overflow-wrap:anywhere; width:100%; }",
  "+.phone-messages-inbox-item small { grid-column:1 / -1; font-size:12px; opacity:.85; }",
  "+.phone-messages-count { color:#172d3c; background:#ffe393; border-radius:30px; padding:2px 7px; }",
  "+.phone-messages-thread { display:grid; gap:8px; max-height:none; }",
  "+.phone-messages-entry { padding:10px; min-width:0; overflow-wrap:anywhere; background:#17374dcc; border-radius:14px; }",
  "+.phone-messages-entry.is-mine { background:#24645dcc; margin-left:14px; }",
  "+.phone-messages-entry p { margin:0 0 6px; white-space:pre-wrap; }",
  "+.phone-messages-entry small { opacity:.75; }",
  "+.phone-messages-composer { display:grid; gap:6px; }",
  "+.phone-messages-report { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }",
  "+.phone-messages-report select { width:auto; min-width:0; flex:1; }",
  "+.phone-messages-notice { margin:0; padding:8px; border-radius:8px; background:#15394e; }",
  "+@media(max-width:380px) { .phone-messages-new { grid-template-columns:1fr; } }"
])
});
const scopedDiffLines = (path,patch) => {
  if(typeof patch!=='string'||!patch.startsWith('diff --git a/'+path+' b/'+path+'\n')) return null;
  return patch.split('\n').filter(line=>(line.startsWith('+')&&!line.startsWith('+++'))||
    (line.startsWith('-')&&!line.startsWith('---')));
};

export function scopedPhoneMessagesOnly(paths, mainPatch = '', extraPatches = {}) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  if (!paths.every(path => typeof path === 'string' && (PHONE_FILES.has(path) || path === MAIN))) return false;
  for(const [path,expected] of Object.entries(REVIEWED_PHONE_DELTAS)){
    if(!paths.includes(path))continue;
    const actual=scopedDiffLines(path,extraPatches[path]);
    if(!actual||actual.length!==expected.length||actual.some((line,i)=>line!==expected[i]))return false;
  }
  if (!paths.includes(MAIN)) return true;
  if (typeof mainPatch !== 'string' || !mainPatch.startsWith('diff --git a/apps/world/src/main.js b/apps/world/src/main.js\n')) return false;
  const lines = mainPatch.split('\n').filter(x => (x.startsWith('+') && !x.startsWith('+++')) ||
    (x.startsWith('-') && !x.startsWith('---')));
  if (lines.length !== MAIN_ADDED.length || lines.some(x => !x.startsWith('+'))) return false;
  return lines.every((x, i) => x.slice(1) === MAIN_ADDED[i]);
}

function git(...args) {
  return execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']});
}

export function inspect(env = process.env) {
  const base = env.CI_BASE_SHA, head = env.CI_HEAD_SHA;
  const title = typeof env.CI_PR_TITLE === 'string' ? env.CI_PR_TITLE.trim() : '';
  // Release/hotfix reviews never take the fast path, even if their files look narrow.
  if (!title || /(?:\brelease\b|\bhotfix\b|릴리스|출시|\[full-ci\])/i.test(title)) return {skip:false,reason:'release-or-unknown-pr'};
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) return {skip:false,reason:'unknown-sha'};
  try {
    if (git('rev-parse','HEAD').trim() !== head) return {skip:false,reason:'head-mismatch'};
    git('cat-file','-e',base+'^{commit}');
    execFileSync('git',['merge-base','--is-ancestor',base,head],{stdio:'ignore'});
    const output=git('diff','--no-renames','--name-only','-z',base,head,'--');
    if (!output.endsWith('\0')) return {skip:false,reason:'empty-or-invalid-diff'};
    const paths=output.slice(0,-1).split('\0');
    // Deletions, renames and type changes are not merely Phone presentations.
    const nameStatus=git('diff','--no-renames','--name-status','-z',base,head,'--');
    if (/(^|\0)(?:D|R|C|T|U)(?:\d+)?\0/.test(nameStatus)) return {skip:false,reason:'unsafe-file-change'};
    const mainPatch=paths.includes(MAIN) ? git('diff','--no-ext-diff','--no-renames','--unified=0',base,head,'--',MAIN) : '';
    const extraPatches={};
    for(const path of Object.keys(REVIEWED_PHONE_DELTAS))if(paths.includes(path))
      extraPatches[path]=git('diff','--no-ext-diff','--no-renames','--unified=0',base,head,'--',path);
    return scopedPhoneMessagesOnly(paths,mainPatch,extraPatches)
      ? {skip:true,reason:'isolated-member-message-ui',paths}
      : {skip:false,reason:'broader-or-unknown-impact',paths};
  } catch {
    return {skip:false,reason:'missing-history-or-diff-error'};
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result=inspect();
  process.stdout.write('skip='+String(result.skip)+'\n');
  console.error('phone-surface-scope: '+(result.skip?'skip unrelated heavy suite':'run full suite')+
    ' ('+result.reason+', '+(result.paths?.length??'?')+' changed file(s))');
}
