import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('all arcade cards reuse the already published official mascot without altering its pixels', async () => {
  const html = await read('index.html');
  assert.equal((html.match(/class="portal-official-mascot" src="\/campus\/icons\/icon-512\.png"/g) || []).length, 4);
  const png = await readFile(new URL('../campus/icons/icon-512.png', import.meta.url));
  const blobSha = createHash('sha1').update(`blob ${png.length}\0`).update(png).digest('hex');
  assert.equal(blobSha, 'a6da8d3dbf523f4bc228ff0128fc23d97e4f5399');
  assert.doesNotMatch(await read('assets/hub/classic-concept.svg'), /ellipse cx="151"|circle cx="137"/);
  assert.doesNotMatch(await read('assets/hub/survival-concept.svg'), /translate\(148 103\)/);
  assert.doesNotMatch(await read('assets/hub/induck-grow-concept.svg'), /translate\(142 92\)/);
});
