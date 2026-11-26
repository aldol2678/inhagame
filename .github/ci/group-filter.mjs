// CI-GROUP-01: fail-closed suite selection for grouped World browser workflows.
// One group workflow triggers on the union of its suites' paths; this script decides
// which suites a pull request actually touches. A suite runs unless this script
// positively reports `false` for it: any error, unknown input or shared-file change
// selects every suite. A skipped suite is a routing decision, NOT a test PASS.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { matchPath } from './phone-surface-scope.mjs';

// Files every World browser suite consumes: each one installs from this lockfile and
// each smoke imports the shared harness. A change runs every suite of every group.
// Other widely used files (main.js, styles.css) are NOT listed here: a suite runs for
// them only if the workflow it replaces already declared them, so a group never fans
// out wider than its original workflows did.
export const SHARED_PATHS = Object.freeze([
  'apps/world/tests/browser/package*.json',
  'apps/world/tests/browser/harness.mjs'
]);
// CI plumbing every group depends on.
const COMMON_INFRA = Object.freeze([
  '.github/ci/group-filter.mjs',
  '.github/ci/group-filter.test.mjs',
  '.github/ci/phone-surface-scope.mjs',
  '.github/actions/setup-world-browser/**'
]);

// Suite path lists are the trigger paths of the workflows each group replaces, minus
// the replaced workflow file itself. `legacy` names those workflows while they still
// exist so the tests can prove no original trigger was dropped.
export const GROUPS = Object.freeze({
  places: Object.freeze({
    workflow: 'world-places-browser.yml',
    name: 'World places browser QA',
    legacy: Object.freeze({
      'backgate-shopfront': 'backgate-shopfront-browser.yml',
      'backgate-restoration': 'backgate-restoration-browser.yml',
      'jeongseok-gate': 'jeongseok-gate-browser.yml',
      'jeongseok-interior': 'jeongseok-interior-browser.yml',
      'north-landmark': 'north-landmark-browser.yml',
      'north-walkway': 'north-walkway-browser.yml'
    }),
    suites: Object.freeze({
      'backgate-shopfront': [
        'apps/world/src/backgate-shopfront-geometry.js',
        'apps/world/src/back-street-geometry.js',
        'apps/world/src/culture-street-geometry.js',
        'apps/world/src/culture-street-signs.js',
        'apps/world/tests/backgate-shopfront*.test.mjs',
        'apps/world/tests/browser/backgate-shopfront-*'
      ],
      'backgate-restoration': [
        'apps/world/src/backgate-infill-geometry.js',
        'apps/world/src/back-alley-geometry.js',
        'apps/world/src/back-market-geometry.js',
        'apps/world/src/back-street-geometry.js',
        'apps/world/src/culture-street-geometry.js',
        'apps/world/src/north-side-gate-geometry.js',
        'apps/world/src/campus-road-blockout.js',
        'apps/world/tests/backgate-infill*.test.mjs',
        'apps/world/tests/backgate-road*.test.mjs',
        'apps/world/tests/backgate-restoration*.test.mjs',
        'apps/world/tests/browser/backgate-infill-*',
        'apps/world/tests/browser/backgate-road-*',
        'apps/world/tests/browser/backgate-restoration-*'
      ],
      'jeongseok-gate': [
        'apps/world/src/jeongseok/**',
        'apps/world/tests/jeongseok-access.test.mjs',
        'apps/world/tests/browser/jeongseok-gate-smoke.mjs',
        'supabase/migrations/20261012100000_world_jeongseok_access_jsl_a.sql',
        'supabase/tests/database/111_world_jeongseok_access_jsl_a.test.sql'
      ],
      'jeongseok-interior': [
        'apps/world/src/jeongseok/**',
        'apps/world/src/rooms/room-registry.js',
        'apps/world/src/rooms/room-transition.js',
        'apps/world/src/rooms/room-world-adapter.js',
        'apps/world/src/main.js',
        'apps/world/tests/jeongseok-interior.test.mjs',
        'apps/world/tests/browser/jeongseok-interior-smoke.mjs'
      ],
      'north-landmark': [
        'apps/world/src/north-*',
        'apps/world/src/agora-photo-geometry.js',
        'apps/world/src/campus-facilities.js',
        'apps/world/src/campus-material-profile.js',
        'apps/world/src/facility-blockout.js',
        'apps/world/src/roadview-details.js',
        'apps/world/data/reality/north-landmark-restoration.provenance.json',
        'apps/world/tests/*north-landmark*',
        'apps/world/tests/browser/north-landmark-*'
      ],
      'north-walkway': [
        'apps/world/src/north-walkway-*',
        'apps/world/src/north-campus-*',
        'apps/world/src/navigation/campus-navigation.js',
        'apps/world/src/minimap/minimap-data.js',
        'apps/world/src/render-chunk-registry.js',
        'apps/world/tests/*north-walkway*',
        'apps/world/tests/browser/north-walkway-*'
      ]
    })
  }),
  housing: Object.freeze({
    workflow: 'world-housing-browser.yml',
    name: 'World housing browser QA',
    legacy: Object.freeze({
      'housing': 'housing-browser.yml',
      'life-housing': 'life-housing-browser.yml',
      'starter-furniture': 'starter-furniture-browser.yml',
      'room-transition-recovery': 'room-transition-recovery-browser.yml',
      'cooking-candidate': 'cooking-candidate-browser.yml',
      'wardrobe-inventory-retry': 'wardrobe-inventory-retry-browser.yml'
    }),
    suites: Object.freeze({
      'housing': [
        'apps/world/src/phone/smartphone.js',
        'apps/world/src/rooms/**',
        'apps/world/src/commissions/**',
        'apps/world/tests/sample-room-trial*.test.mjs',
        'apps/world/tests/browser/sample-room-trial-*',
        'apps/world/src/collection/item-catalog.js',
        'apps/world/tests/furniture-*.test.mjs',
        'apps/world/tests/personal-room*.test.mjs',
        'apps/world/assets/rooms/**',
        'apps/world/assets/furniture/**',
        'scripts/assets/build-dorm-single-sofa.py',
        'apps/world/assets/kaykit/furniture-bits/**',
        'apps/world/dev-server.mjs',
        'apps/world/src/campus-render-kit.js',
        'apps/world/src/player-dimensions.js',
        'apps/world/src/campus-material-profile.js',
        'tools/world-assets/generate-personal-room-chair.mjs',
        'apps/world/tests/item-catalog.test.mjs',
        'apps/world/tests/browser/housing-*.mjs',
        'apps/world/tests/browser/personal-room-*',
        'apps/world/tests/browser/harness-source.mjs'
      ],
      'life-housing': [
        'apps/world/src/rooms/**',
        'apps/world/src/phone/**',
        'apps/world/src/photo/**',
        'apps/world/src/seat-interaction.js',
        'apps/world/src/seat-anchors.js',
        'apps/world/src/context-action.js',
        'apps/world/src/player-dimensions.js',
        'apps/world/src/life-skills/**',
        'apps/world/src/shop/**',
        'apps/world/src/inventory/**',
        'apps/world/src/collection/**',
        'apps/world/src/main.js',
        'apps/world/tests/browser/*seating*',
        'apps/world/tests/browser/personal-room-environment*',
        'apps/world/tests/personal-room-environment.test.mjs',
        'apps/world/tests/browser/*furniture*',
        'apps/world/tests/browser/room-photo-story-*',
        'apps/world/tests/room-photo-story.test.mjs',
        'apps/world/tests/browser/*trophy*',
        'apps/world/tests/browser/*fishing-skill-effects*',
        'apps/world/tests/personal-room-seating.test.mjs',
        'apps/world/tests/furniture-*.test.mjs',
        'apps/world/tests/trophy-display.test.mjs',
        'apps/world/tests/shop-furniture-handoff.test.mjs',
        'apps/world/tests/fishing-skill-effect-labels.test.mjs',
        'apps/world/qa.mjs',
        'apps/world/styles.css',
        'apps/world/phone.css',
        'apps/world/campus/index.html',
        'apps/world/dev-server.mjs'
      ],
      'starter-furniture': [
        'apps/world/src/shop/**',
        'apps/world/src/rooms/**',
        'apps/world/src/main.js',
        'apps/world/tests/starter-furniture-*.test.mjs',
        'apps/world/tests/browser/starter-furniture-*',
        'supabase/migrations/**',
        'supabase/tests/**',
        'docs/ops/sql/20261012_starter_furniture_open.sql',
        'apps/world/tests/browser/dorm-shop-vendor-*',
        'scripts/starter-furniture-browser-local.mjs'
      ],
      'room-transition-recovery': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/rooms/room-transition.js',
        'apps/world/src/rooms/room-world-adapter.js',
        'apps/world/src/rooms/space-fade.js',
        'apps/world/src/main.js',
        'apps/world/tests/room-transition-*.test.mjs',
        'apps/world/tests/space-fade.test.mjs',
        'apps/world/tests/browser/room-transition-recovery-*'
      ],
      'cooking-candidate': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/rooms/cooking-*.js',
        'apps/world/src/rooms/furniture-*.js',
        'apps/world/src/rooms/personal-room-layout.js',
        'apps/world/src/rooms/room-session.js',
        'apps/world/src/player-dimensions.js',
        'apps/world/src/collection/item-catalog.js',
        'apps/world/src/inventory/**',
        'apps/world/src/main.js',
        'apps/world/styles.css',
        'apps/world/dev-server.mjs',
        'apps/world/campus/index.html',
        'apps/world/editor/index.html',
        'apps/world/tests/cooking-*.test.mjs',
        'apps/world/tests/support/fake-dom.mjs',
        'apps/world/tests/browser/cooking-candidate-*',
        'apps/world/tests/browser/harness*.mjs',
        'supabase/migrations/*cooking*'
      ],
      'wardrobe-inventory-retry': [
        'apps/world/src/appearance/wardrobe-panel.js',
        'apps/world/src/appearance/loadout-client.js',
        'apps/world/src/inventory/**',
        'apps/world/src/collection/item-acquisition-guide*',
        'apps/world/tests/inventory-*.test.mjs',
        'apps/world/tests/item-acquisition-guide.test.mjs',
        'apps/world/styles.css',
        'apps/world/tests/wardrobe-panel.test.mjs',
        'apps/world/tests/panel-keyboard-focus.test.mjs',
        'apps/world/tests/browser/wardrobe-inventory-retry-*'
      ]
    })
  })
});

export const outputKey = suite => suite.replaceAll('-', '_');
export function runAllPaths(groupId) {
  const group = GROUPS[groupId];
  return group ? [...SHARED_PATHS, ...COMMON_INFRA, '.github/workflows/' + group.workflow] : null;
}
// Every path the group workflow must list under `on.pull_request.paths`.
export function triggerPaths(groupId) {
  const group = GROUPS[groupId];
  if (!group) return null;
  return [...new Set([...Object.values(group.suites).flat(), ...runAllPaths(groupId)])];
}

const everySuite = (group, reason) => ({
  mode: 'all', reason,
  suites: Object.fromEntries(Object.keys(group.suites).map(suite => [suite, true]))
});
export function select(groupId, files) {
  const group = GROUPS[groupId];
  if (!group) return null;
  if (!Array.isArray(files) || files.length === 0 ||
      files.some(file => typeof file !== 'string' || !file || file.includes('\0')))
    return everySuite(group, 'empty-or-invalid-changes');
  const runAll = runAllPaths(groupId);
  if (files.some(file => runAll.some(pattern => matchPath(pattern, file))))
    return everySuite(group, 'shared-or-ci-path');
  const suites = Object.fromEntries(Object.entries(group.suites).map(([suite, patterns]) =>
    [suite, files.some(file => patterns.some(pattern => matchPath(pattern, file)))]));
  // The workflow only triggers on declared paths, so "nothing matched" means this
  // script and the workflow disagree. Do not turn that into a silent skip.
  if (!Object.values(suites).some(Boolean)) return everySuite(group, 'no-suite-matched');
  return { mode: 'selected', reason: 'suite-paths', suites };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export function inspect(groupId, env = process.env, runGit = git) {
  const group = GROUPS[groupId];
  if (!group) return null;
  const base = env.CI_BASE_SHA, head = env.CI_HEAD_SHA;
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? ''))
    return everySuite(group, 'unknown-sha');
  try {
    if (runGit('rev-parse', 'HEAD').trim() !== head) return everySuite(group, 'head-mismatch');
    // Same comparison GitHub uses for `paths`: the PR's own changes since it left base.
    const fork = runGit('merge-base', base, head).trim();
    if (!/^[0-9a-f]{40}$/.test(fork)) return everySuite(group, 'no-merge-base');
    const changed = runGit('diff', '--no-renames', '--name-only', '-z', fork, head, '--');
    if (!changed || !changed.endsWith('\0')) return everySuite(group, 'empty-or-invalid-diff');
    return select(groupId, changed.slice(0, -1).split('\0'));
  } catch {
    // Shallow history, missing base, malformed diff: run everything.
    return everySuite(group, 'missing-history-or-diff-error');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const groupId = process.argv[2];
  const result = inspect(groupId);
  if (!result) {
    console.error('group-filter: unknown group ' + JSON.stringify(groupId ?? null));
    process.exit(1);
  }
  for (const [suite, run] of Object.entries(result.suites))
    process.stdout.write(outputKey(suite) + '=' + String(run) + '\n');
  process.stdout.write('mode=' + result.mode + '\n');
  const chosen = Object.entries(result.suites).filter(([, run]) => run).map(([suite]) => suite);
  console.error('group-filter: ' + groupId + ' -> ' + result.mode + ' (' + result.reason + '): ' + chosen.join(', '));
}
