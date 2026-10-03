// Reference model of Vercel's `git.deploymentEnabled` evaluation, documented at
// https://vercel.com/docs/project-configuration/git-configuration :
//   - a branch that matches no pattern is deployed (the default is true)
//   - patterns are minimatch globs
//   - when several patterns match, the deployment happens if at least one matching rule is true
//   - `deploymentEnabled: false` disables every branch
// The matcher below covers the glob subset used by this project (literal text, `*`, `?`, `**`) with minimatch
// semantics; it was cross-checked against minimatch 10.2.4 (see the v2 evidence). Git forbids branch-name
// components that start with a dot, so the dot rule only matters for completeness.
const notDot = segment => !segment.startsWith('.');

function segmentMatches(pattern, segment) {
  if (/^[*?]/.test(pattern) && segment.startsWith('.')) return false;
  const source = [...pattern].map(char => char === '*' ? '[^/]*' : char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${source}$`).test(segment);
}

function matchSegments(patternSegments, branchSegments, pi = 0, bi = 0) {
  if (pi === patternSegments.length) return bi === branchSegments.length;
  const pattern = patternSegments[pi];
  if (pattern === '**') {
    const remaining = branchSegments.length - bi;
    // A trailing `**` needs at least one more segment (minimatch: "preview/**" does not match "preview").
    if (pi === patternSegments.length - 1) return remaining >= 1 && branchSegments.slice(bi).every(notDot);
    for (let skip = 0; skip <= remaining; skip++) {
      if (branchSegments.slice(bi, bi + skip).every(notDot) && matchSegments(patternSegments, branchSegments, pi + 1, bi + skip)) return true;
    }
    return false;
  }
  if (bi === branchSegments.length) return false;
  return segmentMatches(pattern, branchSegments[bi]) && matchSegments(patternSegments, branchSegments, pi + 1, bi + 1);
}

export const globMatches = (pattern, branch) => matchSegments(pattern.split('/'), branch.split('/'));

export function branchDeploys(deploymentEnabled, branch) {
  if (deploymentEnabled === false) return false;
  if (deploymentEnabled === true || deploymentEnabled === undefined) return true;
  const matching = Object.entries(deploymentEnabled).filter(([pattern]) => globMatches(pattern, branch));
  if (matching.length === 0) return true;
  return matching.some(([, enabled]) => enabled === true);
}
