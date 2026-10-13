import {pathToFileURL} from 'node:url';

// Preserve the original standalone #365 comparison. Only this reviewed release
// uses its actual main base, which already includes the shipped Jeongseok entry.
export const STANDALONE_BASELINE = '2b9a09615f7986e3d5e5b93d731fba21f33afbdd';
export const REVIEWED_RELEASE_BRANCH = 'release/2026-10-13-ci-runtime-diagnostics';
export const REVIEWED_RELEASE_BASE = 'bfa08ad78f92fba51eb1a3978dd97a12182fc82c';
export function selectWalkwayBaseline({headRef = '', baseSha = ''} = {}) {
  if (headRef === REVIEWED_RELEASE_BRANCH) {
    if (baseSha !== REVIEWED_RELEASE_BASE) throw new Error('Unreviewed release base: fail closed');
    return REVIEWED_RELEASE_BASE;
  }
  if (headRef.startsWith('release/')) throw new Error('Unreviewed release branch: fail closed');
  return STANDALONE_BASELINE;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(selectWalkwayBaseline({headRef: process.env.WALKWAY_HEAD_REF, baseSha: process.env.WALKWAY_PR_BASE}));
}
