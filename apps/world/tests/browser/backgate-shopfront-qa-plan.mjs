// Pure fixture data shared by the hosted browser smoke and Node-only contracts.
// No historical layout/renderer/material source is substituted.
import { BACK_STREET_BLOCKS } from '../../src/back-street-layout.js';
import { CULTURE_BUILDINGS, CULTURE_TERMINAL } from '../../src/culture-street-layout.js';

export const BASELINE = 'd9cbd3948e4e5acf359313824387dc8695c3e672';
export const CURRENT_MAIN = '413d984fcb59216e7f07bafed1fffc618351a109';
export const BASELINE_PATHS = Object.freeze([
  '/src/back-street-geometry.js', '/src/culture-street-geometry.js', '/src/culture-street-signs.js'
]);
export const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 }
]);
export const TARGETS = [...BACK_STREET_BLOCKS, ...CULTURE_BUILDINGS];
const middle = values => values[Math.floor(values.length / 2)];
export const VIEWS = [
  { name: 'back-street', plot: middle(BACK_STREET_BLOCKS) },
  ...[1, -1].map(side => ({ name: `culture-${side === 1 ? 'west' : 'east'}`,
    plot: middle(CULTURE_BUILDINGS.filter(q => q.side === side && q.id.startsWith('culture_shop_'))) })),
  { name: 'culture-terminal', plot: CULTURE_TERMINAL }
];
export function frontOf(q) {
  if (!q.polygon) return q.front;
  const origin = q.frame.at(0), inward = q.frame.at(0, 1);
  return Math.min(...q.polygon.map(p => (p.x - origin.x) * (inward.x - origin.x) +
    (p.z - origin.z) * (inward.z - origin.z)));
}
export function cameraFor(q, { width, height }) {
  const front = frontOf(q), from = q.frame.at(0, front - 1.8), to = q.frame.at(0, front);
  // Orthographic facade inspection keeps the camera inside the narrow street,
  // rather than moving it through the opposing shop to fit a portrait viewport.
  return { projection: 'orthographic', position: [from.x, q.h / 2, -from.z],
    target: [to.x, q.h / 2, -to.z], orthoHeight: Math.max((q.h + .9) / 2, (q.w + 1) * height / width / 2),
    nearClip: .05, farClip: 200, front };
}
export function expectedRaster({ width, height }, { maxPixelRatio }, devicePixelRatio) {
  const ratio = Math.min(maxPixelRatio, devicePixelRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) throw Error('Invalid active graphics pixel ratio');
  return { width: Math.floor(width * ratio), height: Math.floor(height * ratio), ratio };
}
export function assertHosted(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw Error('Shopfront browser QA is GitHub-hosted only; do not launch a local browser or server');
  }
  if (!/^[a-f0-9]{40}$/.test(env.EXPECTED_SHOPFRONT_HEAD || '')) {
    throw Error('EXPECTED_SHOPFRONT_HEAD must identify the exact pull request head');
  }
}
