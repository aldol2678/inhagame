import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const campus = new URL('../campus/', import.meta.url);
const read = (name) => readFileSync(new URL(name, campus));
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));
const html = read('index.html').toString('utf8');

test('integrated PWA preserves campus identity and launch while extending portal scope', () => {
  assert.equal(manifest.id, '/campus/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/campus/?lobby=1');
  assert.equal(manifest.display, 'standalone');
  assert.match(html, /rel="manifest" href="\/campus\/manifest\.webmanifest"/);
  assert.doesNotMatch(html, /navigator\.serviceWorker\.register/);
});

test('campus icon declarations resolve to matching PNG dimensions', () => {
  const expected = new Map([
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/icon-maskable-512.png', 512],
    ['icons/apple-touch-icon.png', 180],
    ['icons/favicon-32.png', 32],
    ['icons/favicon-16.png', 16],
  ]);
  for (const [path, size] of expected) {
    const png = read(path);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
    assert.equal(png.readUInt32BE(16), size, path);
    assert.equal(png.readUInt32BE(20), size, path);
  }
  assert.equal(manifest.icons.length, 3);
  for (const icon of manifest.icons) {
    const path = icon.src.slice('/campus/'.length);
    assert.ok(expected.has(path), icon.src);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.sizes, expected.get(path) + 'x' + expected.get(path));
  }
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
  assert.match(html, /href="\/campus\/icons\/favicon-32\.png"/);
});
