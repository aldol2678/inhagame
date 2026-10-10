import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vercel treats exit 0 as "skip" and exit 1 as "build".
// On uncertainty, ALWAYS build rather than risk omitting a production change.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;

function build(reason) {
  console.log("[vercel-ignore] Build required: " + reason);
  process.exit(1);
}

function git(...args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function isSkipSafe(file) {
  // Only changes with no runtime/build impact are safe to skip.
  if (file.startsWith('.github/')) return true;
  if (file.startsWith('docs/')) return true;
  if (file.startsWith('apps/world/docs/')) return true;
  if (file.startsWith('apps/world/tests/')) {
    // The production build actually installs/runs this test-scoped Recast package.
    return !file.startsWith('apps/world/tests/recast-runtime/');
  }
  if (/^(README|CONTRIBUTING|NOTICE|SECURITY)\.md$/.test(file)) return true;
  if (file.startsWith('apps/world/') && file.endsWith('.md')) return true;
  return false;
}

if (!previousSha || !/^[0-9a-f]{40}$/i.test(previousSha)) {
  build('previous successful deployment SHA unavailable');
}
const ancestor = git('cat-file', '-e', previousSha + "^{commit}");
if (ancestor.error || ancestor.status !== 0) {
  build('previous deployment commit is not available locally');
}
const changed = git('diff', '--name-only', '-z', '--no-renames', previousSha, 'HEAD', '--');
if (changed.error || changed.status !== 0 || !changed.stdout) {
  build('unable to compare deployment commits');
}
const paths = changed.stdout.toString('utf8').split('\0').filter(Boolean);
const unsafe = paths.find((file) => !isSkipSafe(file));
if (unsafe) build("relevant change: " + unsafe);
console.log("[vercel-ignore] Skip safe: " + paths.length + " documentation/CI/test-only changes");
process.exit(0);
