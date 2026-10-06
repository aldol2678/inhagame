// GitHub-hosted runner only: build the real Dockerfile, then verify its image without external networking.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_CMD, PACKAGE_DIRECTORIES, packagedSourceHashes, sha256, verifyRuntimeReport } from './collection-book-package.mjs';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const root = REPOSITORY_ROOT;
export function containerArguments(imageId, fixtureDirectory, name) {
  return ['run', '--rm', '--interactive', '--name', name,
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', '1000:1000', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
    '--mount', `type=bind,src=${fixtureDirectory},dst=/qa,readonly`,
    imageId, 'node', '/qa/collection-book-verify.mjs'];
}

function main() {
  const output = join(root, 'test-results/collection-book-container');
  mkdirSync(output, { recursive: true });
  const evidence = { status: 'failed', stage: 'checkout' };
  const dockerConfig = mkdtempSync(join(tmpdir(), 'collection-book-docker-'));
  const dockerEnv = { PATH: process.env.PATH, DOCKER_CONFIG: dockerConfig };
  let containerName;
  function command(binary, args, options = {}) {
    const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) throw Error('CONTAINER_QA_COMMAND_FAILED');
    return result.stdout;
  }
  const docker = (args, options) => command('docker', args, { env: dockerEnv, ...options });
  try {
    const head = command('git', ['rev-parse', 'HEAD']).trim();
    assert.match(head, /^[a-f0-9]{40}$/);
    assert.equal(head, process.env.EXPECTED_COLLECTION_BOOK_HEAD, 'checkout must be the exact PR head');
    evidence.head = head;
    const inputs = ['apps/world/Dockerfile', ...PACKAGE_DIRECTORIES.map(path => `apps/world/${path}`),
      'apps/world/tests/container', 'apps/world/tests/collection-book-container-contract.test.mjs',
      '.github/workflows/collection-book-container.yml'];
    assert.equal(command('git', ['status', '--porcelain', '--untracked-files=all', '--', ...inputs]).trim(), '',
      'packaging and verifier inputs must be unchanged from the checked-out head');
    const world = join(root, 'apps/world');
    const dockerfile = readFileSync(join(world, 'Dockerfile'), 'utf8');
    assert.equal(dockerfile.trim(), ['FROM node:22-alpine', 'WORKDIR /app',
      ...PACKAGE_DIRECTORIES.map(path => `COPY ${path} ./${path}`), `CMD ${JSON.stringify(IMAGE_CMD).replace(',', ', ')}`].join('\n'),
    'test the reviewed Dockerfile without replacing its base, sources or CMD');
    const expected = { head, sourceHashes: packagedSourceHashes(world) };
    evidence.dockerfileSha256 = sha256(dockerfile);
    evidence.checkoutSourceHashes = expected.sourceHashes;
    const fixtureDirectory = join(world, 'tests/container');
    evidence.fixtureHashes = Object.fromEntries(['collection-book-docker.mjs', 'collection-book-fixture.mjs',
      'collection-book-package.mjs', 'collection-book-preload.mjs', 'collection-book-verify.mjs']
      .map(path => [path, sha256(readFileSync(join(fixtureDirectory, path)))]));

    evidence.stage = 'docker-build';
    const tag = `collection-book-qa:${head}`;
    console.log('Building the actual apps/world/Dockerfile with node:22-alpine');
    docker(['build', '--pull', '--network=none', '--file', 'apps/world/Dockerfile', '--tag', tag, 'apps/world']);
    evidence.stage = 'image-inspection';
    const image = JSON.parse(docker(['image', 'inspect', tag]))[0];
    assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(image.Config.Cmd, IMAGE_CMD);
    assert.equal(image.Config.WorkingDir, '/app');
    evidence.image = { id: image.Id, os: image.Os, architecture: image.Architecture,
      cmd: image.Config.Cmd, workingDirectory: image.Config.WorkingDir };
    // The Dockerfile reference is recorded, but a mutable local tag is not proof of the build's resolved base.
    evidence.baseImageReference = 'node:22-alpine';

    evidence.stage = 'isolated-real-http';
    containerName = `collection-book-${head.slice(0, 12)}-${process.pid}`;
    const args = containerArguments(image.Id, fixtureDirectory, containerName);
    evidence.isolation = { network: 'none', readOnlyRoot: true, readOnlyFixtureMount: true,
      user: '1000:1000', capabilities: 'none', noNewPrivileges: true, dockerSocketMounted: false,
      publishedPorts: false, environment: 'public synthetic fixture values only' };
    // Pass expected public hashes on stdin, never mount the checkout over packaged /app.
    const result = spawnSync('docker', args, { cwd: root, env: dockerEnv, input: JSON.stringify(expected),
      encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    try { evidence.runtime = JSON.parse(result.stdout); } catch { throw Error('CONTAINER_QA_REPORT_MISSING'); }
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, 'the actual image verifier must succeed');
    verifyRuntimeReport(evidence.runtime, expected);
    assert.equal(evidence.runtime.platform, image.Os);
    assert.equal(evidence.runtime.childRuntime.platform, image.Os);
    assert.equal(evidence.runtime.childRuntime.arch, evidence.runtime.arch);
    assert.equal(evidence.runtime.arch, ({ amd64: 'x64', arm64: 'arm64' })[image.Architecture]);
    evidence.status = 'passed';
    evidence.stage = 'complete';
    console.log(`Node 22 container QA passed: ${evidence.runtime.checks.length} real HTTP checks; ${image.Id}`);
  } catch {
    // Do not preserve process environments, raw child logs, request tokens or upstream bodies.
    console.error(`Node 22 container QA failed at ${evidence.stage}; see public evidence.json`);
    process.exitCode = 1;
  } finally {
    if (containerName) spawnSync('docker', ['rm', '--force', containerName], { env: dockerEnv, stdio: 'ignore', timeout: 10_000 });
    writeFileSync(join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
