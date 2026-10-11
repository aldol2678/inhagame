import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../campus/index.html', import.meta.url), 'utf8');
const update = main.slice(main.indexOf('app.on("update", (dt) => {\n  syncAudio();'));

test('main wires one global HUD entry, never a place-bound context action', () => {
  assert.match(main, /bindPhotoModeEntry\(\{ button: document\.getElementById\("photo-mode-toggle"\), mode: photoMode \}\)/);
  assert.doesNotMatch(main, /inkyung-photo|photoMode\.contextAction/);
  assert.match(update, /photoModeEntry\.refresh\(\);/);
  assert.match(html, /<div class="social-cluster"[^>]*>[\s\S]*?<button id="photo-mode-toggle" type="button" aria-label="사진 모드 열기 \(P\)" aria-keyshortcuts="P"[^>]*>📷<span>사진<\/span><\/button>\s*<\/div>/);
  assert.match(html, /<kbd>P<\/kbd><\/span><strong>사진 모드<\/strong>/);
});

test('one camera-transform owner per frame: the photo rig replaces the orbit and every scripted override', () => {
  const branch = update.match(/if \(photoMode\.active && photoMode\.applyCamera\(dt\)\) \{([\s\S]*?)\n  \} else \{([\s\S]*?)\n  \}\n/);
  assert.ok(branch, 'the camera site branches on Photo Mode');
  assert.doesNotMatch(branch[1], /orbit\.apply|applyCamera\(\)/, 'nothing else writes the camera while the rig owns it');
  assert.match(branch[1], /character\.setCameraOccluded\(photoCamera\.distanceTo\(eye\) < PHOTO_SUBJECT_CLEARANCE\)/);
  assert.match(branch[2], /orbit\.apply\(pos, character\.eyeHeight\);[\s\S]*biryong\?\.applyCamera\(\);[\s\S]*backGateArrival\?\.applyCamera\(\);/);
  assert.equal(update.slice(update.indexOf('roomSession?.update(dt);'), update.indexOf('if (photoMode.active && photoMode.applyCamera(dt))'))
    .match(/orbit\.apply\(pos, character\.eyeHeight\)/g)?.length ?? 0, 1, 'only the cinematic path applies the orbit before the branch');
  assert.match(update, /character\.setFirstPerson\(orbit\.firstPerson && !photoMode\.active\);/);
});

test('lifecycle validates before transition early returns and never persists the photo camera as resume camera', () => {
  assert.ok(update.indexOf('photoMode.update()') >= 0 && update.indexOf('photoMode.update()') < update.indexOf('if (rooms.status().busy'));
  const resume = update.slice(update.indexOf('resumeStore.maybeSave({'), update.indexOf('if (!inside) streaming.update'));
  assert.match(resume, /cameraYaw: orbit\.yaw/);
  assert.match(resume, /enabled: .* !photoMode\.active/);
});

test('the rig reuses the gameplay camera collision authority and the existing expression/account teardown', () => {
  assert.match(main, /obstacles: \(\) => orbit\.indoor \? orbit\.indoor\.obstacles : orbit\.outdoorObstacles/);
  assert.match(main, /floorHeight: \(x, z\) => \{[\s\S]*controller\.space\?\.groundHeight\?\.\(x, z\)/);
  assert.match(main, /requestPose: \(\) => seats\.isSeated \? "seated" : requestEmote\("photo_pose"\)/);
  assert.match(main, /region: biryongRealm\?\.inBiryong === true \? "biryong" : "campus"/);
  assert.match(main, /getMouseLook: \(\) => \(\{ sensitivity: orbit\.mouseSensitivity, invertY: orbit\.invertMouseY \}\)/);
  assert.match(main, /online\.onIdentity\(\(identity\) => \{\s*photoMode\.close\("lifecycle"\)/);
  assert.match(main, /photoModeEntry\.destroy\(\); photoModePanel\.destroy\(\); photoInput\.destroy\(\); photoMode\.destroy\(\);/);
});

test('photo export uses the existing app canvas and the panel owns its capture lifecycle', async () => {
  const capture = await readFile(new URL('../src/photo/photo-capture.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/photo/photo-mode-panel.js', import.meta.url), 'utf8');
  assert.match(main, /const photoCapture = createPhotoCapture\(\{ app, canvas, mode: photoMode, diagnostics: photoDiagnosticsEnabled \}\)/);
  assert.match(main, /capture: photoCapture/);
  assert.match(main, /const photoDiagnosticsEnabled = previewHost && startupParams.get\('photoDiagnostics'\) === '1';/);
  assert.match(main, /\.\.\.\(photoDiagnosticsEnabled \? \{ getPhotoCaptureDiagnostics: \(\) => photoCapture\.diagnostics\(\) \} : \{\}\)/);
  assert.match(capture, /app\.on\('frameend', job\.frame\)/);
  assert.doesNotMatch(capture, /preserveDrawingBuffer|new pc\.|app\.render\(|fetch\(|localStorage|sessionStorage/);
  assert.match(panel, /capture\?\.destroy\(\)/);
  assert.doesNotMatch(panel, /window\.open|win\.open|navigator\.share|localStorage|sessionStorage/);
});

test('photo CSS keeps the frame clear: HUD hidden in place, edge-anchored controls, no centre dock', () => {
  assert.match(css, /body\[data-photo-mode="active"\] > :not\(#application\):not\(\.photo-mode\)/);
  assert.match(css, /\.photo-mode\[hidden\]\s*\{\s*display: none/);
  for (const inset of ['top', 'right', 'bottom', 'left']) assert.match(css, new RegExp(`--photo-edge-${inset[0]}: max\\(\\d+px, env\\(safe-area-inset-${inset}\\)\\)`));
  assert.doesNotMatch(css, /photo-mode-dock|photo-mode-range/);
  assert.match(css, /\.photo-mode\[data-ui="hidden"\] > :not\(\.photo-mode-restore\):not\(\.photo-mode-flash\) \{ display: none !important; \}/);
  assert.match(css, /\.photo-mode\[data-grid="thirds"\] \.photo-mode-grid \{/);
  assert.match(css, /\.photo-mode-pad, \.photo-mode-vertical \{ display: none; \}\s*@media \(pointer: coarse\) \{/);
  assert.match(css, /@media \(pointer: coarse\) and \(orientation: portrait\) \{\s*\.photo-mode-pad, \.photo-mode-vertical \{ bottom: 92px; \}/);
  // Coarse short-landscape rules live inside the single LANDSCAPE-HUD authority block.
  const landscape = css.slice(css.indexOf('/* LANDSCAPE-HUD:start'), css.indexOf('/* LANDSCAPE-HUD:end */'));
  assert.match(landscape, /body \.photo-mode-pad \{ width: 96px; height: 96px; \}/);
  assert.match(landscape, /body \.photo-mode-settings \{ right: calc\(var\(--photo-edge-r\) \+ 60px\); \}/);
  assert.match(css, /@media \(max-height: 500px\) \{\s*\.photo-mode \{\s*--photo-edge-t: max\(8px, env\(safe-area-inset-top\)\);/);
  assert.match(css, /body\.joystick-right \.photo-mode-pad \{ left: auto; right: 0; \}/);
  assert.match(css, /\.photo-mode-shutter \{[^}]*width: 72px; height: 72px;/);
  for (const selector of ['.photo-mode-icon', '.photo-mode-restore', '.photo-mode-side', '.photo-mode-lift'])
    assert.ok(css.includes(selector), `${selector} styled`);
  assert.match(css, /\.photo-mode-icon, \.photo-mode-restore, \.photo-mode-side, \.photo-mode-lift \{\s*width: 44px; height: 44px;/, '44px minimum targets');
  assert.match(css, /\.social-cluster #photo-mode-toggle,\n\.social-cluster #nearby-toggle,/);
});

test('campus canvas is a programmatic focus-return anchor without an extra Tab stop', () => {
  assert.match(html, /<canvas id="application" tabindex="-1"/);
});
