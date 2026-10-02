// MUSIC_EDITOR_P0_01 · P0.7 Offline Acceptance
// End-to-end P0 acceptance:
// Project -> 2 audio assets -> 3 Cues -> 2 PlaceZone + 1 Room Bindings ->
// Runtime Preview transitions -> Undo/Redo -> Save -> Reload -> Reopen ->
// Export -> Import -> Validate -> Save -> dispose/reboot.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const FIXTURE = "MUSIC_EDITOR_P0_01";

function wavFixture({ sampleRate = 8000, seconds = 1.2, frequency = 220 } = {}) {
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
    const sample = Math.sin(i / sampleRate * Math.PI * 2 * frequency) * 0.3;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function waitBoot(page, fatal) {
  const initial = "프로젝트 저장소 연결 중…";
  await page.goto(`${smoke.origin}/editor/music/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(text =>
      (document.getElementById("music-file-status")?.textContent ?? text) !== text,
    initial, { timeout: TIMEOUT_MS }),
    fatal
  ]);
}

async function change(page, selector, value) {
  const field = page.locator(selector);
  await field.fill(String(value));
  await field.dispatchEvent("change");
}

async function selectAsset(page, id) {
  await page.locator(`.music-asset-row[data-asset-id="${id}"]`).click();
  await page.waitForFunction(assetId =>
    document.querySelector(`.music-asset-row[data-asset-id="${assetId}"]`)?.dataset.selected === "true",
  id, { timeout: TIMEOUT_MS });
}

async function selectCue(page, id) {
  await page.locator(`.music-cue-row[data-cue-id="${id}"]`).click();
  await page.waitForFunction(cueId =>
    document.querySelector(`.music-cue-row[data-cue-id="${cueId}"]`)?.dataset.selected === "true",
  id, { timeout: TIMEOUT_MS });
}

async function authorRights(page, assetId, source, license) {
  await selectAsset(page, assetId);
  await change(page, '[data-right="source"]', source);
  await change(page, '[data-right="license"]', license);
  await page.locator('[data-right="approved"]').check();
}

async function addCue(page, assetId, {
  id,
  name,
  loopStart,
  loopEnd,
  fadeIn = 0.4,
  fadeOut = 0.4,
  gain = 0.75,
  priority = 0,
  tags = ""
}) {
  await selectAsset(page, assetId);
  await page.locator("#music-loop-enabled").check();
  await change(page, "#music-loop-start", loopStart);
  await change(page, "#music-loop-end", loopEnd);
  await page.locator("#music-add-cue").click();
  await page.waitForFunction(cueId =>
    Boolean(document.querySelector(`.music-cue-row[data-cue-id="${cueId}"]`)),
  id, { timeout: TIMEOUT_MS });
  await change(page, '[data-cue-field="name"]', name);
  await change(page, '[data-cue-field="gain"]', gain);
  await change(page, '[data-cue-transition="fadeInSeconds"]', fadeIn);
  await change(page, '[data-cue-transition="fadeOutSeconds"]', fadeOut);
  await change(page, '[data-cue-field="priority"]', priority);
  if (tags) await change(page, "[data-cue-tags]", tags);
  return id;
}

async function addPlaceBinding(page, cueId, targetId, priority) {
  await selectCue(page, cueId);
  await page.locator("#music-add-binding").click();
  await page.waitForFunction(() =>
    document.querySelector(".music-inspector-kicker")?.textContent === "MUSIC BINDING",
  null, { timeout: TIMEOUT_MS });
  await page.locator("[data-binding-target]").selectOption(targetId);
  await change(page, '[data-binding-field="priority"]', priority);
  return await page.locator('[data-binding-field="id"]').inputValue();
}

async function addRoomBinding(page, cueId, roomId, priority) {
  await selectCue(page, cueId);
  await page.locator("#music-add-binding").click();
  await page.locator('[data-binding-field="targetType"]').selectOption("room");
  await page.locator("[data-binding-target]").selectOption(roomId);
  await change(page, '[data-binding-field="priority"]', priority);
  return await page.locator('[data-binding-field="id"]').inputValue();
}

const started = Date.now();
const smoke = await startSmoke({ viewport: { width: 1440, height: 900 } });

try {
  let page = await smoke.context.newPage();
  let fatal = smoke.watch(page);
  await waitBoot(page, fatal);

  // 1. Project 생성
  await page.locator("#music-new").click();
  await change(page, "#music-project-name", FIXTURE);
  assert.equal(await page.locator("#music-project-name").inputValue(), FIXTURE);

  // 2. 음원 2개 등록
  await page.locator("#music-audio-input").setInputFiles([
    { name: "accept-gate.wav", mimeType: "audio/wav", buffer: wavFixture({ frequency: 220 }) },
    { name: "accept-shared.wav", mimeType: "audio/wav", buffer: wavFixture({ frequency: 330 }) }
  ]);
  await page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "2 assets",
  null, { timeout: TIMEOUT_MS });
  assert.equal(await page.locator(".music-asset-row").count(), 2);

  await authorRights(page, "music.accept-gate", "team acceptance fixture", "internal-test");
  await authorRights(page, "music.accept-shared", "team acceptance fixture", "internal-test");

  // 3-4. Cue 3개 생성 + Loop/Fade
  await addCue(page, "music.accept-gate", {
    id: "cue.accept-gate",
    name: "Gate Theme",
    loopStart: 0.10,
    loopEnd: 1.00,
    fadeIn: 0.35,
    fadeOut: 0.45,
    gain: 0.72,
    priority: 10,
    tags: "gate, campus"
  });

  await selectCue(page, "cue.accept-gate");
  await page.locator("#music-duplicate-cue").click();
  await page.waitForFunction(() =>
    Boolean(document.querySelector('.music-cue-row[data-cue-id="cue.accept-gate.copy"]')),
  null, { timeout: TIMEOUT_MS });
  await change(page, '[data-cue-field="name"]', "Inkyung Theme");
  await change(page, "#music-loop-start", 0.15);
  await change(page, "#music-loop-end", 1.05);
  await change(page, '[data-cue-transition="fadeInSeconds"]', 0.40);
  await change(page, '[data-cue-transition="fadeOutSeconds"]', 0.40);
  await change(page, '[data-cue-field="gain"]', 0.68);

  await addCue(page, "music.accept-shared", {
    id: "cue.accept-shared",
    name: "Personal Room Theme",
    loopStart: 0.12,
    loopEnd: 1.02,
    fadeIn: 0.30,
    fadeOut: 0.50,
    gain: 0.60,
    priority: 5,
    tags: "room, personal"
  });
  assert.equal(await page.locator(".music-cue-row").count(), 3);

  // 5. PlaceZone 2개 + Room 1개 Binding
  await addPlaceBinding(page, "cue.accept-gate", "AREA_MAIN_GATE", 10);
  await addPlaceBinding(page, "cue.accept-gate.copy", "AREA_INKYUNG_STUDENT_CENTER", 9);
  const roomBindingId = await addRoomBinding(page, "cue.accept-shared", "ROOM_PERSONAL_BASIC", 8);
  assert.equal(await page.locator(".music-binding-row").count(), 3);

  // 6. Preview 전환: Gate -> Inkyung -> Room
  await page.locator("#music-preview-unlock").click();
  await page.waitForFunction(() =>
    document.getElementById("music-preview-context")?.textContent === "running",
  null, { timeout: TIMEOUT_MS });

  await page.locator("#music-preview-space").selectOption("campus");
  await page.locator("#music-preview-place-zone").selectOption("AREA_MAIN_GATE");
  await page.waitForFunction(() =>
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("Gate Theme"),
  null, { timeout: TIMEOUT_MS });

  await page.locator("#music-preview-place-zone").selectOption("AREA_INKYUNG_STUDENT_CENTER");
  await page.waitForFunction(() =>
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("Inkyung Theme"),
  null, { timeout: TIMEOUT_MS });

  await page.locator("#music-preview-space").selectOption("ROOM_PERSONAL_BASIC");
  await page.waitForFunction(() =>
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("Personal Room Theme"),
  null, { timeout: TIMEOUT_MS });
  assert.ok(Number.parseInt(await page.locator("#music-preview-sources").textContent(), 10) >= 1);

  // 7. Undo/Redo
  await page.locator(`.music-binding-row[data-binding-id="${roomBindingId}"]`).click();
  await change(page, '[data-binding-field="priority"]', 7);
  assert.equal(await page.locator('[data-binding-field="priority"]').inputValue(), "7");
  await page.locator("#music-undo").click();
  assert.equal(await page.locator('[data-binding-field="priority"]').inputValue(), "8");
  await page.locator("#music-redo").click();
  assert.equal(await page.locator('[data-binding-field="priority"]').inputValue(), "7");

  // 8. Save
  await page.locator("#music-save").click();
  await page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("readback 완료"),
  null, { timeout: TIMEOUT_MS });

  // Capture canonical semantic state before reload.
  const canonicalBefore = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("inha-world-music-editor-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const settings = db.transaction("settings").objectStore("settings").get("lastProjectId");
      settings.onerror = () => { db.close(); reject(settings.error); };
      settings.onsuccess = () => {
        const projectId = settings.result;
        const request = db.transaction("canonical").objectStore("canonical").get(projectId);
        request.onerror = () => { db.close(); reject(request.error); };
        request.onsuccess = () => { db.close(); resolve(JSON.parse(request.result)); };
      };
    };
  }));
  assert.equal(canonicalBefore.assets.length, 2);
  assert.equal(canonicalBefore.cues.length, 3);
  assert.equal(canonicalBefore.bindings.length, 3);

  // 9. Browser Reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "2 assets",
  null, { timeout: TIMEOUT_MS });

  // 10. Reopen explicit saved Project
  await page.locator("#music-open-project").click();
  await page.waitForFunction(() => document.getElementById("music-project-dialog")?.open === true,
    null, { timeout: TIMEOUT_MS });
  assert.ok(await page.locator("#music-project-list button").count() >= 1);
  await page.locator("#music-project-list button").first().click();
  await page.waitForFunction(() =>
    document.getElementById("music-cue-count")?.textContent === "3" &&
    document.getElementById("music-binding-count")?.textContent === "3",
  null, { timeout: TIMEOUT_MS });

  // 11. Export
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#music-export").click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  assert.ok(exportPath, "acceptance export has a file path");
  const exportText = await readFile(exportPath, "utf8");
  const exported = JSON.parse(exportText);
  assert.deepEqual(exported, canonicalBefore, "Export preserves canonical meaning");

  // 12. Import exported music.json into a fresh Editor document.
  await page.locator("#music-new").click();
  assert.equal(await page.locator(".music-cue-row").count(), 0);
  await page.locator("#music-project-input").setInputFiles({
    name: "MUSIC_EDITOR_P0_01.music.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportText)
  });
  await page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "2 assets" &&
    document.getElementById("music-cue-count")?.textContent === "3" &&
    document.getElementById("music-binding-count")?.textContent === "3",
  null, { timeout: TIMEOUT_MS });

  // 13. Validate imported project.
  await page.locator("#music-validate").click();
  await page.waitForFunction(() =>
    document.getElementById("music-validation-dialog")?.open === true,
  null, { timeout: TIMEOUT_MS });
  assert.equal(await page.locator('.validation-row[data-severity="ERROR"]').count(), 0);
  assert.match(await page.locator("#music-validation-summary").textContent(), /0 errors/);
  await page.locator("#music-validation-close").click();

  // Save imported state to make reboot deterministic.
  await page.locator("#music-save").click();
  await page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("readback 완료"),
  null, { timeout: TIMEOUT_MS });

  // 14. Dispose / reboot: close page (beforeunload disposes preview), open a new page in same context.
  await page.close();
  page = await smoke.context.newPage();
  fatal = smoke.watch(page);
  await waitBoot(page, fatal);
  await page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "2 assets" &&
    document.getElementById("music-cue-count")?.textContent === "3" &&
    document.getElementById("music-binding-count")?.textContent === "3",
  null, { timeout: TIMEOUT_MS });

  const canonicalAfter = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("inha-world-music-editor-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const settings = db.transaction("settings").objectStore("settings").get("lastProjectId");
      settings.onerror = () => { db.close(); reject(settings.error); };
      settings.onsuccess = () => {
        const request = db.transaction("canonical").objectStore("canonical").get(settings.result);
        request.onerror = () => { db.close(); reject(request.error); };
        request.onsuccess = () => { db.close(); resolve(JSON.parse(request.result)); };
      };
    };
  }));
  assert.deepEqual(canonicalAfter, canonicalBefore, "Document meaning survives export/import/reboot");

  // Preview should reboot locked and have no leaked live source until explicitly enabled again.
  assert.equal(await page.locator("#music-preview-context").textContent(), "locked");
  assert.equal(Number.parseInt(await page.locator("#music-preview-sources").textContent(), 10), 0);

  assert.deepEqual(smoke.problems, [], "acceptance leaves no page/console/same-origin errors");
  console.log(`${FIXTURE}: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s · 2 assets · 3 cues · 3 bindings · semantic readback stable`);
} catch (error) {
  console.error(`${FIXTURE}: FAIL`);
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  throw error;
} finally {
  await smoke.close();
}
