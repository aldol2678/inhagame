import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('main wires one context action, existing expression and explicit account/page teardown', () => {
  assert.match(main, /contextActions\.set\("inkyung-photo", photoMode\.contextAction\(\)\)/);
  assert.match(main, /requestPose: \(\) => requestEmote\("photo_pose"\)/);
  assert.match(main, /online\.onIdentity\(\(identity\) => \{\s*photoMode\.close\("lifecycle"\)/);
  assert.match(main, /photoModePanel\.destroy\(\); photoMode\.destroy\(\)/);
});

test('photo lifecycle validates before busy early return and never persists temporary framing as resume camera', () => {
  const update = main.slice(main.indexOf('app.on("update", (dt) => {\n  syncAudio();'));
  assert.ok(update.indexOf('photoMode.update()') >= 0 && update.indexOf('photoMode.update()') < update.indexOf('if (rooms.status().busy'));
  const resume = update.slice(update.indexOf('resumeStore.maybeSave({'), update.indexOf('if (!inside) streaming.update'));
  assert.match(resume, /enabled: .* !photoMode\.active/);
});

test('photo CSS keeps the camera and exit UI visible while hiding the existing HUD without resetting its state', () => {
  assert.match(css, /body\[data-photo-mode="active"\]/);
  assert.match(css, /:not\(#application\):not\(\.photo-mode\)/);
  assert.match(css, /\.photo-mode\[hidden\]\s*\{\s*display: none/);
  assert.match(css, /safe-area-inset-bottom/);
});

test('campus canvas is a programmatic focus-return anchor without an extra Tab stop', async () => {
  const html = await readFile(new URL('../campus/index.html', import.meta.url), 'utf8');
  assert.match(html, /<canvas id="application" tabindex="-1"/);
});


test('photo export uses the existing app canvas and the panel owns its capture lifecycle', async () => {
  const capture = await readFile(new URL('../src/photo/photo-capture.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/photo/photo-mode-panel.js', import.meta.url), 'utf8');
  assert.match(main, /capture: createPhotoCapture\(\{ app, canvas, mode: photoMode \}\)/);
  assert.match(capture, /app\.on\('frameend', job\.frame\)/);
  assert.doesNotMatch(capture, /preserveDrawingBuffer|new pc\.|app\.render\(|fetch\(|localStorage|sessionStorage/);
  assert.match(panel, /capture\?\.destroy\(\)/);
  assert.doesNotMatch(panel, /window\.open|win\.open|navigator\.share|localStorage|sessionStorage/);
});
