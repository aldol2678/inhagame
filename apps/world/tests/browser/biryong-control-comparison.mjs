import { isDeepStrictEqual } from 'node:util';
import { classifyBiryongSamples } from './biryong-performance-diagnostics.mjs';

export function compareImmutableBiryongBaseline(main, candidate, { expectedMainSha, expectedCandidateSha } = {}) {
  const errors = [];
  for (const [label, receipt, expected] of [['main', main, expectedMainSha], ['candidate', candidate, expectedCandidateSha]]) {
    if (!receipt) { errors.push(`${label}: receipt missing`); continue; }
    if (receipt.exactHead !== expected) errors.push(`${label}: source SHA mismatch`);
    if (receipt.mode !== 'baseline-only') errors.push(`${label}: not Visual OFF baseline-only`);
    if (!['PASS', 'INCONCLUSIVE'].includes(receipt.status)) errors.push(`${label}: incomplete/failed collection`);
    if (receipt.problems?.length) errors.push(`${label}: browser errors`);
    if (receipt.samplerHead !== expectedCandidateSha) errors.push(`${label}: sampler SHA mismatch`);
    if (!receipt.baseline?.low?.scene) errors.push(`${label}: LOW scene missing`);
  }
  const baseline = main?.baseline?.low, visual = candidate?.baseline?.low;
  if (baseline?.scene && visual?.scene) {
    for (const key of ['viewport', 'drawingBuffer', 'renderer', 'driver', 'visible', 'inBiryong', 'camera', 'environment', 'graphics'])
      if (!isDeepStrictEqual(baseline.scene[key], visual.scene[key])) errors.push(`${key}: comparison conditions differ`);
    if (visual.scene.inBiryong !== true || visual.scene.visible !== 'visible') errors.push('scene inactive or hidden');
    if (!baseline.scene.position?.every((value, index) => Math.abs(value - visual.scene.position?.[index]) < .01)) errors.push('position differs');
  }
  if (main?.frameMeasurement !== candidate?.frameMeasurement) errors.push('measurement methods differ');
  const assessment = baseline && visual ? classifyBiryongSamples({ tier: 'low', baseline, visual }) : null;
  const outcome = errors.length || !assessment ? 'INCONCLUSIVE' : assessment.outcome;
  return {
    schema: 'biryong-immutable-main-control-v1', outcome, passed: outcome === 'PASS',
    scope: 'LOW only, immutable main Visual OFF versus candidate Visual OFF on the same runner; no real-device or Visual ON acceptance claim',
    expectedMainSha, expectedCandidateSha, errors, assessment,
    main: main ?? null, candidate: candidate ?? null
  };
}
