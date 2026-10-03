// Documentation fast path for Public local checks. Unknown scope always runs full verification.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DOC_FILES = new Set([
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE.md', 'LICENSE',
  '.github/pull_request_template.md',
]);

export function isDocs(file) {
  return typeof file === 'string' && (DOC_FILES.has(file)
    || /^\.github\/ISSUE_TEMPLATE\/[^/\r\n]+\.md$/.test(file));
}

export function classify(files) {
  return Array.isArray(files) && files.length > 0 && files.every(isDocs) ? 'docs' : 'full';
}

const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

// -z preserves whitespace/newlines; --no-renames includes both old and new paths.
function diffFiles(base) {
  const output = git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD', '--');
  if (!output || !output.endsWith('\0')) return null;
  return output.slice(0, -1).split('\0');
}

export function changedFiles(env = process.env) {
  try {
    if (env.CI_EVENT === 'pull_request') {
      // Default checkout uses the synthetic merge commit; first parent is its base.
      const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/);
      if (parents.length !== 3) return null;
      return diffFiles('HEAD^1');
    }
    if (env.CI_EVENT === 'push') {
      const before = env.CI_BEFORE ?? '';
      if (!/^[0-9a-f]{40}$/.test(before) || /^0+$/.test(before)) return null;
      try {
        git('cat-file', '-e', before + '^{commit}');
      } catch {
        git('fetch', '--quiet', '--no-tags', '--depth=1', 'origin', before);
      }
      return diffFiles(before);
    }
  } catch {
    // Missing history, fetch failure, invalid checkout, or diff failure: full verification.
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = changedFiles();
  const mode = classify(files);
  console.log('mode=' + mode);
  console.error('public-ci-scope: ' + mode + ' (' +
    (files === null ? 'unknown or empty change set' : files.length + ' changed file(s)') + ')');
}
