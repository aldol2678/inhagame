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
      'life-skill-tree-recovery': 'life-skill-tree-recovery-browser.yml',
      'starter-furniture': 'starter-furniture-browser.yml',
      'room-transition-recovery': 'room-transition-recovery-browser.yml',
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
      'life-skill-tree-recovery': [
        'apps/world/src/life-skills/life-skill-book-*.js',
        'apps/world/tests/life-skill-book.test.mjs',
        'apps/world/styles.css',
        'apps/world/tests/browser/life-skill-tree-recovery-*'
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
  }),
  'phone-photo': Object.freeze({
    workflow: 'world-phone-photo-browser.yml',
    name: 'World phone and photo browser QA',
    legacy: Object.freeze({
      'phone': 'phone-browser.yml',
      'phone-learning': 'phone-learning-browser.yml',
      'photo-mode': 'photo-mode-browser.yml'
    }),
    suites: Object.freeze({
      'phone': [
        'apps/world/src/phone/**',
        'apps/world/src/commissions/**',
        'apps/world/src/quest/quest-journal.js',
        'apps/world/tests/commission-*.test.mjs',
        'apps/world/tests/cooking-trial.test.mjs',
        'apps/world/tests/sample-room-trial*.test.mjs',
        'apps/world/tests/browser/commission-trial-campus-smoke.mjs',
        'apps/world/src/photo/**',
        'apps/world/src/input/**',
        'apps/world/src/minimap/**',
        'apps/world/src/main.js',
        'apps/world/campus/index.html',
        'apps/world/phone.css',
        'apps/world/tests/phone-*.test.mjs',
        'apps/world/tests/browser/phone-campus-smoke.mjs',
        'apps/world/tests/browser/phone-album-manager-smoke.mjs',
        'apps/world/tests/browser/phone-messages-*'
      ],
      'phone-learning': [
        'apps/world/src/learning/**',
        'apps/world/src/learning-web/**',
        'apps/world/learn/**',
        'apps/world/learn.css',
        'apps/world/phone.css',
        'apps/world/dev-server.mjs',
        'apps/world/vercel.json',
        'apps/world/tests/learning-web.test.mjs',
        'apps/world/tests/browser/learning-web-*',
        'apps/world/src/phone/**',
        'apps/world/src/main.js',
        'apps/world/campus/index.html',
        'apps/world/campus/induck-store-v0.2.1.html',
        'apps/world/learning.css',
        'apps/world/tests/phone-*.test.mjs',
        'apps/world/tests/support/learning-*.mjs',
        'apps/world/tests/browser/phone-learning-*',
        'supabase/migrations/*learning*',
        'supabase/tests/**/*learning*',
        'scripts/learning-cloud-local.mjs'
      ],
      'photo-mode': [
        'apps/world/src/phone/smartphone.js',
        'apps/world/src/photo/**',
        'apps/world/src/main.js',
        'apps/world/src/world-collision.js',
        'apps/world/src/player-controller.js',
        'apps/world/src/campus-layout.js',
        'apps/world/src/world-exterior-bounds.js',
        'apps/world/src/main-gate-frame.js',
        'apps/world/src/editor/main-gate-production.js',
        'apps/world/src/student-center-*.js',
        'apps/world/src/orbit-camera-controller.js',
        'apps/world/src/input/**',
        'apps/world/campus/index.html',
        'apps/world/styles.css',
        'apps/world/npc-factory/dev-runtime-state.mjs',
        'apps/world/tests/photo-*.test.mjs',
        'apps/world/tests/inkyung-photo-point.test.mjs',
        'apps/world/tests/world-bounds-boot-order.test.mjs',
        'apps/world/tests/browser/ipad-webkit-boot-smoke.mjs',
        'apps/world/tests/browser/photo-mode-*'
      ]
    })
  }),
  'campus-map': Object.freeze({
    workflow: 'world-campus-map-browser.yml',
    name: 'World campus and map browser QA',
    legacy: Object.freeze({
      'campus-terrain': 'campus-terrain-browser.yml',
      'campus-visual-parity': 'campus-visual-parity-browser.yml',
      'full-map-readability': 'full-map-readability-browser.yml',
      'mounted-photo-maps': 'mounted-photo-maps-browser.yml',
      'student-center-campus': 'student-center-campus-browser.yml'
    }),
    suites: Object.freeze({
      'campus-terrain': [
        'apps/world/src/campus-terrain*.js',
        'apps/world/src/campus-chunk-renderer.js',
        'apps/world/tests/campus-terrain.test.mjs',
        'apps/world/tests/campus-terrain-diagnostic.test.mjs',
        'apps/world/tests/browser/campus-terrain-smoke.mjs',
        'apps/world/tests/browser/campus-terrain-baseline-control.mjs'
      ],
      'campus-visual-parity': [
        'apps/world/src/back-alley-geometry.js',
        'apps/world/src/library-garden-geometry.js',
        'apps/world/src/stadium-stands-geometry.js',
        'apps/world/src/pond-surroundings-geometry.js',
        'apps/world/src/heidegger-forest-geometry.js',
        'apps/world/src/matching-tree-layout.js',
        'apps/world/src/matching-tree-geometry.js',
        'apps/world/src/seat-anchors.js',
        'apps/world/data/reality/campus-facilities.json',
        'apps/world/data/reality/matching-tree-placement.provenance.json',
        'apps/world/tests/matching-tree*.test.mjs',
        'apps/world/tests/browser/matching-tree-*.mjs',
        'apps/world/src/facility-blockout.js',
        'apps/world/src/campus-material-profile.js',
        'apps/world/tests/heidegger-forest*.test.mjs',
        'apps/world/tests/browser/heidegger-forest-*.mjs',
        'apps/world/src/main-hall-walkway-*.js',
        'apps/world/src/campus-chunk-renderer.js',
        'apps/world/src/campus-grounds.js',
        'apps/world/src/navigation/campus-navigation.js',
        'apps/world/src/minimap/minimap-data.js',
        'apps/world/tests/pond-surroundings.test.mjs',
        'apps/world/tests/main-hall-walkways.test.mjs',
        'apps/world/tests/campus-surroundings-walking.test.mjs',
        'apps/world/tests/browser/campus-surroundings-*.mjs',
        'apps/world/tests/*visual-parity*',
        'apps/world/tests/library-garden-geometry.test.mjs',
        'apps/world/tests/back-alley-geometry-contract.test.mjs',
        'apps/world/tests/browser/campus-visual-parity-*'
      ],
      'full-map-readability': [
        'apps/world/src/minimap/**',
        'apps/world/src/navigation/**',
        'apps/world/campus/index.html',
        'apps/world/styles.css',
        'apps/world/tests/full-map*.test.mjs',
        'apps/world/tests/mobile-full-map-portrait.test.mjs',
        'apps/world/tests/navigation-map-ui.test.mjs',
        'apps/world/tests/browser/full-map-*'
      ],
      'mounted-photo-maps': [
        'apps/world/src/photo/**',
        'apps/world/src/phone/**',
        'apps/world/src/minimap/**',
        'apps/world/src/main.js',
        'apps/world/src/player-controller.js',
        'apps/world/src/character-model.js',
        'apps/world/src/orbit-camera-controller.js',
        'apps/world/src/input/**',
        'apps/world/src/world-collision.js',
        'apps/world/src/campus-layout.js',
        'apps/world/src/world-exterior-bounds.js',
        'apps/world/src/main-gate-frame.js',
        'apps/world/src/editor/main-gate-production.js',
        'apps/world/src/student-center-*.js',
        'apps/world/npc-factory/dev-runtime-state.mjs',
        'apps/world/src/mounts/campus-bike-world.js',
        'apps/world/src/mounts/duck-boat-motion.js',
        'apps/world/src/mounts/campus-helicopter-world.js',
        'apps/world/campus/index.html',
        'apps/world/phone.css',
        'apps/world/styles.css',
        'apps/world/tests/photo-*.test.mjs',
        'apps/world/tests/inkyung-photo-point.test.mjs',
        'apps/world/tests/world-bounds-boot-order.test.mjs',
        'apps/world/tests/browser/ipad-webkit-boot-smoke.mjs',
        'apps/world/tests/browser/photo-mode-*',
        'apps/world/tests/browser/harness-source.mjs',
        'apps/world/tests/browser/mounted-photo-maps-smoke.mjs'
      ],
      'student-center-campus': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/student-center-*.js',
        'apps/world/src/facility-blockout.js',
        'apps/world/src/campus-chunk-renderer.js',
        'apps/world/src/campus-layout.js',
        'apps/world/src/campus-facilities.js',
        'apps/world/src/campus-render-kit.js',
        'apps/world/src/campus-material-profile.js',
        'apps/world/src/player-controller.js',
        'apps/world/src/player-dimensions.js',
        'apps/world/src/orbit-camera-controller.js',
        'apps/world/src/world-collision.js',
        'apps/world/src/polygon-collision.js',
        'apps/world/src/roadview-layout.js',
        'apps/world/src/lobby/world-resume.js',
        'apps/world/src/environment/night-building-windows.js',
        'apps/world/src/environment/night-window-policy.js',
        'apps/world/src/main.js',
        'apps/world/campus/index.html',
        'apps/world/tests/student-center-*.test.mjs',
        'apps/world/tests/browser/student-center-*',
        'apps/world/tests/browser/package.json',
        'apps/world/tests/browser/package-lock.json'
      ]
    })
  }),
  biryong: Object.freeze({
    workflow: 'world-biryong-browser.yml',
    name: 'World Biryong browser QA',
    legacy: Object.freeze({
      'biryong-cloud-sync': 'biryong-cloud-sync-browser.yml',
      'biryong-main-control': 'biryong-main-control-browser.yml',
      'biryong-map-guidance': 'biryong-map-guidance-browser.yml'
    }),
    suites: Object.freeze({
      'biryong-cloud-sync': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/biryong/biryong-cloud-*.js',
        'apps/world/src/biryong/biryong-system.js',
        'apps/world/src/biryong/biryong-state.js',
        'apps/world/src/main.js',
        'apps/world/styles.css',
        'apps/world/tests/biryong-cloud-*.test.mjs',
        'apps/world/tests/browser/biryong-cloud-sync-*'
      ],
      'biryong-main-control': [
        'apps/world/src/biryong/**',
        'apps/world/src/graphics-presets.js',
        'apps/world/src/campus-render-kit.js',
        'apps/world/src/environment/environment-director.js',
        'apps/world/src/environment/environment-presets.js',
        'apps/world/tests/browser/biryong-control-*.mjs',
        'apps/world/tests/browser/biryong-performance-*.mjs',
        'apps/world/tests/browser/biryong-ci-gate.mjs',
        'apps/world/tests/biryong-control-diagnostic.test.mjs',
        'apps/world/tests/biryong-performance-*.test.mjs',
        'apps/world/tests/browser/harness*.mjs'
      ],
      'biryong-map-guidance': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/biryong/**',
        'apps/world/src/lobby/**',
        'apps/world/src/minimap/**',
        'apps/world/src/navigation/**',
        'apps/world/src/main.js',
        'apps/world/src/player-controller.js',
        'apps/world/src/orbit-camera-controller.js',
        'apps/world/src/input-focus*',
        'apps/world/src/world-loading*',
        'apps/world/npc-factory/**',
        'apps/world/campus/index.html',
        'apps/world/styles.css',
        'apps/world/dev-server.mjs',
        'apps/world/tests/biryong-*.test.mjs',
        'apps/world/tests/browser/biryong-map-guidance-*',
        'apps/world/tests/browser/biryong-resume-smoke.mjs',
        'apps/world/tests/browser/biryong-camera-null-smoke.mjs'
      ]
    })
  }),
  'npc-shop': Object.freeze({
    workflow: 'world-npc-shop-browser.yml',
    name: 'World NPC and shop browser QA',
    legacy: Object.freeze({
      'npc-c04-living': 'npc-c04-living-browser.yml',
      'npc-shop-routing': 'npc-shop-routing-browser.yml',
      'shop-panel-focus': 'shop-panel-focus-browser.yml'
    }),
    suites: Object.freeze({
      'npc-c04-living': [
        'apps/world/npc-factory/**',
        'apps/world/src/seat-anchors.js',
        'apps/world/src/photo/inkyung-photo-point.js',
        'apps/world/src/life-props.js',
        'apps/world/tests/npc-c04*.test.mjs',
        'apps/world/tests/browser/npc-c04-*.mjs',
        'apps/world/tests/browser/npc-campus-life-diversity-smoke.mjs',
        'apps/world/tests/browser/harness*.mjs'
      ],
      'npc-shop-routing': [
        '.github/ci/phone-surface-scope*.mjs',
        '.github/ci/seo-only-scope*.mjs',
        'apps/world/src/shop/**',
        'apps/world/src/main.js',
        'apps/world/npc-factory/dev-runtime.mjs',
        'apps/world/src/student-center-*.js',
        'apps/world/src/rooms/dorm1-lobby-*.js',
        'apps/world/tests/shop-*.test.mjs',
        'apps/world/tests/student-center-vendors.test.mjs',
        'apps/world/tests/browser/npc-shop-*',
        'apps/world/tests/browser/shop-furniture-*',
        'apps/world/tests/browser/harness*.mjs',
        'apps/world/tests/browser/student-center-campus-smoke.mjs'
      ],
      'shop-panel-focus': [
        'apps/world/src/shop/**',
        'apps/world/src/rooms/furniture*.js',
        'apps/world/src/campus-render-kit.js',
        'apps/world/assets/furniture/**',
        'apps/world/src/collection/item-catalog.js',
        'apps/world/styles.css',
        'apps/world/tests/shop-panel*.test.mjs',
        'apps/world/tests/browser/shop-panel-focus-*',
        'apps/world/tests/browser/furniture-showroom-*',
        'apps/world/tests/furniture-shop-showroom.test.mjs',
        'apps/world/tests/furniture-shop-preview-lifecycle.test.mjs',
        'apps/world/tests/browser/furniture-preview-ownership.test.mjs'
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
