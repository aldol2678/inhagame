import { CAMPUS_BENCH_WORLD } from './campus-bench-layout.js';
import { createCampusStaticPropRuntime } from './campus-static-prop-runtime.js';

export function createCampusBenchRuntime(context) {
  return createCampusStaticPropRuntime(CAMPUS_BENCH_WORLD, context);
}
