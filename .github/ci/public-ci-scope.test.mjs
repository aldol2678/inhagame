import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './public-ci-scope.mjs';

const cli = fileURLToPath(new URL('./public-ci-scope.mjs', import.meta.url));
const cases = [
  ['unknown', null, 'full'],
  ['empty', [], 'full'],
  ['root documents', ['README.md', 'LICENSE', 'NOTICE.md', 'CONTRIBUTING.md', 'SECURITY.md'], 'docs'],
  ['PR and issue templates', ['.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/bug_report.md'], 'docs'],
  ['mixed source', ['README.md', 'apps/world/src/main.js'], 'full'],
  ['SQL', ['supabase/migrations/20261003000000_x.sql'], 'full'],
  ['database integration helper', ['scripts/local-integration.mjs'], 'full'],
  ['workflow', ['.github/workflows/public-ci.yml'], 'full'],
  ['scope implementation', ['.github/ci/public-ci-scope.mjs'], 'full'],
  ['scope tests', ['.github/ci/public-ci-scope.test.mjs'], 'full'],
  ['dependency lock', ['apps/induckup/package-lock.json'], 'full'],
  ['TML design Markdown', ['apps/world/tml/design/P5_VERIFIED_WRITE_RUNTIME.md'], 'full'],
  ['arbitrary docs script', ['docs/tool.mjs'], 'full'],
  ['arbitrary docs Markdown', ['docs/design.md'], 'full'],
  ['whitespace is preserved', [' README.md'], 'full'],
  ['newline path is not a template', ['.github/ISSUE_TEMPLATE/a\nb.md'], 'full'],
  ['nested issue source', ['.github/ISSUE_TEMPLATE/tool/main.md'], 'full'],
  ['invalid file list', ['README.md', null], 'full'],
];
for (const [name, files, expected] of cases) {
  test(name, () => assert.equal(classify(files), expected));
}

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'public-ci-scope-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Local CI Test');
  git('config', 'user.email', 'ci-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (message) => { git('add', '-A'); git('commit', '--quiet', '-m', message); return git('rev-parse', 'HEAD'); };
  write('README.md', 'base\n');
  write('apps/world/src/example.js', 'export const value = 1;\n');
  const base = commit('baseline');
  return { dir, git, write, commit, base };
}
function run(dir, event, before) {
  const result = spawnSync(process.execPath, [cli], {
    cwd: dir,
    env: { ...process.env, CI_EVENT: event, CI_BEFORE: before ?? '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^mode=(docs|full)\n$/);
  return result.stdout.trim();
}

test('push with only README changes chooses docs', (t) => {
  const r = repo(t); r.write('README.md', 'updated\n'); r.commit('docs');
  assert.equal(run(r.dir, 'push', r.base), 'mode=docs');
});
test('mixed docs and code push chooses full', (t) => {
  const r = repo(t); r.write('README.md', 'updated\n'); r.write('apps/world/src/example.js', 'export const value = 2;\n'); r.commit('mixed');
  assert.equal(run(r.dir, 'push', r.base), 'mode=full');
});
test('PR merge diff excludes changes already in the base', (t) => {
  const r = repo(t);
  r.git('checkout', '--quiet', '-b', 'docs-pr');
  r.write('README.md', 'PR docs\n'); r.commit('PR docs');
  r.git('checkout', '--quiet', 'main');
  r.write('apps/world/src/example.js', 'export const value = 2;\n'); r.commit('base advanced');
  r.git('merge', '--quiet', '--no-ff', 'docs-pr', '-m', 'synthetic PR merge');
  assert.equal(run(r.dir, 'pull_request'), 'mode=docs');
});
test('PR merge containing source changes chooses full', (t) => {
  const r = repo(t);
  r.git('checkout', '--quiet', '-b', 'code-pr');
  r.write('apps/world/src/example.js', 'export const value = 3;\n'); r.commit('PR code');
  r.git('checkout', '--quiet', 'main'); r.git('merge', '--quiet', '--no-ff', 'code-pr', '-m', 'PR merge');
  assert.equal(run(r.dir, 'pull_request'), 'mode=full');
});
test('PR checkout without two parents chooses full', (t) => {
  const r = repo(t); assert.equal(run(r.dir, 'pull_request'), 'mode=full');
});
test('empty diff chooses full', (t) => {
  const r = repo(t); assert.equal(run(r.dir, 'push', r.base), 'mode=full');
});
test('missing and zero before SHAs choose full', (t) => {
  const r = repo(t);
  assert.equal(run(r.dir, 'push'), 'mode=full');
  assert.equal(run(r.dir, 'push', '0'.repeat(40)), 'mode=full');
  assert.equal(run(r.dir, 'push', 'bad-value'), 'mode=full');
});
test('unavailable history and failed fetch choose full', (t) => {
  const r = repo(t); assert.equal(run(r.dir, 'push', 'f'.repeat(40)), 'mode=full');
});
test('unsupported event chooses full', (t) => {
  const r = repo(t); assert.equal(run(r.dir, 'workflow_dispatch', r.base), 'mode=full');
});
test('source renamed into an allowed document still chooses full', (t) => {
  const r = repo(t);
  r.git('rm', 'README.md');
  r.git('mv', 'apps/world/src/example.js', 'README.md'); r.commit('rename into docs');
  assert.equal(run(r.dir, 'push', r.base), 'mode=full');
});
test('deleted README remains a documentation change', (t) => {
  const r = repo(t); r.git('rm', 'README.md'); r.commit('delete docs');
  assert.equal(run(r.dir, 'push', r.base), 'mode=docs');
});
test('newline in a Git filename cannot split into allowed documents', (t) => {
  const r = repo(t); r.write('README.md\nNOTICE.md', 'not a known document\n'); r.commit('newline filename');
  assert.equal(run(r.dir, 'push', r.base), 'mode=full');
});
test('missing before commit is fetched from a local origin', (t) => {
  const source = repo(t); source.write('README.md', 'new\n'); source.commit('docs');
  const clone = join(source.dir, 'shallow-clone');
  execFileSync('git', ['clone', '--quiet', '--depth=1', 'file://' + source.dir, clone]);
  assert.equal(run(clone, 'push', source.base), 'mode=docs');
});
test('depth-two synthetic PR checkout has the required base parent', (t) => {
  const source = repo(t);
  source.git('checkout', '--quiet', '-b', 'docs-pr'); source.write('README.md', 'PR\n'); source.commit('docs');
  source.git('checkout', '--quiet', 'main'); source.git('merge', '--quiet', '--no-ff', 'docs-pr', '-m', 'merge');
  const clone = join(source.dir, 'pr-clone');
  execFileSync('git', ['clone', '--quiet', '--depth=2', 'file://' + source.dir, clone]);
  assert.equal(run(clone, 'pull_request'), 'mode=docs');
});
test('Git command failure chooses full', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-ci-no-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, 'pull_request'), 'mode=full');
});
