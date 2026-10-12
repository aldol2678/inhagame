// CI-SCOPE-02: fail-closed, workflow-specific impact routing for modular World features.
// GitHub check names remain stable. A successful skip is a routing decision, NOT a test PASS.
// Required Public, Smartphone, Photo, Housing, Life Housing, Mounted Maps,
// Private Character, World stability and Asset Optimizer are intentionally not gated.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GUARDED_WORKFLOWS = Object.freeze({
  'Graphics integration browser QA': 'graphics-integration-browser.yml',
  'Biryong cloud-save recovery browser QA': 'biryong-cloud-sync-browser.yml',
  'World Main 2 recovery': 'world-main2-recovery.yml',
  'NPC shop routing browser checks': 'npc-shop-routing-browser.yml',
  'Cooking candidate browser QA': 'cooking-candidate-browser.yml',
  'Room transition recovery browser QA': 'room-transition-recovery-browser.yml',
  'Quest journal controls browser checks': 'quest-journal-controls-browser.yml',
  'Asset runtime browser QA': 'asset-runtime-browser.yml',
  'Player activity audio browser QA': 'player-activity-audio-browser.yml',
  'Student center integrated campus browser QA': 'student-center-campus-browser.yml',
  'Biryong map and NPC guidance browser QA': 'biryong-map-guidance-browser.yml'
});
const MAIN = 'apps/world/src/main.js';
// Only independent, already-covered modular surfaces are eligible for selective routing.
// A shared input/engine/CI/backend/scene change, even within a feature PR, runs full.
const SCOPED_MODULES = [
  'apps/world/src/phone/',
  'apps/world/src/quest/',
  'apps/world/src/shop/',
  'apps/world/src/appearance/',
  'apps/world/src/daily-quiz/',
  'apps/world/src/attendance/',
  'apps/world/src/life-skills/'
];
const SCOPED_TESTS = [
  /^apps\/world\/tests\/(?:phone|quest|shop|appearance|daily-quiz|attendance|life-skill)[^/]*\.test\.mjs$/,
  /^apps\/world\/tests\/browser\/(?:phone|quest|shop)[^/]*\.(?:mjs|html)$/
];
const NO_FAST_TITLE = /(?:\brelease\b|\bhotfix\b|릴리스|출시|\[full-ci\])/i;
export function safeModularPath(path) {
  if (path === MAIN || path === 'apps/world/phone.css') return true;
  if (typeof path !== 'string' || path.includes('\0') || path.includes('..')) return false;
  if (SCOPED_MODULES.some(prefix => path.startsWith(prefix))) {
    // Shared shell/input, camera/album storage and account-session state have broad impacts.
    if (/^apps\/world\/src\/phone\/(?:phone-shell|phone-album|phone-surfaces)\b/.test(path)) return false;
    return /\.(?:js|mjs)$/.test(path);
  }
  return SCOPED_TESTS.some(pattern => pattern.test(path))
    || /^docs\/(?:world|qa|implementation)\/.+\.md$/.test(path);
}

// The World entrypoint is otherwise a high-impact file. This independently
// verified hook is a presentation-only player-card handoff, not world state.
// Compare the WHOLE file outside this unique callback, not just diff snippets.
const CARD_START = 'const playerCard = createPlayerCard({';
const HOOK_START = '  onMessage: (userId) => {';
const HOOK_END = '\n  accompany:';
function hideSafeHandoff(source) {
  if (typeof source !== 'string') return null;
  const card = source.indexOf(CARD_START);
  const start = source.indexOf(HOOK_START);
  if (card < 0 || start <= card || start > card + 2600 ||
      source.indexOf(HOOK_START, start + 1) !== -1) return null;
  const end = source.indexOf(HOOK_END, start + HOOK_START.length);
  if (end < 0 || end - start > 2200) return null;
  const body = source.slice(start + HOOK_START.length, end);
  // Maintain the original Hub fallback and leave unrelated player-card actions alone.
  if (!body.includes('sessionStorage.setItem("inhagame-hub-message-draft-v1"') ||
      !body.includes('window.location.assign("/#messages")')) return null;
  return source.slice(0, start + HOOK_START.length) +
    '\n/* PRESENTATION_ONLY_MESSAGE_HANDOFF */' + source.slice(end);
}
export function safeMainHandoff(before, after) {
  const a = hideSafeHandoff(before), b = hideSafeHandoff(after);
  return a !== null && a === b && before !== after;
}

// Read existing paths for the CURRENT workflow instead of maintaining a
// second fragile per-suite path list. Unknown YAML structure -> full QA.
export function declaredPaths(workflowYaml, expectedName) {
  if (typeof workflowYaml !== 'string' || typeof expectedName !== 'string') return null;
  const lines = workflowYaml.split(/\r?\n/);
  if (lines[0] !== 'name: ' + expectedName) return null;
  const start = lines.findIndex((line, i) => line === '    paths:' &&
    lines.slice(Math.max(0, i - 2), i).includes('  pull_request:'));
  if (start < 0) return null;
  const patterns = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith('      - '); i++) {
    const match = lines[i].match(/^      - '([^']+)'$/);
    if (!match || match[1].startsWith('!') || match[1].includes('..')) return null;
    patterns.push(match[1]);
  }
  return patterns.length ? patterns : null;
}
export function matchPath(glob, path) {
  if (typeof glob !== 'string' || typeof path !== 'string') return false;
  // GitHub paths patterns in these 11 workflows use *, **, and literal names.
  // Unknown metacharacters are interpreted conservatively as a match.
  if (/[\[\]{}!?+]/.test(glob)) return true;
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
      else { re += '.*'; i++; }
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(re + '$').test(path);
}
export function classify(files, { workflowName, workflowYaml, mainBefore, mainAfter, prTitle } = {}) {
  if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length)
    return { skip: false, reason: 'empty-or-invalid-changes' };
  if (!prTitle || NO_FAST_TITLE.test(prTitle))
    return { skip: false, reason: 'release-or-unknown-pr' };
  if (!Object.hasOwn(GUARDED_WORKFLOWS, workflowName))
    return { skip: false, reason: 'unknown-workflow' };
  if (!files.every(safeModularPath))
    return { skip: false, reason: 'shared-or-unknown-path' };
  if (files.includes(MAIN) && !safeMainHandoff(mainBefore, mainAfter))
    return { skip: false, reason: 'shared-main-unknown-change' };
  const triggers = declaredPaths(workflowYaml, workflowName);
  if (!triggers) return { skip: false, reason: 'unknown-workflow-triggers' };
  const direct = triggers.filter(pattern => pattern !== MAIN);
  // A suite must still run whenever it explicitly claims any changed source/test.
  if (files.some(path => direct.some(pattern => matchPath(pattern, path))))
    return { skip: false, reason: 'suite-direct-impact' };
  return { skip: true, reason: 'unrelated-modular-feature', paths: files };
}
const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore','pipe','pipe']
});
export function inspect(env = process.env, runGit = git, loadWorkflow = (file) =>
  readFileSync(new URL('../workflows/' + file, import.meta.url), 'utf8')) {
  const base = env.CI_BASE_SHA, head = env.CI_HEAD_SHA;
  const workflowName = env.CI_WORKFLOW_NAME || env.GITHUB_WORKFLOW;
  const filename = GUARDED_WORKFLOWS[workflowName];
  if (!filename) return { skip: false, reason: 'unknown-workflow' };
  if (!env.CI_PR_TITLE || NO_FAST_TITLE.test(env.CI_PR_TITLE))
    return { skip: false, reason: 'release-or-unknown-pr' };
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? ''))
    return { skip: false, reason: 'unknown-sha' };
  try {
    if (runGit('rev-parse','HEAD').trim() !== head)
      return { skip: false, reason: 'head-mismatch' };
    runGit('cat-file','-e',base+'^{commit}');
    runGit('merge-base','--is-ancestor',base,head);
    const changed = runGit('diff','--no-renames','--name-status','-z',base,head,'--');
    if (!changed || !changed.endsWith('\0')) return { skip: false, reason: 'empty-or-invalid-diff' };
    const parts = changed.slice(0,-1).split('\0');
    if (parts.length % 2 !== 0) return { skip: false, reason: 'invalid-file-status' };
    const files=[];
    for (let i=0; i<parts.length; i+=2) {
      if (!['A','M'].includes(parts[i])) return { skip: false, reason: 'unsafe-file-change' };
      files.push(parts[i+1]);
    }
    const before = files.includes(MAIN) ? runGit('show',base+':'+MAIN) : null;
    const after = files.includes(MAIN) ? runGit('show',head+':'+MAIN) : null;
    return classify(files, {
      workflowName, workflowYaml: loadWorkflow(filename),
      mainBefore: before, mainAfter: after, prTitle: env.CI_PR_TITLE
    });
  } catch {
    // Missing merge ancestry, shallow history, malformed diff, bad workflow:
    // do not opt out of ANY tests.
    return { skip: false, reason: 'missing-history-or-diff-error' };
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result=inspect();
  process.stdout.write('skip='+String(result.skip)+'\n');
  console.error('ci-impact: '+(result.skip?'SKIP costly unrelated steps':'RUN full suite')+
    ' ('+result.reason+', '+(result.paths?.length??'?')+' files; '+(process.env.GITHUB_WORKFLOW||'unknown workflow')+')');
}
