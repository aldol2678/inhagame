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

test('Inha-specific titles and hub SPA title agree with search metadata', () => {
  const hub = read('apps/world/index.html');
  const campus = read('apps/world/campus/index.html');
  const hubTitle = '인하대 게임 · 인하월드 | INHAGAME';
  const campusTitle = '인하월드 | 인하대 캠퍼스 탐험 게임 · INHA WORLD';
  assert.ok(hub.includes('<title>' + hubTitle + '</title>'));
  assert.ok(campus.includes('<title>' + campusTitle + '</title>'));
  assert.ok(read('apps/world/hub.js').includes('document.title = current === "home" ? "' + hubTitle + '"'));
  for (const [html, title] of [[hub, hubTitle], [campus, campusTitle]]) {
    assert.ok(html.includes('<meta property="og:title" content="' + title + '">'));
    assert.match(html, /<meta name="description" content="[^"]*인하대[^"]*">|<meta name="description" content="[^"]*인하대학교[^"]*">/);
  }
});

test('verified existing PWA icon is used for search favicon and social preview', () => {
  const hub = read('apps/world/index.html');
  const campus = read('apps/world/campus/index.html');
  const url = 'https://inhagame.app/campus/icons/icon-512.png';
  for (const html of [hub, campus]) {
    assert.ok(html.includes('<meta property="og:image" content="' + url + '">'));
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
  }
  assert.ok(hub.includes('href="/campus/icons/favicon-32.png"'));
  for (const image of ['apps/world/campus/icons/icon-512.png', 'apps/world/campus/icons/favicon-32.png']) {
    const buf = readFileSync(resolve(root, image));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});
