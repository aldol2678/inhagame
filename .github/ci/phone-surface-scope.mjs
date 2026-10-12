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

export function scopedPhoneMessagesOnly(paths, mainPatch = '') {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  if (!paths.every(path => typeof path === 'string' && (PHONE_FILES.has(path) || path === MAIN))) return false;
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
    return scopedPhoneMessagesOnly(paths,mainPatch)
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
