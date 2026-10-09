import { assessBiryongCiFrameSample } from '../../src/biryong/biryong-performance-budget.js';

const complete = sample => Number.isInteger(sample?.sampleCount) && sample.sampleCount >= 90 &&
  ['p95Ms', 'p99Ms', 'longFrameRate'].every(key => typeof sample[key] === 'number' && Number.isFinite(sample[key])) &&
  sample.p95Ms > 0 && sample.p99Ms > 0 && sample.longFrameRate >= 0 && sample.longFrameRate <= 1;

export function classifyBiryongSamples({ tier, baseline, visual, mobileViewport = false }) {
  const baselineAssessment = assessBiryongCiFrameSample({ tier, baseline, visual: baseline, mobileViewport });
  const visualAssessment = assessBiryongCiFrameSample({ tier, baseline, visual, mobileViewport });
  const baselineValid = complete(baseline) && baselineAssessment.withinCiSurrogateBudget;
  const passed = baselineValid && complete(visual) && visualAssessment.withinCiSurrogateBudget;
  return { outcome: !baselineValid ? 'INCONCLUSIVE' : passed ? 'PASS' : 'FAIL', passed,
    baselineValid, baselineAssessment, visualAssessment,
    reason: !baselineValid ? 'Baseline cannot sustain the unchanged CI surrogate budget; this run cannot establish Visual Lab acceptance.' : null };
}

// Node owns this deadline: an unresponsive renderer cannot prevent it from firing.
export async function boundedPerformancePhase(work, { label, timeoutMs, fatal } = {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: host deadline exceeded (${timeoutMs} ms)`)), timeoutMs); }),
      ...(fatal ? [fatal] : [])
    ]);
  } finally { clearTimeout(timer); }
}
