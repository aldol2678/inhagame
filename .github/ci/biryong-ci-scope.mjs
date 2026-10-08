// Narrow, fail-closed exemption for UI icon source assets that the Biryong
// LOW Visual OFF benchmark does not load. Unknown and mixed changes measure.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const SAFE_ASSET = [
  /^apps\/world\/assets\/ui-icons\/p0-v1\/svg\/[a-z0-9-]+\.svg$/,
  /^apps\/world\/assets\/ui-icons\/p0-v1\/(?:README\.md|manifest\.json)$/,
];

export function classifyBiryongScope(files) {
  if (!Array.isArray(files) || files.length === 0) return 'measure';
  return files.every(file => typeof file === 'string' && SAFE_ASSET.some(re => re.test(file)))
    ? 'asset_only' : 'measure';
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function changedBiryongFiles(env = process.env) {
  if (env.CI_EVENT !== 'pull_request' || !SHA.test(env.PR_BASE_SHA ?? '') || !SHA.test(env.PR_HEAD_SHA ?? '')) return null;
  try {
    // Checkout must be the immutable event head. An event/checkout mismatch
    // never qualifies for the fast path.
    if (git('rev-parse', 'HEAD').trim() !== env.PR_HEAD_SHA) return null;
    git('cat-file', '-e', env.PR_BASE_SHA + '^{commit}');
    // -z handles newlines; --no-renames includes old AND new paths on rename.
    const value = git('diff', '--name-only', '--no-renames', '-z', env.PR_BASE_SHA, 'HEAD', '--');
    if (!value || !value.endsWith('\0')) return null;
    return value.slice(0, -1).split('\0');
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = changedBiryongFiles();
  const mode = classifyBiryongScope(files);
  console.log('mode=' + mode);
  console.error(`biryong-ci-scope: ${mode}; ${files === null ? 'unknown/untrusted diff' : files.length + ' changed paths'}`);
}
