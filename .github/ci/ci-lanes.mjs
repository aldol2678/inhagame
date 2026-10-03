// Decides which Public CI lanes a change needs (git/Node only, no network beyond `git fetch`).
//
// Usage (GitHub Actions): node .github/ci/ci-lanes.mjs >> "$GITHUB_OUTPUT"
//   CI_EVENT=pull_request: diff the checked-out PR merge commit against its first parent (the base).
//   CI_EVENT=push: diff CI_BEFORE..HEAD. Anything else, or any git failure, runs every lane.
// Prints `static=…`, `db=…`, `npc=…`, `browser=…` (true/false) on stdout and a summary on stderr.
//
// Lanes:
//   static  – scripts/public-ci.sh (static, unit, legacy apps, build): every non-docs change.
//   db      – scripts/public-db.sh (disposable Supabase, pgTAP, integration, types): every non-docs
//             change, exactly as before this file existed.
//   npc     – .github/ci/npc-factory-tests.sh: World NPC / quest / TML runtime and what it imports.
//   browser – .github/ci/world-browser-smoke.sh: anything served by the World app.
// Docs-only changes (the paths PR #31 proposed to ignore) run no lane; the `verify` gate still reports.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LANES = Object.freeze(['static', 'db', 'npc', 'browser']);

const DOCS = [/\.md$/, /^docs\//, /^LICENSE$/, /^NOTICE\.md$/];
// Editing the lane wiring itself runs every lane, so a CI change is proven by the lanes it controls.
const WIRING = ['.github/workflows/public-ci.yml', '.github/ci/ci-lanes.mjs'];
const NPC = ['apps/world/npc-factory/', 'apps/world/tml/', 'apps/world/src/', 'apps/world/data/',
  'apps/world/tests/', '.github/ci/npc-factory-tests.sh'];
const BROWSER = ['apps/world/', 'apps/shared/', '.github/ci/world-browser-smoke.sh'];

const all = (value) => Object.fromEntries(LANES.map((lane) => [lane, value]));
const under = (file, prefixes) => prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

export const isDocs = (file) => DOCS.some((re) => re.test(file));

// files: repository-relative paths, or null when the change set is unknown (always fail open).
export function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return all(true);
  const code = files.filter((file) => !isDocs(file));
  if (code.length === 0) return all(false);
  if (code.some((file) => WIRING.includes(file))) return all(true);
  return {
    static: true,
    db: true,
    npc: code.some((file) => under(file, NPC)),
    browser: code.some((file) => under(file, BROWSER)),
  };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const list = (output) => output.split('\n').map((line) => line.trim()).filter(Boolean);

export function changedFiles(env = process.env) {
  try {
    if (env.CI_EVENT === 'pull_request') {
      // actions/checkout checks out refs/pull/<n>/merge: parent 1 is the base it would merge into.
      const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/);
      if (parents.length !== 3) return null;
      return list(git('diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'));
    }
    if (env.CI_EVENT === 'push') {
      const before = env.CI_BEFORE ?? '';
      if (!/^[0-9a-f]{40}$/.test(before) || /^0+$/.test(before)) return null;
      try { git('cat-file', '-e', `${before}^{commit}`); } catch { git('fetch', '--quiet', '--no-tags', '--depth=1', 'origin', before); }
      return list(git('diff', '--name-only', '--no-renames', before, 'HEAD'));
    }
  } catch { /* unknown change set: run every lane */ }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = changedFiles();
  const lanes = classify(files);
  for (const lane of LANES) console.log(`${lane}=${lanes[lane]}`);
  const scope = files === null ? 'unknown change set (all lanes)' : `${files.length} changed file(s)`;
  console.error(`ci-lanes: ${scope}; ${LANES.map((lane) => `${lane}=${lanes[lane]}`).join(' ')}`);
}
