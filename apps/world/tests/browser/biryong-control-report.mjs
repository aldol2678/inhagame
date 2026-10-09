import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compareImmutableBiryongBaseline } from './biryong-control-comparison.mjs';
const [mainPath, candidatePath, outputPath, expectedMainSha, expectedCandidateSha] = process.argv.slice(2);
if (!outputPath) throw new Error('Expected main receipt, candidate receipt, output, main SHA and candidate SHA');
const readErrors = [];
async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { readErrors.push(`${path}: ${String(error)}`); return null; }
}
const report = compareImmutableBiryongBaseline(await read(mainPath), await read(candidatePath), { expectedMainSha, expectedCandidateSha });
report.readErrors = readErrors;
report.measurementOutcomes = {
  main: process.env.BIRYONG_CONTROL_MAIN_OUTCOME ?? null,
  candidate: process.env.BIRYONG_CONTROL_CANDIDATE_OUTCOME ?? null
};
for (const [label, outcome] of Object.entries(report.measurementOutcomes)) {
  if (outcome !== 'success') {
    report.errors.push(`${label}: measurement process outcome ${outcome ?? 'missing'}`);
    report.outcome = 'INCONCLUSIVE';
    report.passed = false;
  }
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
