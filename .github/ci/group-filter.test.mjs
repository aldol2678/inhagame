import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, SHARED_PATHS, select, inspect, triggerPaths, runAllPaths, outputKey } from './group-filter.mjs';
import { declaredPaths, matchPath } from './phone-surface-scope.mjs';

const chosen = result => Object.entries(result.suites).filter(([, run]) => run).map(([suite]) => suite);
const all = id => Object.keys(GROUPS[id].suites);
const workflow = id => readFileSync(new URL('../workflows/' + GROUPS[id].workflow, import.meta.url), 'utf8');

test('a suite-only change selects only the suites that declare the path', () => {
  assert.deepEqual(chosen(select('places', ['apps/world/src/culture-street-signs.js'])), ['backgate-shopfront']);
  assert.deepEqual(chosen(select('places', ['apps/world/tests/browser/north-walkway-smoke.mjs'])), ['north-walkway']);
  assert.deepEqual(chosen(select('places', ['apps/world/src/jeongseok/access.js'])), ['jeongseok-gate', 'jeongseok-interior']);
  assert.deepEqual(chosen(select('places', ['apps/world/src/back-street-geometry.js'])), ['backgate-shopfront', 'backgate-restoration']);
  // north-* is claimed by the landmark suite; walkway files belong to both.
  assert.deepEqual(chosen(select('places', ['apps/world/src/north-walkway-paving.js'])), ['north-landmark', 'north-walkway']);
  assert.equal(select('places', ['apps/world/src/culture-street-signs.js']).mode, 'selected');
});

test('shared test infrastructure and CI plumbing run the whole group', () => {
  for (const file of ['apps/world/tests/browser/package.json', 'apps/world/tests/browser/package-lock.json',
    'apps/world/tests/browser/harness.mjs', '.github/workflows/world-places-browser.yml',
    '.github/ci/group-filter.mjs', '.github/ci/phone-surface-scope.mjs',
    '.github/actions/setup-world-browser/action.yml']) {
    const result = select('places', [file]);
    assert.equal(result.mode, 'all', file);
    assert.deepEqual(chosen(result), all('places'), file);
  }
  // A shared file next to a suite file still runs everything.
  assert.deepEqual(chosen(select('places', ['apps/world/src/culture-street-signs.js', 'apps/world/tests/browser/harness.mjs'])), all('places'));
});

test('main.js runs only the suites whose original workflow declared it', () => {
  assert.deepEqual(chosen(select('places', ['apps/world/src/main.js'])), ['jeongseok-interior']);
  assert.deepEqual(chosen(select('places', ['apps/world/src/main.js', 'apps/world/src/roadview-details.js'])),
    ['jeongseok-interior', 'north-landmark']);
});

test('unknown or malformed input never skips a suite', () => {
  for (const files of [[], null, undefined, [''], [42], ['a\0b'], ['docs/readme.md'], ['apps/world/styles.css']])
    assert.deepEqual(chosen(select('places', files)), all('places'), JSON.stringify(files));
  assert.equal(select('nope', ['x']), null);
  assert.equal(inspect('nope'), null);
});

test('inspect compares against the merge base and fails closed', () => {
  const head = 'a'.repeat(40), base = 'b'.repeat(40), fork = 'c'.repeat(40);
  const env = { CI_BASE_SHA: base, CI_HEAD_SHA: head };
  const calls = [];
  const fake = out => (...args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse') return head + '\n';
    if (args[0] === 'merge-base') return fork + '\n';
    return out;
  };
  assert.deepEqual(chosen(inspect('places', env, fake('apps/world/src/roadview-details.js\0'))), ['north-landmark']);
  assert.ok(calls.includes('merge-base ' + base + ' ' + head));
  assert.ok(calls.some(call => call.startsWith('diff --no-renames --name-only -z ' + fork + ' ' + head)));
  assert.deepEqual(chosen(inspect('places', env, fake(''))), all('places'));
  assert.deepEqual(chosen(inspect('places', env, fake('no-terminator'))), all('places'));
  assert.deepEqual(chosen(inspect('places', env, () => { throw new Error('shallow'); })), all('places'));
  assert.deepEqual(chosen(inspect('places', { CI_BASE_SHA: base }, fake('x\0'))), all('places'));
  assert.deepEqual(chosen(inspect('places', { ...env, CI_HEAD_SHA: 'short' }, fake('x\0'))), all('places'));
  assert.deepEqual(chosen(inspect('places', env, (...args) => args[0] === 'rev-parse' ? 'd'.repeat(40) : 'x\0')), all('places'));
});

for (const id of Object.keys(GROUPS)) {
  // While the original workflows still exist: whatever made one of them run must
  // still select its suite. Guards against a trigger vanishing from both the new
  // workflow and the filter at once. Remove a `legacy` entry with its workflow file.
  test(id + ': no original trigger was dropped', () => {
    const legacy = GROUPS[id].legacy ?? {};
    assert.deepEqual(Object.keys(legacy).sort(), all(id).sort());
    for (const [suite, file] of Object.entries(legacy)) {
      const text = readFileSync(new URL('../workflows/' + file, import.meta.url), 'utf8');
      const original = declaredPaths(text, text.split('\n')[0].slice('name: '.length));
      assert.ok(original, file + ' paths must be parseable');
      for (const pattern of original) {
        if (pattern === '.github/workflows/' + file) continue;
        assert.ok(GROUPS[id].suites[suite].includes(pattern) || runAllPaths(id).includes(pattern),
          suite + ' lost trigger ' + pattern);
        // Same pattern text selects the same files; probe one concrete path too.
        const probe = pattern.replaceAll('**', 'x/y').replaceAll('*', 'x');
        assert.ok(matchPath(pattern, probe), pattern);
        assert.equal(select(id, [probe]).suites[suite], true, suite + ' not selected for ' + probe);
      }
    }
  });

  test(id + ': workflow triggers match the filter exactly', () => {
    const declared = declaredPaths(workflow(id), GROUPS[id].name);
    assert.ok(declared, 'paths block must be parseable');
    assert.deepEqual([...declared].sort(), [...triggerPaths(id)].sort());
    assert.equal(new Set(declared).size, declared.length);
    for (const shared of SHARED_PATHS) assert.ok(runAllPaths(id).includes(shared));
    assert.ok(!SHARED_PATHS.includes('apps/world/src/main.js'));
  });

  test(id + ': every suite has one fail-closed job and a unique artifact', () => {
    const text = workflow(id);
    const artifacts = [];
    for (const suite of all(id)) {
      const key = outputKey(suite);
      assert.ok(text.includes('      ' + key + ': ${{ steps.filter.outputs.' + key + ' }}'), suite + ' output');
      const start = text.indexOf('\n  ' + suite + ':\n');
      assert.ok(start > 0, suite + ' job');
      const next = text.slice(start + 1).search(/\n  [a-z0-9-]+:\n/);
      const job = text.slice(start, next < 0 ? undefined : start + 1 + next);
      assert.ok(job.includes("    if: ${{ !cancelled() && needs.select.outputs." + key + " != 'false' }}"), suite + ' gate');
      assert.ok(job.includes('    needs: select\n'), suite + ' needs');
      // A suite that also supports manual runs falls back to the dispatched commit.
      assert.match(job, /ref: \$\{\{ github\.event\.pull_request\.head\.sha(?: \|\| github\.sha)? \}\}/, suite + ' exact head');
      assert.ok(job.includes('uses: ./.github/actions/setup-world-browser'), suite + ' shared setup');
      const name = job.match(/uses: actions\/upload-artifact@v4[\s\S]*?\n          name: (.+)\n/);
      assert.ok(name, suite + ' artifact');
      artifacts.push(name[1]);
    }
    assert.equal(new Set(artifacts).size, artifacts.length);
    assert.match(text, /\nconcurrency:\n  group: [a-z-]+-\$\{\{ github\.event\.pull_request\.number(?: \|\| github\.ref)? \}\}\n  cancel-in-progress: true\n/);
  });
}
