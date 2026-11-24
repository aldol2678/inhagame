export function stairTreadHeight(t, out) {
  const depth = Math.max(0, out - (t.landing ?? 0));
  const index = Math.min(t.steps, Math.floor(depth / t.run * t.steps + 1e-8));
  return t.height * (t.steps-index) / t.steps;
}
