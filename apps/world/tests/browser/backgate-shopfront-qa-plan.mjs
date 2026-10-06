// Pure fixture data shared by the hosted browser smoke and Node-only contracts.
// No historical layout/renderer/material source is substituted.
import { BACK_STREET_BLOCKS } from '../../src/back-street-layout.js';
import { CULTURE_BUILDINGS, CULTURE_TERMINAL } from '../../src/culture-street-layout.js';

export const BASELINE = 'd9cbd3948e4e5acf359313824387dc8695c3e672';
// PR204 integration base; independent of the historical visual baseline above.
export const CURRENT_MAIN = '995364fa5a403fcd290d1bf7357b78f85692c447';
export const BASELINE_PATHS = Object.freeze([
  '/src/back-street-geometry.js', '/src/culture-street-geometry.js', '/src/culture-street-signs.js'
]);
// Original facade paths plus the exact seven runtime paths in this restoration.
// Layout, collision, renderer, material and data changes remain forbidden.
export const ALLOWED_RUNTIME_PATHS = Object.freeze([...BASELINE_PATHS.map(p => `apps/world${p}`),
  ...['backgate-shopfront-geometry.js', 'back-alley-geometry.js', 'back-market-geometry.js',
    'backgate-infill-geometry.js', 'campus-road-blockout.js', 'north-side-gate-geometry.js']
    .map(name => `apps/world/src/${name}`)]);
export function assertRuntimeChanges(paths) {
  for (const path of paths) if (!ALLOWED_RUNTIME_PATHS.includes(path)) throw Error(`unrelated runtime change: ${path}`);
}

// Current road/signal owners are shared controls. Only facade functions and signs
// come from the pinned old modules. Query aliases preserve relative imports.
export function comparisonSources(originals) {
  if ([...originals.keys()].sort().join() !== [...BASELINE_PATHS].sort().join()) throw Error('Expected exact baseline paths');
  const sources = new Map([...originals].map(([path, source]) => [path, source.toString()]));
  const paving = 'for(const s of BACK_STREET_SEGMENTS)corridor(b,s.frame,s.road.width);';
  const street = sources.get(BASELINE_PATHS[0]);
  if (street.split(paving).length !== 2) throw Error('Expected exactly one pinned historical paving statement');
  sources.set(BASELINE_PATHS[0], street.replace(paving, ''));
  for (const [path, names] of [[BASELINE_PATHS[0], ['fillBackStreetBase', 'fillBackStreetNear', 'fillBackStreetDetail']],
    [BASELINE_PATHS[1], ['fillCultureBase', 'fillCultureNear', 'fillCultureDetail']]]) {
    sources.set(`${path}?shopfront-baseline`, sources.get(path));
    sources.set(path, `export * from '${path}?shopfront-current';\nexport { ${names.join(', ')} } from '${path}?shopfront-baseline';\n`);
  }
  return sources;
}
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
