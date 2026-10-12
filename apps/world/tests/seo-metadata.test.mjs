import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const canonicalPages = [
  ['apps/world/index.html', 'https://inhagame.app/'],
  ['apps/world/campus/index.html', 'https://inhagame.app/campus/'],
];
const privatePages = [
  'apps/world/profile/index.html',
  'apps/world/achievements/index.html',
  'apps/world/editor/index.html',
  'apps/world/studio/index.html',
];

test('public hub and campus have unique search metadata and matching canonicals', () => {
  const titles = new Set();
  for (const [path, url] of canonicalPages) {
    const html = read(path);
    assert.equal((html.match(/<title>/g) ?? []).length, 1, path);
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1, path);
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'), path);
    assert.match(html, /<meta name="description" content="[^\"]+">/, path);
    assert.match(html, /<meta property="og:title" content="[^\"]+">/, path);
    assert.match(html, /<meta property="og:url" content="https:\/\/inhagame\.app\//, path);
    assert.doesNotMatch(html, /name="robots" content="noindex/, path);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title && !titles.has(title), path);
    titles.add(title);
  }
});

test('user-specific and development pages opt out of search indexing', () => {
  for (const path of privatePages) {
    const html = read(path);
    assert.match(html, /<meta name="robots" content="noindex, follow">/, path);
  }
});

test('robots and sitemap agree on public, same-origin canonical URLs', () => {
  const robots = read('apps/world/robots.txt');
  const sitemap = read('apps/world/sitemap.xml');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/inhagame\.app\/sitemap\.xml$/m);
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
  assert.deepEqual(locs, canonicalPages.map(([, url]) => url));
  for (const url of locs) {
    assert.equal(new URL(url).hostname, 'inhagame.app');
  }
  for (const page of privatePages) {
    assert.ok(!sitemap.includes(page.split('/').slice(2, -1).join('/')));
  }
});
