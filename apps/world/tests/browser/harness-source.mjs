import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function resolveWorldSmokeSource({ worldRoot, defaultWorldRoot, samplerPackagePath }) {
  const root = resolve(worldRoot ?? defaultWorldRoot);
  const sampler = JSON.parse(await readFile(samplerPackagePath, 'utf8')).devDependencies.playcanvas;
  const selected = JSON.parse(await readFile(join(root, 'tests/browser/package.json'), 'utf8')).devDependencies.playcanvas;
  assert.equal(selected, sampler, `Selected source engine pin mismatch: ${selected} vs sampler ${sampler}`);
  const urls = new Set();
  for (const page of ['campus/index.html', 'editor/index.html']) {
    const html = await readFile(join(root, page), 'utf8');
    const url = html.match(/"playcanvas"\s*:\s*"([^"]+)"/)?.[1];
    assert.ok(url, `${page} import map has no playcanvas entry`);
    assert.ok(url.includes(`playcanvas@${sampler}/`), `${page} imports ${url}, expected engine pin ${sampler}`);
    urls.add(url);
  }
  return { worldRoot: root, devServer: join(root, 'dev-server.mjs'), urls, engineVersion: sampler };
}
