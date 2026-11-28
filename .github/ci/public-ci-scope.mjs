// Documentation fast path for Public local checks.
// Local Supabase database verification was removed 2026-11-28; no database job remains.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isSeoOnly } from './seo-only-scope.mjs';

// Match the browser classifier: release intent or missing PR metadata never skips QA.
const NO_FAST_TITLE = /(?:\brelease\b|\bhotfix\b|릴리스|출시|\[full-ci\])/i;

const DOC_FILES = new Set([
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE.md', 'LICENSE',
  '.github/pull_request_template.md',
]);

export function isDocs(file) {
  return typeof file === 'string' && (DOC_FILES.has(file)
    || /^\.github\/ISSUE_TEMPLATE\/[^/\r\n]+\.md$/.test(file));
}


export function classify(files, { seoOnly = false } = {}) {
  if (Array.isArray(files) && files.length > 0 && files.every(isDocs)) return 'docs';
  return seoOnly ? 'seo' : 'full';
}

// Additive browser routing only: never relax source/database/SEO classification.
export function needsPortalBrowser(files, { forceFull = false } = {}) {
  if (forceFull || !Array.isArray(files) || files.length === 0) return true;
  return files.some(file => typeof file !== 'string' ||
    file === 'apps/world/index.html' ||
    file === 'apps/world/game-catalog.js' ||
    file === 'apps/world/data/game-catalog.json' ||
    file === 'apps/world/scripts/generate-arcade-pages.mjs' ||
    file.startsWith('apps/world/arcade/') ||
    file.startsWith('apps/world/tests/arcade-') ||
    file === 'apps/world/tests/browser/arcade-layout-smoke.mjs' ||
    /^apps\/world\/hub[^/]*\.(?:css|js|mjs)$/.test(file) ||
    file.startsWith('apps/world/assets/hub/') ||
    /^apps\/world\/tests\/(?:browser\/)?hub[^/]*\.mjs$/.test(file) ||
    /^apps\/world\/tests\/browser\/package(?:-lock)?\.json$/.test(file) ||
    /^\.github\/ci\/(?:public-ci-scope|seo-only-scope)(?:\.test)?\.mjs$/.test(file) ||
    file === '.github/workflows/public-ci.yml');
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
  const forceFull = process.env.CI_EVENT === 'pull_request' &&
    (!process.env.CI_PR_TITLE || NO_FAST_TITLE.test(process.env.CI_PR_TITLE));
  // Only PR merge checkouts with a verified base parent may use SEO fast routing.
  // Push, unknown history, or any file outside the strict SEO allowlist run full.
  const oldBlob = (path) => { try { return git('show', 'HEAD^1:' + path); } catch { return null; } };
  const newBlob = (path) => { try { return git('show', 'HEAD:' + path); } catch { return null; } };
  const seoOnly = !forceFull && process.env.CI_EVENT === 'pull_request' && files !== null &&
    isSeoOnly(files, oldBlob, newBlob);
  const mode = forceFull ? 'full' : classify(files, { seoOnly });
  const db = false; // No database job remains (Supabase CI removed 2026-11-28).
  console.log('mode=' + mode);
  console.log('db=' + (db ? 'true' : 'false'));
  console.log('portal_browser=' + (needsPortalBrowser(files, { forceFull }) ? 'true' : 'false'));
  console.error('public-ci-scope: ' + mode + ', db=' + (db ? 'required' : 'skip') + ' (' +
    (files === null ? 'unknown or empty change set' : files.length + ' changed file(s)') + ')');
}
