// Interpret software-only frame receipts without claiming real-device performance acceptance.
// A known-unusable SwiftShader baseline is diagnostic-only. Missing, corrupt or failing
// measurements remain hard failures. The raw sampler's strict exit code is unchanged.
import { readFile, appendFile } from 'node:fs/promises';
import { classifyBiryongSamples } from './biryong-performance-diagnostics.mjs';

const verdict = (outcome, reason) => Object.freeze({ outcome, reason, ok: outcome !== 'FAIL' });
const isSwiftShader = scene => /SwiftShader/i.test(scene?.driver?.renderer ?? '');
const clean = receipt => Boolean(receipt && receipt.completedAt &&
  Array.isArray(receipt.problems) && receipt.problems.length === 0 &&
  !receipt.cleanupError && Array.isArray(receipt.progress) &&
  receipt.progress.length > 0 && receipt.progress.every(p => p.state !== 'ERROR'));
const completeLow = receipt => {
  const sample = receipt?.baseline?.low;
  return sample && sample.sampleCount >= 90 &&
    Number.isFinite(sample.p95Ms) && sample.p95Ms > 0 &&
    Number.isFinite(sample.p99Ms) && sample.p99Ms > 0 &&
    Number.isFinite(sample.longFrameRate) && sample.longFrameRate >= 0 &&
    sample.longFrameRate <= 1 && isSwiftShader(sample.scene);
};

export function gateBiryongControl(report) {
  if (!report || !Array.isArray(report.errors) || !Array.isArray(report.readErrors) ||
      report.readErrors.length) return verdict('FAIL', 'Missing or unreadable comparison evidence');
  const outcomes = report.measurementOutcomes;
  if (report.outcome === 'PASS' && report.passed === true && report.errors.length === 0 &&
      outcomes?.main === 'success' && outcomes?.candidate === 'success')
    return verdict('PASS', 'Valid same-runner LOW comparison');
  if (report.outcome !== 'INCONCLUSIVE' || report.passed !== false)
    return verdict('FAIL', 'Comparison reported a regression or inconsistent result');
  // The report utility records the sampler's intentional nonzero exit on INCONCLUSIVE.
  // These are the ONLY errors eligible for a diagnostic-only CI conclusion.
  const allowed = ['main: measurement process outcome failure', 'candidate: measurement process outcome failure'];
  if (!report.errors.every(e => allowed.includes(e)) ||
      report.errors.length !== 2 || !allowed.every(e => report.errors.includes(e)))
    return verdict('FAIL', 'Unexpected comparison, provenance or execution errors');
  const a = report.main, b = report.candidate;
  if (!clean(a) || !clean(b) || !completeLow(a) || !completeLow(b) ||
      a.status !== 'INCONCLUSIVE' || b.status !== 'INCONCLUSIVE' ||
      a.error || b.error ||
      a.mode !== 'baseline-only' || b.mode !== 'baseline-only' ||
      a.exactHead !== report.expectedMainSha || b.exactHead !== report.expectedCandidateSha ||
      a.samplerHead !== report.expectedCandidateSha ||
      b.samplerHead !== report.expectedCandidateSha ||
      a.baseline.low.validity?.validForComparison !== false ||
      b.baseline.low.validity?.validForComparison !== false)
    return verdict('FAIL', 'Incomplete or untrusted software-renderer evidence');
  const recheck = classifyBiryongSamples({ tier: 'low', baseline: a.baseline.low, visual: b.baseline.low });
  if (report.assessment?.outcome !== 'INCONCLUSIVE' ||
      recheck.outcome !== 'INCONCLUSIVE' || recheck.baselineValid !== false)
    return verdict('FAIL', 'Expected unusable baseline was not independently confirmed');
  return verdict('INCONCLUSIVE', 'Both valid SwiftShader samples exceed the unchanged LOW performance budget');
}

export function gateBiryongVisual(receipt, processOutcome, expectedHead) {
  if (!clean(receipt) || !expectedHead || receipt.exactHead !== expectedHead ||
      receipt.mode !== 'visual-comparison')
    return verdict('FAIL', 'Missing or untrusted visual performance receipt');
  if (receipt.status === 'PASS' && processOutcome === 'success' &&
      receipt.baseline?.low?.validity?.validForComparison === true &&
      ['low', 'medium', 'high'].every(tier => receipt.desktop?.[tier]?.ciSurrogatePass === true) &&
      receipt.mobileViewport?.ciSurrogatePass === true)
    return verdict('PASS', 'CI surrogate performance within unchanged budgets');
  if (receipt.status !== 'INCONCLUSIVE' || processOutcome !== 'failure' ||
      !completeLow(receipt) || receipt.baseline.low.validity?.validForComparison !== false ||
      !receipt.error?.startsWith('Error: low INCONCLUSIVE: Baseline cannot sustain') ||
      !receipt.desktop?.low?.sceneComparable ||
      !receipt.desktop.low.structural?.withinBudget ||
      !isSwiftShader(receipt.desktop.low.scene) ||
      !receipt.desktop.low.monitor?.active)
    return verdict('FAIL', 'Visual performance regression or measurement failure');
  const recheck = classifyBiryongSamples({
    tier: 'low', baseline: receipt.baseline.low, visual: receipt.desktop.low.visual
  });
  if (recheck.outcome !== 'INCONCLUSIVE' || recheck.baselineValid !== false ||
      receipt.desktop.low.assessment?.outcome !== 'INCONCLUSIVE')
    return verdict('FAIL', 'Unusable baseline could not be confirmed');
  return verdict('INCONCLUSIVE', 'SwiftShader baseline is below the measurement floor; real-device validation still required');
}

if (process.argv[1]?.endsWith('/biryong-ci-gate.mjs')) {
  const [mode, path, arg3, arg4] = process.argv.slice(2);
  let decision;
  try {
    if (mode === 'control') decision = gateBiryongControl(JSON.parse(await readFile(path, 'utf8')));
    else if (mode === 'visual') decision = gateBiryongVisual(
      JSON.parse(await readFile(path, 'utf8')), arg3, arg4
    );
    else throw new Error('Expected control or visual diagnostic mode');
  } catch (error) {
    decision = verdict('FAIL', 'Receipt read or diagnostic error: ' + String(error));
  }
  const message = 'Biryong ' + decision.outcome + ': ' + decision.reason;
  console.log('BIRYONG_CI_DIAGNOSTIC ' + JSON.stringify(decision));
  if (decision.outcome === 'INCONCLUSIVE') console.log('::warning title=Biryong performance not validated::' + message);
  else if (decision.outcome === 'FAIL') console.error('::error title=Biryong CI diagnostic failed::' + message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '### Biryong performance diagnostic: ' + decision.outcome + '\n\n' +
      decision.reason + '\n\n' +
      (decision.outcome === 'INCONCLUSIVE'
        ? '**Not a performance PASS.** Software-rendered CI cannot establish the real-device budget.\n'
        : '') + '\n');
  }
  if (!decision.ok) process.exitCode = 1;
}
