import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { cpus, platform, arch, release } from 'node:os';

const require = createRequire(import.meta.url);

// Only the performance sampler uses this contract. Other browser QA keeps its launcher.
export async function collectBiryongEnvironment(browserVersion) {
  const coreRoot = dirname(require.resolve('playwright-core/package.json'));
  const manifest = JSON.parse(await readFile(join(coreRoot, 'browsers.json'), 'utf8'));
  const chromium = manifest.browsers.find(browser => browser.name === 'chromium');
  const engine = JSON.parse(await readFile(new URL('./node_modules/playcanvas/package.json', import.meta.url), 'utf8'));
  return {
    browserVersion, expectedBrowserVersion: chromium.browserVersion,
    browserRevision: chromium.revision,
    browserChannel: process.env.WORLD_SMOKE_BROWSER ?? '',
    playwrightVersion: require('playwright/package.json').version,
    engineVersion: engine.version,
    nodeVersion: process.version, platform: platform(), arch: arch(), kernel: release(),
    cpuModel: cpus()[0]?.model ?? '', cpuCount: cpus().length,
    imageOS: process.env.ImageOS ?? 'local', imageVersion: process.env.ImageVersion ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local',
    job: process.env.GITHUB_JOB ?? 'local'
  };
}

export function biryongEnvironmentErrors(environment) {
  if (!environment || typeof environment !== 'object') return ['measurement environment missing'];
  const errors = [];
  for (const key of ['browserVersion', 'expectedBrowserVersion', 'browserRevision', 'browserChannel',
    'playwrightVersion', 'engineVersion', 'nodeVersion', 'platform', 'arch', 'kernel', 'cpuModel',
    'imageOS', 'imageVersion', 'runId', 'runAttempt', 'job']) {
    if (typeof environment[key] !== 'string' || !environment[key].trim()) errors.push(`${key} missing`);
  }
  if (!Number.isInteger(environment.cpuCount) || environment.cpuCount < 1) errors.push('cpuCount invalid');
  if (environment.browserChannel !== 'chromium') errors.push('browser channel is not pinned Chromium');
  if (environment.browserVersion !== environment.expectedBrowserVersion) errors.push('browser version differs from Playwright pin');
  return errors;
}
