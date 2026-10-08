// Documentation fast path and conservative local-database routing for Public local checks.
// Unknown scope always runs full verification, including the local Supabase stack.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DOC_FILES = new Set([
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE.md', 'LICENSE',
  '.github/pull_request_template.md',
]);

const DB_INDEPENDENT_FILES = new Set([
  'apps/world/campus/index.html',
  'apps/world/styles.css',
  'apps/world/dev-server.mjs',
  'apps/world/src/main.js',
  'apps/world/src/player-controller.js',
  'apps/world/src/player-dimensions.js',
  'apps/world/src/orbit-camera-controller.js',
  'apps/world/src/world-collision.js',
  'apps/world/src/polygon-collision.js',
  // QA-only photo diagnostics prose; does not use Supabase or change runtime behavior.
  'apps/world/docs/photo-capture-diagnostics.md',
]);

const DB_INDEPENDENT_PREFIXES = [
  'apps/classic/',
  'apps/induck-grow/',
  'apps/induckup/',
  'apps/survival/',
  'apps/world/assets/',
  'apps/world/data/reality/',
  'apps/world/tests/',
  'apps/world/src/environment/',
  'apps/world/src/input/',
  'apps/world/src/minimap/',
  'apps/world/src/navigation/',
  'apps/world/src/photo/',
  'apps/world/src/preview/',
];

export function isDocs(file) {
  return typeof file === 'string' && (DOC_FILES.has(file)
    || /^\.github\/ISSUE_TEMPLATE\/[^/\r\n]+\.md$/.test(file));
}

function isDatabaseIndependent(file) {
  if (typeof file !== 'string') return false;
  if (isDocs(file)) return true;
  if (DB_INDEPENDENT_FILES.has(file)) return true;
  if (DB_INDEPENDENT_PREFIXES.some(prefix => file.startsWith(prefix))) return true;
  if (/^apps\/world\/src\/world-loading[^/]*\.js$/.test(file)) return true;
  if (/^apps\/world\/src\/[^/]*(?:geometry|renderer|render-kit|layout|material-profile|roadview-details|grounds|terrain|collision)[^/]*\.js$/.test(file)) return true;
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(file) && file !== '.github/workflows/public-ci.yml') return true;
  return false;
}

export function classify(files) {
  return Array.isArray(files) && files.length > 0 && files.every(isDocs) ? 'docs' : 'full';
}

export function needsDatabase(files) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return !files.every(isDatabaseIndependent);
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
  const db = mode === 'full' && needsDatabase(files);
  console.log('mode=' + mode);
  console.log('db=' + (db ? 'true' : 'false'));
  console.error('public-ci-scope: ' + mode + ', db=' + (db ? 'required' : 'skip') + ' (' +
    (files === null ? 'unknown or empty change set' : files.length + ' changed file(s)') + ')');
}
