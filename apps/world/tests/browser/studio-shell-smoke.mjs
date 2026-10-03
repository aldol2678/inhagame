import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

function wavFixture({ sampleRate = 8000, seconds = 0.2, frequency = 220 } = {}) {
  const samples = Math.floor(sampleRate * seconds);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.sin(i / sampleRate * Math.PI * 2 * frequency) * 0.25;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

const started = Date.now();
const smoke = await startSmoke({ viewport: { width: 1440, height: 900 } });
const race = (fatal, promise) => Promise.race([promise, fatal]);

try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);

  await page.goto(`${smoke.origin}/studio/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().ready === true &&
    window.__INHA_STUDIO_S3__.getStatus().worldAdapter?.ready === true,
  null, { timeout: TIMEOUT_MS }));

  let status = await page.evaluate(() => window.__INHA_STUDIO_S3__.getStatus());
  assert.equal(status.stage, "S3.4");
  assert.equal(status.activeModuleId, "world");
  assert.deepEqual(status.modules.map(module => module.id), ["world", "audio", "npc", "event", "gameplay"]);
  assert.equal(await page.locator(".studio-module-button").count(), 5);
  assert.equal(await page.locator("#studio-preview").isEnabled(), true);
  assert.equal(await page.locator("#studio-save").isEnabled(), true);

  const worldFrame = () => page.frameLocator("#studio-world-frame");
  await worldFrame().locator("#editor-file-status").waitFor({ state: "attached", timeout: TIMEOUT_MS });
  assert.equal(await worldFrame().locator(".editor-topbar").isHidden(), true, "host mode hides duplicate World topbar");
  assert.equal(await worldFrame().locator(".editor-workspace").isVisible(), true);

  // S1 regression: real World edit -> outer dirty sync -> Studio save -> Studio runtime preview.
  await worldFrame().locator('[data-editor-asset="asset.test-cube"]').click();
  await race(fatal, page.waitForFunction(() => {
    const world = window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter;
    return world?.dirty === true && world.entityCount === 1 && world.revision >= 1;
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('[data-studio-world-dirty="true"]').count(), 1);

  // S3.2 Content Browser: live Scene data is listed and can drive the embedded editor selection.
  await page.locator('.studio-content-section[data-section-id="scene"] [data-content-kind="entity"]').waitFor({
    state: "visible", timeout: TIMEOUT_MS
  });
  const worldContentRow = page.locator('.studio-content-section[data-section-id="scene"] [data-content-kind="entity"]').first();
  const worldEntityId = await worldContentRow.getAttribute("data-content-id");
  assert.ok(worldEntityId, "World Content Browser exposes a stable entity id");
  await worldFrame().locator("#editor-viewport").click({ position: { x: 8, y: 8 } });
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.selectedEntityId === null,
  null, { timeout: TIMEOUT_MS }));
  await worldContentRow.click();
  await race(fatal, page.waitForFunction(entityId =>
    window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.selectedEntityId === entityId,
  worldEntityId, { timeout: TIMEOUT_MS }));
  assert.equal(await worldContentRow.getAttribute("data-selected"), "true");

  // S3.4 Asset Registry: the World module is indexed even when the bootstrap scene has no model Asset.
  // The default Test Prop is a data-only entity, not a persisted model Asset.
  await race(fatal, page.waitForFunction(() => {
    const registry = window.__INHA_STUDIO_S3__?.getStatus?.().assetRegistry;
    return registry?.indexedModules?.includes("world") === true;
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('[data-section-id="registry"]').count(), 1);

  // S3.3 Inspector: edit the selected World Entity through Studio, then verify the hosted editor.
  const worldNameInput = page.locator('[data-field-key="name"] [data-inspector-field="name"]');
  await worldNameInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  const originalWorldName = await worldNameInput.inputValue();
  await worldNameInput.fill("Studio Cube QA");
  await worldNameInput.dispatchEvent("change");
  await race(fatal, page.waitForFunction(() =>
    document.querySelector('[data-section-id="scene"] [data-content-kind="entity"] .studio-content-row-label')?.textContent === "Studio Cube QA",
  null, { timeout: TIMEOUT_MS }));

  const worldPositionX = page.locator('[data-field-key="position.x"] [data-inspector-field="position.x"]');
  const originalPositionX = await worldPositionX.inputValue();
  await worldPositionX.fill("3.5");
  await worldPositionX.dispatchEvent("change");
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("studio-world-frame")?.contentDocument
      ?.querySelector('[aria-label="Position X"]')?.value === "3.5",
  null, { timeout: TIMEOUT_MS }));

  await page.locator("#studio-save").click();
  await race(fatal, page.waitForFunction(() => {
    const world = window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter;
    return world?.dirty === false && /읽기 검증 완료/.test(world.fileStatus || "");
  }, null, { timeout: TIMEOUT_MS }));

  // S3 Shared Core: Inspector edits join the same History stack as native editor commands.
  await page.locator('[data-bottom-tab="history"]').click();
  const undoButton = page.locator('[data-studio-core-action="undo"]');
  const redoButton = page.locator('[data-studio-core-action="redo"]');
  await undoButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  assert.equal(await undoButton.isEnabled(), true);

  // Undo Set Transform.
  await undoButton.click();
  await race(fatal, page.waitForFunction(expected =>
    document.getElementById("studio-world-frame")?.contentDocument
      ?.querySelector('[aria-label="Position X"]')?.value === expected,
  originalPositionX, { timeout: TIMEOUT_MS }));

  // Undo Rename Entity.
  await undoButton.click();
  await race(fatal, page.waitForFunction(expected =>
    document.querySelector('[data-section-id="scene"] [data-content-kind="entity"] .studio-content-row-label')?.textContent === expected,
  originalWorldName, { timeout: TIMEOUT_MS }));

  // Undo Add Entity.
  await undoButton.click();
  await race(fatal, page.waitForFunction(() => {
    const world = window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter;
    return world?.entityCount === 0 && world?.canRedo === true;
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await redoButton.isEnabled(), true);

  // Redo Add -> Rename -> Transform.
  await redoButton.click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.entityCount === 1,
  null, { timeout: TIMEOUT_MS }));

  await redoButton.click();
  await race(fatal, page.waitForFunction(() =>
    document.querySelector('[data-section-id="scene"] [data-content-kind="entity"] .studio-content-row-label')?.textContent === "Studio Cube QA",
  null, { timeout: TIMEOUT_MS }));

  await redoButton.click();
  await race(fatal, page.waitForFunction(() => {
    const frame = document.getElementById("studio-world-frame");
    const x = frame?.contentDocument?.querySelector('[aria-label="Position X"]')?.value;
    return x === "3.5" && window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.canUndo === true;
  }, null, { timeout: TIMEOUT_MS }));

  await page.locator('[data-bottom-tab="validation"]').click();
  await page.locator('[data-studio-core-action="validate"]').click();
  await race(fatal, page.waitForFunction(() =>
    document.querySelector('.studio-core-result[data-valid="true"]')?.textContent?.includes("PASS"),
  null, { timeout: TIMEOUT_MS }));
  assert.match(await page.locator('.studio-core-result[data-valid="true"]').textContent(), /0 errors/);
  await page.locator('[data-bottom-tab="console"]').click();

  await page.locator("#studio-preview").click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.previewOpen === true,
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await worldFrame().locator("#editor-preview-toggle").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#studio-preview").getAttribute("aria-pressed"), "true");

  await page.locator("#studio-preview").click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().worldAdapter?.previewOpen === false,
  null, { timeout: TIMEOUT_MS }));

  // S2: Audio module is a real hosted Music Editor, not a legacy link.
  await page.locator('[data-module-id="audio"]').click();
  await race(fatal, page.waitForFunction(() => {
    const next = window.__INHA_STUDIO_S3__?.getStatus?.();
    return next?.activeModuleId === "audio" && next.audioAdapter?.ready === true;
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#studio-world-frame").count(), 0);
  assert.equal(await page.locator("#studio-audio-frame").count(), 1);
  assert.equal(await page.locator("#studio-save").isEnabled(), true);
  assert.equal(await page.locator("#studio-preview").isEnabled(), true);

  const audioFrame = () => page.frameLocator("#studio-audio-frame");
  await audioFrame().locator("#music-file-status").waitFor({ state: "attached", timeout: TIMEOUT_MS });
  assert.equal(await audioFrame().locator(".music-topbar").isHidden(), true, "host mode hides duplicate Music topbar");
  assert.equal(await audioFrame().locator(".music-workspace").isVisible(), true);

  status = await page.evaluate(() => window.__INHA_STUDIO_S3__.getStatus());
  assert.equal(status.audioAdapter.assetCount, 0);
  assert.equal(status.audioAdapter.cueCount, 0);
  assert.equal(status.audioAdapter.bindingCount, 0);
  assert.equal(status.audioAdapter.placePreviewOpen, false);

  // New project proves MusicDocument dirty state propagates through the host bridge.
  await audioFrame().locator("#music-new").click();
  await race(fatal, page.waitForFunction(() => {
    const audio = window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter;
    return audio?.dirty === true &&
      String(audio.projectId || "").startsWith("inha-world-music-") &&
      audio.name === "INHA WORLD · New Music Project";
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('[data-studio-audio-dirty="true"]').count(), 1);

  // S3.2 Content Browser: create one real Asset/Cue/Binding and select each from Studio.
  await audioFrame().locator("#music-audio-input").setInputFiles({
    name: "studio-content.wav",
    mimeType: "audio/wav",
    buffer: wavFixture()
  });
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter?.assetCount === 1,
  null, { timeout: TIMEOUT_MS }));
  await audioFrame().locator("#music-add-cue").click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter?.cueCount === 1,
  null, { timeout: TIMEOUT_MS }));
  await audioFrame().locator("#music-add-binding").click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter?.bindingCount === 1,
  null, { timeout: TIMEOUT_MS }));

  const audioAssetRow = page.locator('[data-section-id="assets"] [data-content-kind="asset"]').first();
  const audioCueRow = page.locator('[data-section-id="cues"] [data-content-kind="cue"]').first();
  const audioBindingRow = page.locator('[data-section-id="bindings"] [data-content-kind="binding"]').first();
  await audioBindingRow.waitFor({ state: "visible", timeout: TIMEOUT_MS });

  const audioAssetId = await audioAssetRow.getAttribute("data-content-id");
  const audioCueId = await audioCueRow.getAttribute("data-content-id");
  const audioBindingId = await audioBindingRow.getAttribute("data-content-id");
  assert.ok(audioAssetId && audioCueId && audioBindingId);

  await audioAssetRow.click();
  await race(fatal, page.waitForFunction(id => {
    const audio = window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter;
    return audio?.selectedAssetId === id && !audio.selectedCueId && !audio.selectedBindingId;
  }, audioAssetId, { timeout: TIMEOUT_MS }));

  const assetTitleInput = page.locator('[data-field-key="title"] [data-inspector-field="title"]');
  await assetTitleInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await assetTitleInput.fill("Studio Track QA");
  await assetTitleInput.dispatchEvent("change");
  await race(fatal, page.waitForFunction(() =>
    document.querySelector('[data-section-id="assets"] [data-content-kind="asset"] .studio-content-row-label')?.textContent === "Studio Track QA",
  null, { timeout: TIMEOUT_MS }));
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("studio-audio-frame")?.contentDocument
      ?.querySelector('[data-field="title"]')?.value === "Studio Track QA",
  null, { timeout: TIMEOUT_MS }));

  // Registry keeps both module indexes and contains the real imported Audio asset.
  // The bootstrap World scene intentionally has no persisted model Asset.
  await race(fatal, page.waitForFunction(() => {
    const registry = window.__INHA_STUDIO_S3__?.getStatus?.().assetRegistry;
    return registry?.indexedModules?.includes("world") &&
      registry?.indexedModules?.includes("audio") &&
      registry.counts?.audio === 1;
  }, null, { timeout: TIMEOUT_MS }));

  const registrySearch = page.locator('[aria-label="Asset Registry search"]');
  const registryFilter = page.locator('[aria-label="Asset Registry type filter"]');
  await registryFilter.selectOption("audio");
  await registrySearch.fill("Studio Track QA");
  assert.equal(await page.locator('[data-registry-module="audio"][data-registry-type="audio"]').count(), 1);
  assert.equal(await page.locator('[data-registry-module="world"]').count(), 0);
  await registrySearch.fill("");
  await registryFilter.selectOption("");

  await audioCueRow.click();
  await race(fatal, page.waitForFunction(id =>
    window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter?.selectedCueId === id,
  audioCueId, { timeout: TIMEOUT_MS }));

  const cueGainInput = page.locator('[data-field-key="gain"] [data-inspector-field="gain"]');
  await cueGainInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await cueGainInput.fill("0.75");
  await cueGainInput.dispatchEvent("change");
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("studio-audio-frame")?.contentDocument
      ?.querySelector('[data-cue-field="gain"]')?.value === "0.75",
  null, { timeout: TIMEOUT_MS }));

  await audioBindingRow.click();
  await race(fatal, page.waitForFunction(id =>
    window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter?.selectedBindingId === id,
  audioBindingId, { timeout: TIMEOUT_MS }));
  await race(fatal, page.waitForFunction(id =>
    document.querySelector('[data-section-id="bindings"] [data-content-kind="binding"][data-selected="true"]')
      ?.getAttribute("data-content-id") === id,
  audioBindingId, { timeout: TIMEOUT_MS }));
  assert.equal(await audioBindingRow.getAttribute("data-selected"), "true");

  const bindingPriorityInput = page.locator('[data-field-key="priority"] [data-inspector-field="priority"]');
  await bindingPriorityInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await bindingPriorityInput.fill("4");
  await bindingPriorityInput.dispatchEvent("change");
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("studio-audio-frame")?.contentDocument
      ?.querySelector('[data-binding-field="priority"]')?.value === "4",
  null, { timeout: TIMEOUT_MS }));

  // Studio Save delegates to MusicBrowserStore verified canonical write.
  await page.locator("#studio-save").click();
  await race(fatal, page.waitForFunction(() => {
    const audio = window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter;
    return audio?.dirty === false && /readback 완료/.test(audio.fileStatus || "");
  }, null, { timeout: TIMEOUT_MS }));

  // Studio Preview toggles the Music WebAudio runtime running -> suspended.
  await page.locator("#studio-preview").click();
  await race(fatal, page.waitForFunction(() => {
    const audio = window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter;
    return audio?.previewEnabled === true && audio.previewContext === "running";
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await audioFrame().locator("#music-preview-context").textContent(), "running");
  assert.equal(await page.locator("#studio-preview").getAttribute("aria-pressed"), "true");

  await page.locator("#studio-preview").click();
  await race(fatal, page.waitForFunction(() => {
    const audio = window.__INHA_STUDIO_S3__?.getStatus?.().audioAdapter;
    return audio?.previewEnabled === false && audio.previewContext === "suspended";
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await audioFrame().locator("#music-preview-context").textContent(), "suspended");
  assert.equal(await page.locator("#studio-preview").getAttribute("aria-pressed"), "false");

  await page.locator('[data-bottom-tab="history"]').click();
  assert.equal(await page.locator('[data-studio-core-action="undo"]').isEnabled(), true,
    "Audio Cue/Binding authoring is visible to Shared History");

  await page.locator('[data-bottom-tab="validation"]').click();
  await page.locator('[data-studio-core-action="validate"]').click();
  await race(fatal, page.waitForFunction(() =>
    document.querySelector('.studio-core-result[data-valid="true"]')?.textContent?.includes("PASS"),
  null, { timeout: TIMEOUT_MS }));
  assert.match(await page.locator('.studio-core-result[data-valid="true"]').textContent(), /0 errors/);
  await page.locator('[data-bottom-tab="console"]').click();

  // Switching away disposes Audio host. Returning remounts the saved project.
  await page.locator('[data-module-id="world"]').click();
  await race(fatal, page.waitForFunction(() => {
    const next = window.__INHA_STUDIO_S3__?.getStatus?.();
    return next?.activeModuleId === "world" && next.worldAdapter?.ready === true && next.worldAdapter.entityCount === 1;
  }, null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#studio-audio-frame").count(), 0);

  // Cross-module Registry routing: click cached Audio asset while World is active.
  const registryAudioRow = page.locator('[data-registry-module="audio"][data-registry-type="audio"]').first();
  await registryAudioRow.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await registryAudioRow.click();
  await race(fatal, page.waitForFunction(assetId => {
    const next = window.__INHA_STUDIO_S3__?.getStatus?.();
    return next?.activeModuleId === "audio" &&
      next.audioAdapter?.ready === true &&
      next.audioAdapter.selectedAssetId === assetId &&
      !next.audioAdapter.selectedCueId &&
      !next.audioAdapter.selectedBindingId &&
      next.audioAdapter.name === "INHA WORLD · New Music Project" &&
      next.audioAdapter.dirty === false;
  }, audioAssetId, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#studio-audio-frame").count(), 1);
  await page.locator('[data-field-key="title"] [data-inspector-field="title"]').waitFor({
    state: "visible", timeout: TIMEOUT_MS
  });

  await page.locator('[data-module-id="npc"]').click();
  await race(fatal, page.waitForFunction(() => window.__INHA_STUDIO_S3__.getStatus().activeModuleId === "npc"));
  assert.equal(await page.locator(".studio-module-status").getAttribute("data-status"), "planned");
  assert.match(await page.locator(".studio-module-status").textContent(), /PLANNED/);

  // Mobile regression with hosted Audio mounted.
  await page.locator('[data-module-id="audio"]').click();
  await race(fatal, page.waitForFunction(() =>
    window.__INHA_STUDIO_S3__?.getStatus?.().activeModuleId === "audio" &&
    window.__INHA_STUDIO_S3__.getStatus().audioAdapter?.ready === true,
  null, { timeout: TIMEOUT_MS }));
  await page.setViewportSize({ width: 390, height: 844 });
  await race(fatal, page.waitForFunction(() => window.__INHA_STUDIO_S3__.getStatus().layoutMode === "mobile"));
  const mobile = await page.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    appWidth: document.getElementById("studio-app")?.getBoundingClientRect().width ?? 0,
    frameWidth: document.getElementById("studio-audio-frame")?.getBoundingClientRect().width ?? 0
  }));
  assert.ok(mobile.documentWidth <= mobile.innerWidth + 1, `mobile document overflow: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.bodyWidth <= mobile.innerWidth + 1, `mobile body overflow: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.appWidth <= mobile.innerWidth + 1, `mobile app overflow: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.frameWidth <= mobile.innerWidth + 1, `mobile hosted Audio Editor exceeds viewport: ${JSON.stringify(mobile)}`);
  assert.equal(await page.locator("#studio-preview").isVisible(), true);
  assert.equal(await page.locator("#studio-save").isVisible(), true);

  await page.locator("#studio-content-toggle").click();
  status = await page.evaluate(() => window.__INHA_STUDIO_S3__.getStatus());
  assert.equal(status.contentOpen, true);
  await page.locator("#studio-inspector-toggle").click();
  status = await page.evaluate(() => window.__INHA_STUDIO_S3__.getStatus());
  assert.equal(status.inspectorOpen, true);
  assert.equal(status.contentOpen, false);

  assert.deepEqual(smoke.problems, [], "no page errors, console errors or failed same-origin requests");
  console.log(`studio S3.4 asset-registry smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error("studio S3.4 asset-registry smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  throw error;
} finally {
  await smoke.close();
}
