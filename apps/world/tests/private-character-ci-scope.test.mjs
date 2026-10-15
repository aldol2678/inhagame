import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { AUDITED_INPUTS, classify, eligibleUiPath, inspect } from '../../../.github/ci/private-character-scope.mjs';

const base = '1'.repeat(40), head = '2'.repeat(40), unknown = 'f'.repeat(40);
const inputs = () => Object.fromEntries(Object.entries(AUDITED_INPUTS).map(([path, hashes]) => [path, hashes[0]]));
const options = () => ({ event: 'pull_request', title: 'feat: improve shop labels', beforeInputs: inputs(), afterInputs: inputs() });
const ui = 'apps/world/src/shop/shop-panel.js';
const env = () => ({ CI_EVENT: 'pull_request', CI_PR_TITLE: 'feat: improve shop labels', CI_BASE_SHA: base, CI_HEAD_SHA: head });
function fakeGit({ diff = 'M\0' + ui + '\0', actualHead = head, fail = null, missing = null, changed = null } = {}) {
  return (...args) => {
    if (fail === args[0]) throw Error('fixture missing history');
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return actualHead + '\n';
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args[0] === 'diff') {
      assert.deepEqual(args, ['diff', '--no-renames', '--name-status', '-z', base, head, '--']);
      return diff;
    }
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const [ref, path] = args[2].split(':');
      assert.ok(ref === base || ref === head);
      if (missing === args[2]) throw Error('missing object');
      return (changed === args[2] ? unknown : AUDITED_INPUTS[path][0]) + '\n';
    }
    throw Error('unexpected git command: ' + args.join(' '));
  };
}

test('only audited unrelated UI may omit facial acceptance; common suite remains required', () => {
  for (const path of [ui, 'apps/world/src/phone/phone-notifications.js', 'apps/world/styles.css',
    'apps/world/tests/shop-panel.test.mjs', 'apps/world/tests/browser/phone-menu-smoke.mjs']) {
    assert.deepEqual(classify([path], options()), { full: false, reason: 'audited-unrelated-ui' });
  }
  assert.equal(inspect(env(), fakeGit()).full, false);
});

test('real #406 shared renderer changes remain FULL even with a known ownership-fix fingerprint', () => {
  const files = [
  ".github/workflows/shop-panel-focus-browser.yml",
  "apps/world/src/campus-render-kit.js",
  "apps/world/src/rooms/furniture-renderer.js",
  "apps/world/src/shop/furniture-shop-categories.js",
  "apps/world/src/shop/furniture-shop-preview.js",
  "apps/world/src/shop/shop-panel.js",
  "apps/world/styles.css",
  "apps/world/tests/browser/furniture-preview-ownership.test.mjs",
  "apps/world/tests/browser/furniture-showroom-harness.html",
  "apps/world/tests/browser/furniture-showroom-lifecycle-smoke.mjs",
  "apps/world/tests/browser/furniture-showroom-smoke.mjs",
  "apps/world/tests/browser/furniture-showroom-world-smoke.mjs",
  "apps/world/tests/browser/starter-furniture-input-probe.mjs",
  "apps/world/tests/browser/starter-furniture-smoke.mjs",
  "apps/world/tests/furniture-shop-preview-lifecycle.test.mjs",
  "apps/world/tests/furniture-shop-showroom.test.mjs",
  "apps/world/tests/mobile-landscape-hud.test.mjs",
  "apps/world/tests/shop-panel-browser-workflow.test.mjs",
  "apps/world/tests/starter-furniture-acquisition.test.mjs",
  "apps/world/tests/starter-furniture-input-probe.test.mjs"
];
  const o = options();
  o.afterInputs['apps/world/src/campus-render-kit.js'] = AUDITED_INPUTS['apps/world/src/campus-render-kit.js'].at(-1);
  assert.equal(classify(files, o).full, true);
  assert.equal(classify(['apps/world/src/campus-render-kit.js'], o).full, true);
  assert.equal(inspect(env(), fakeGit({ diff: 'M\0apps/world/src/campus-render-kit.js\0' })).full, true);
});

test('manual, release, hotfix, unknown metadata and explicit full-ci always run full', () => {
  for (const event of ['workflow_dispatch', 'push', '', undefined]) {
    assert.equal(classify([ui], { ...options(), event }).full, true);
    assert.equal(inspect({ ...env(), CI_EVENT: event }, fakeGit()).full, true);
  }
  for (const title of ['', ' ', undefined, 'release: ship', 'HOTFIX: urgent', '출시 확인', '릴리스', 'feat: UI [full-ci]']) {
    assert.equal(classify([ui], { ...options(), title }).full, true);
    assert.equal(inspect({ ...env(), CI_PR_TITLE: title }, fakeGit()).full, true);
  }
});

test('unknown/shared/mixed paths and invalid path spelling cannot opt out', () => {
  for (const path of ['apps/world/src/main.js', 'apps/world/src/character-model.js',
    'apps/world/src/appearance/equipment-anchors.js', 'apps/world/src/input/focus.js',
    'apps/world/tests/browser/harness.mjs', 'apps/world/tests/browser/package-lock.json',
    'apps/world/api/brand-asset.js', '.github/ci/private-character-scope.mjs',
    'apps/world/campus/index.html', 'apps/world/src/shop/../character-model.js',
    'apps/world/src/shop/a.js\nother', 'apps/world/src/shop/a.js\0', 'apps\\world\\src\\shop\\a.js']) {
    assert.equal(eligibleUiPath(path), false, path);
    assert.equal(classify([ui, path], options()).full, true, path);
  }
  for (const files of [[], null, [ui, ui], [null]]) assert.equal(classify(files, options()).full, true);
});

test('base AND head dependency identities are required: union cannot omit either side', () => {
  for (const side of ['beforeInputs', 'afterInputs']) {
    for (const path of Object.keys(AUDITED_INPUTS)) {
      const o = options(); o[side][path] = unknown;
      assert.equal(classify([ui], o).full, true, side + ':' + path);
      delete o[side][path];
      assert.equal(classify([ui], o).full, true, 'missing ' + side + ':' + path);
    }
  }
  const path = 'apps/world/src/character-model.js';
  for (const ref of [base, head]) {
    assert.equal(inspect(env(), fakeGit({ changed: ref + ':' + path })).full, true);
    assert.equal(inspect(env(), fakeGit({ missing: ref + ':' + path })).full, true);
  }
});

test('exact head, ancestry, history and NUL status validation fail closed', () => {
  assert.equal(inspect(env(), fakeGit({ actualHead: unknown })).reason, 'head-mismatch');
  for (const key of ['CI_BASE_SHA', 'CI_HEAD_SHA']) {
    for (const value of ['', 'main', '0'.repeat(40), 'deadbeef']) assert.equal(inspect({ ...env(), [key]: value }, fakeGit()).full, true);
  }
  for (const fail of ['cat-file', 'merge-base', 'diff', 'rev-parse']) assert.equal(inspect(env(), fakeGit({ fail })).full, true);
  for (const diff of ['', 'M\0' + ui, 'M\0', 'D\0' + ui + '\0', 'R100\0old\0' + ui + '\0', 'T\0' + ui + '\0', 'M\0' + ui + '\0M\0' + ui + '\0']) {
    assert.equal(inspect(env(), fakeGit({ diff })).full, true);
  }
  assert.equal(inspect(env(), fakeGit({ diff: 'A\0apps/world/src/shop/new-panel.js\0' })).full, false);
});

test('audited manifest includes indirect renderer/data/server/import-map inputs and immutable fingerprints', () => {
  for (const path of ['apps/world/src/campus-render-kit.js', 'apps/world/src/campus-material-profile.js',
    'apps/world/src/seat-anchors.js', 'apps/world/src/mounts/campus-balloon-render.js',
    'apps/world/src/collection/item-catalog.js', 'apps/world/src/network/npc-talk-presence.js',
    'apps/world/data/reality', 'apps/world/data/reality/campus-landmarks.json', 'apps/world/data/editor/main-gate.world.json',
    'apps/world/tests/browser/annyongi-review-harness.html', 'apps/world/tests/browser/annyongi-face-metrics.mjs',
    'apps/world/tests/browser/harness.mjs', 'apps/world/tests/browser/harness-source.mjs',
    'apps/world/tests/browser/package.json', 'apps/world/tests/browser/package-lock.json',
    'apps/world/campus/index.html', 'apps/world/editor/index.html', 'apps/world/dev-server.mjs',
    'apps/world/npc-factory', 'apps/world/model-converter', 'tools/world-assets',
    'apps/world/api/brand-asset.js', 'apps/world/vercel.json',
    '.github/workflows/private-character-acceptance.yml']) {
    assert.ok(AUDITED_INPUTS[path]?.length, path);
  }
  for (const hashes of Object.values(AUDITED_INPUTS)) assert.ok(hashes.every(hash => /^[0-9a-f]{40}$/.test(hash)));
});

test('facial-only workflow condition preserves every common acceptance command and privacy boundary', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/private-character-acceptance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /private-character-browser:\n    runs-on: ubuntu-latest\n    timeout-minutes: 60/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /pull_request:\n    types: \[opened, synchronize, reopened, edited\]/);
  assert.match(workflow, /CI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /CI_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /run: node --test apps\/world\/tests\/private-character-ci-scope\.test\.mjs/);
  const steps = workflow.split(/\n      - name: /);
  const facial = steps.find(step => step.startsWith('Full facial contrast and measured-continuity regression\n'));
  assert.match(facial, /if: steps\.face-scope\.outputs\.full != 'false'/);
  assert.match(facial, /timeout-minutes: 35/);
  assert.match(facial, /ANNYONGI_FACE_PROFILE: acceptance/);
  assert.match(facial, /node apps\/world\/tests\/browser\/annyongi-face-diagnostic\.mjs/);
  assert.equal((workflow.match(/if: steps\.face-scope/g) ?? []).length, 1);
  for (const name of ['Download approved private assets and verify exact bytes', 'Audit exact private facial surface separation',
    'Real asset lifecycle and mount regression', 'Install Chromium',
    'Browser ownership, six states, optimization parity and actual campus inputs', 'Optimized bytes in actual primary game route']) {
    const step = steps.find(value => value.startsWith(name + '\n')); assert.ok(step, name);
    assert.doesNotMatch(step, /\n        if:/, name + ' cannot be scope-skipped');
  }
  for (const command of [
    'node --test apps/world/tests/character-model-loading.test.mjs apps/world/tests/photo-mounted.test.mjs apps/world/tests/browser/character-model-loading-runtime.test.mjs',
    'node apps/world/tests/browser/annyongi-color-smoke.mjs',
    'node apps/world/tests/browser/annyongi-capture.mjs',
    'node apps/world/tests/browser/annyongi-flight-pose-capture.mjs']) assert.ok(workflow.includes(command), command);
  for (const command of ['node apps/world/tests/browser/character-model-loading-smoke.mjs', 'node apps/world/tests/browser/annyongi-campus-smoke.mjs']) {
    assert.equal(workflow.split(command).length - 1, 2, 'canonical and optimized both retained');
  }
  assert.match(workflow, /NOT_RUN_SCOPE/);
  assert.match(workflow, /commonSuites:"REQUIRED"/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /sha256sum --check/);
  for (const step of steps.filter(value => value.startsWith('Upload '))) {
    assert.match(step, /if: always\(\)/);
    assert.ok(step.includes('face-scope.json'));
    assert.doesNotMatch(step, /\.png|\.glb|\*\*/);
  }
  const html = readFileSync(new URL('./browser/annyongi-review-harness.html', import.meta.url), 'utf8');
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /styles\.css|rel=["']stylesheet/);
});

test('computed reality JSON additions/edits/removals invalidate either tree snapshot', () => {
  const tree = 'apps/world/data/reality';
  assert.ok(AUDITED_INPUTS[tree]?.length);
  for (const side of ['beforeInputs', 'afterInputs']) {
    const o = options(); o[side][tree] = unknown;
    assert.equal(classify([ui], o).reason, 'unaudited-base-or-head-dependency');
    delete o[side][tree];
    assert.equal(classify([ui], o).reason, 'unaudited-base-or-head-dependency');
  }
  // The parent tree covers dynamically computed reads, not just the two literal JSON roots.
  for (const suffix of ['campus-facilities.json', 'campus-buildings.json', 'campus-site.json',
    'evidence/roads/library-garden.json', 'evidence/roads/back-gate.json',
    'evidence/roads/back-approaches.json', 'evidence/roads/source.json',
    'evidence/roads/back-west-buildings.json']) {
    assert.equal(classify([tree + '/' + suffix], options()).full, true);
  }
});

test('native temporary Git validates NUL statuses, rename/deletion and real ancestry', t => {
  const dir = mkdtempSync(join(tmpdir(), 'private-character-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(dir, 'absent-global-config'),
    GIT_AUTHOR_NAME: 'Scope fixture', GIT_AUTHOR_EMAIL: 'scope@example.invalid',
    GIT_COMMITTER_NAME: 'Scope fixture', GIT_COMMITTER_EMAIL: 'scope@example.invalid' };
  const realGit = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + join(dir, 'disabled-hooks'),
    '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  realGit('-c', 'init.templateDir=', 'init', '--initial-branch=main');
  const target = join(dir, ui), renamed = 'apps/world/src/shop/renamed-panel.js';
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'export const label = "before";\n');
  writeFileSync(join(dir, 'fixture-marker'), 'isolated test repo\n');
  const commit = message => { realGit('add', '--all'); realGit('commit', '--quiet', '-m', message); return realGit('rev-parse', 'HEAD').trim(); };
  const first = commit('base');
  writeFileSync(target, 'export const label = "after";\n');
  const second = commit('modify UI');
  const nativeEnv = (from, to) => ({ ...env(), CI_BASE_SHA: from, CI_HEAD_SHA: to });
  // Only the independent audited dependency identities are fixture-provided. Actual HEAD,
  // ancestry, --no-renames and NUL status parsing use this real temporary Git repository.
  const withAuditedInputs = (...args) => args[0] === 'rev-parse' && args[1] === '--verify'
    ? AUDITED_INPUTS[args[2].slice(41)]?.[0] + '\n' : realGit(...args);
  assert.equal(realGit('diff', '--no-renames', '--name-status', '-z', first, second, '--'), 'M\0' + ui + '\0');
  assert.equal(inspect(nativeEnv(first, second), withAuditedInputs).full, false);
  assert.equal(inspect(nativeEnv(first, first), withAuditedInputs).reason, 'head-mismatch');

  renameSync(target, join(dir, renamed));
  const third = commit('rename UI');
  assert.ok(realGit('diff', '--no-renames', '--name-status', '-z', second, third, '--').includes('D\0' + ui + '\0'));
  assert.equal(inspect(nativeEnv(second, third), withAuditedInputs).reason, 'unsafe-file-change');

  rmSync(join(dir, renamed));
  const fourth = commit('delete UI');
  assert.equal(inspect(nativeEnv(third, fourth), withAuditedInputs).reason, 'unsafe-file-change');

  realGit('checkout', '--quiet', '--orphan', 'unrelated-history');
  const unrelated = commit('independent root');
  assert.equal(inspect(nativeEnv(fourth, unrelated), withAuditedInputs).reason, 'missing-history-or-dependency');
});
