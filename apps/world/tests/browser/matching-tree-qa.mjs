// Pure QA contracts shared by Node and the hosted browser. No browser dependency.
import { MATCHING_TREE as tree } from '../../src/matching-tree-layout.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
const check = (value, message) => { if (!value) throw Error(message); };
export function assertMatchingTreeHostedExecution(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted', 'Matching-tree browser QA requires a GitHub-hosted runner; local execution is not authorized');
  check(env.GITHUB_EVENT_NAME === 'pull_request', 'Matching-tree QA requires a pull_request event');
  check(/^[a-f0-9]{40}$/.test(env.EXPECTED_MATCHING_TREE_HEAD || ''), 'Matching-tree QA requires the exact PR head');
  check(env.WORLD_SMOKE_DISABLE_WEBGPU === '1' && env.WORLD_SMOKE_BROWSER === 'chrome', 'Matching-tree QA requires the offline WebGL2 Chrome path');
}
export const MATCHING_TREE_QA_VIEWPORTS = Object.freeze([
  { name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'portrait', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'landscape', viewport: { width: 844, height: 390 }, mobile: true }
].map(v => Object.freeze({ ...v, viewport: Object.freeze(v.viewport) })));
export function matchingTreeViews() {
  const ground = roadviewGroundHeight(tree.center.x, tree.center.z);
  const point = (u, v, y) => { const p = tree.at(u, v, y + ground); return [p.x, p.y, p.z]; };
  return [
    { id: 'tree-facing', from: point(2, 13, 5.1), target: point(0, 0, 1.65) },
    { id: 'two-seats', from: point(.65, 6.2, 2.45), target: point(0, 0, 1.3) }
  ];
}
export function matchingTreeCamera(view, aspect) {
  check(Number.isFinite(aspect) && aspect > 0, 'Camera aspect must be positive');
  const scale = Math.max(1, 1 / aspect);
  return { ...view, from: view.from.map((v, i) => view.target[i] + (v - view.target[i]) * scale) };
}
export function assertMatchingTreeSeatPose(state, anchor) {
  check(state?.seated === true && state.id === anchor.id, 'Expected matching-tree seated anchor');
  check(['x', 'y', 'z'].every(k => Number.isFinite(state.position?.[k]) && Math.abs(state.position[k] - anchor.position[k]) < 1e-5), 'Seated avatar position differs from branch anchor');
  const turn = ((state.yaw - anchor.yaw + 180) % 360 + 360) % 360 - 180;
  check(Number.isFinite(turn) && Math.abs(turn) < 1e-4, 'Seated avatar facing differs from branch anchor');
  check(state.legs?.length === 2 && state.legs.every(v => Math.abs(v - 70) < 1e-5), 'Expected existing seated leg pose');
}
export function assertMatchingTreeFraming(points, viewport) {
  check(points.length > 0, 'Expected projected target samples');
  for (const p of points) check([p.x, p.y, p.depth].every(Number.isFinite) && p.depth > 0 &&
    p.x >= viewport.width * .03 && p.x <= viewport.width * .97 && p.y >= viewport.height * .03 && p.y <= viewport.height * .97,
  'Tree or avatar is outside the camera frame');
}
// The production walking camera caps at 7 world units. Its live seated check
// covers the low fork and avatars; the complete canopy belongs to still views.
export function matchingTreeTargetSamples(canopy = true) {
  const ground = roadviewGroundHeight(tree.center.x, tree.center.z);
  const samples = [tree.at(0, 0, ground)];
  if (canopy) samples.push(...tree.crowns.flatMap(c => [-1, 1].flatMap(a => [-1, 1].map(b =>
    tree.at(c.u + a * c.size[0] / 2, c.v + b * c.size[2] / 2, ground + c.y + c.size[1] / 2)))));
  for (const u of tree.seatOffsets) for (const side of [-.24, .24]) for (const y of [tree.seatTopY - .1, tree.seatTopY + .9])
    samples.push(tree.at(u + side, tree.seatV, ground + y));
  return samples;
}
