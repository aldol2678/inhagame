import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const world = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, world));
const manifest = JSON.parse(read('campus/manifest.webmanifest'));
const origin = 'https://inhagame.app';
const manifestPath = '/campus/manifest.webmanifest';

// Source-level contracts only: these do not prove OS/WebAPK manifest propagation.
test('portal and campus advertise one existing manifest, without registering a service worker', () => {
  for (const path of ['index.html', 'campus/index.html']) {
    const html = read(path).toString();
    const links = [...html.matchAll(/<link\b[^>]*rel="manifest"[^>]*>/g)];
    assert.equal(links.length, 1, path);
    assert.match(links[0][0], /href="\/campus\/manifest\.webmanifest"/, path);
    assert.doesNotMatch(html, /serviceWorker\s*\.\s*register\s*\(/, path);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/campus\/icons\/apple-touch-icon\.png"/, path);
  }
});

test('A1 retains the installed app identity and legacy launch; A2 root launch is deferred', () => {
  const legacy = { id: '/campus/', start_url: '/campus/?lobby=1' };
  assert.equal(new URL(manifest.id, origin).href, new URL(legacy.id, origin).href);
  assert.equal(manifest.start_url, legacy.start_url);
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.name, 'INHA WORLD');
  assert.equal(manifest.short_name, 'INHA WORLD');
  assert.equal(manifest.display, 'standalone');
  const manifestURL = new URL(manifestPath, origin);
  const scopeURL = new URL(manifest.scope, manifestURL);
  for (const path of ['/', '/campus/?lobby=1', '/support.html', '/updates.html', '/privacy.html']) {
    const url = new URL(path, origin);
    assert.equal(url.origin, scopeURL.origin);
    assert.ok(url.pathname.startsWith(scopeURL.pathname));
  }
  // A root scope is not a cross-origin scope for independently hosted games.
  assert.notEqual(new URL('https://duck.inhagame.app/').origin, scopeURL.origin);
});

test('all four installed shortcut URLs remain byte-for-byte compatible', () => {
  assert.deepEqual(manifest.shortcuts.map(item => item.url), [
    '/campus/?lobby=1&shortcut=campus',
    '/campus/?lobby=1&shortcut=notifications',
    '/campus/?lobby=1&shortcut=daily-quiz',
    '/campus/?lobby=1&shortcut=album'
  ]);
});

test('the six approved campus icon files are unchanged from the installed baseline', () => {
  // Git blob IDs from main d67b1ba2b1fab882b0136dd22c5a36c4f92661ba.
  const expected = {
    'apple-touch-icon.png': 'b0a998e1216696c46e6a6a0bb45feb38ad25f93f',
    'favicon-16.png': '611605ae84d83f1ead2e16737d5564e78d06370d',
    'favicon-32.png': '6378991693ea5d4ed683c27b308257d59edbdb31',
    'icon-192.png': 'd0a350dfeb99f7c63c39df848e0c9f558eed1ed4',
    'icon-512.png': 'a6da8d3dbf523f4bc228ff0128fc23d97e4f5399',
    'icon-maskable-512.png': '646ea978818518147a9fabd0b625ec28622aeb73'
  };
  for (const [name, hash] of Object.entries(expected)) {
    const bytes = read(`campus/icons/${name}`);
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, hash, name);
  }
});
