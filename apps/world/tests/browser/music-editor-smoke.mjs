// Music Editor P0.0-P0.6 browser smoke.
// Proves real UI boot, local audio Blob import/decode, waveform/loop authoring,
// Cue + Binding authoring/history + Runtime Preview + hardened Validation/Export readback.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

function wavFixture({ sampleRate = 8000, seconds = 0.5, frequency = 220 } = {}) {
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
    const sample = Math.sin(i / sampleRate * Math.PI * 2 * frequency) * 0.35;
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
  const initial = "프로젝트 저장소 연결 중…";

  await page.goto(`${smoke.origin}/editor/music/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await race(fatal, page.waitForFunction(text =>
    (document.getElementById("music-file-status")?.textContent ?? text) !== text,
  initial, { timeout: TIMEOUT_MS }));

  // P0.8 mobile regression: the editor must fit a phone viewport without horizontal clipping.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    appWidth: document.querySelector(".music-app")?.getBoundingClientRect().width ?? 0,
    workspaceDisplay: getComputedStyle(document.querySelector(".music-workspace")).display,
    bodyMinWidth: getComputedStyle(document.body).minWidth,
    waveformWidth: document.getElementById("music-waveform")?.getBoundingClientRect().width ?? 0
  }));
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1,
    `mobile document has horizontal overflow: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.bodyWidth <= mobileLayout.viewportWidth + 1,
    `mobile body has horizontal overflow: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.appWidth <= mobileLayout.viewportWidth + 1,
    `mobile app exceeds viewport: ${JSON.stringify(mobileLayout)}`);
  assert.equal(mobileLayout.workspaceDisplay, "flex");
  assert.equal(mobileLayout.bodyMinWidth, "0px");
  assert.ok(mobileLayout.waveformWidth >= 300, "mobile waveform remains usable");
  await page.setViewportSize({ width: 1440, height: 900 });

  assert.equal(await page.locator("#music-asset-count").textContent(), "0 assets");
  await page.locator("#music-audio-input").setInputFiles({
    name: "biryong-test.wav",
    mimeType: "audio/wav",
    buffer: wavFixture()
  });

  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "1 assets",
  null, { timeout: TIMEOUT_MS }));
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("등록 완료"),
  null, { timeout: TIMEOUT_MS }));

  assert.equal(await page.locator(".music-asset-row").count(), 1);
  assert.equal(await page.locator("#music-transport").isVisible(), true);
  const canvas = await page.locator("#music-waveform").evaluate(node => [node.width, node.height]);
  assert.ok(canvas[0] > 0 && canvas[1] > 0, "waveform has a drawing buffer");

  await page.locator("#music-loop-enabled").check();
  await page.locator("#music-loop-start").fill("0.05");
  await page.locator("#music-loop-start").dispatchEvent("change");
  await page.locator("#music-loop-end").fill("0.35");
  await page.locator("#music-loop-end").dispatchEvent("change");
  assert.equal(await page.locator("#music-loop-enabled").isChecked(), true);
  assert.equal(await page.locator("#music-loop-start").inputValue(), "0.05");
  assert.equal(await page.locator("#music-loop-end").inputValue(), "0.35");

  // ---- P0.3 Cue authoring + command history ----
  await page.locator("#music-add-cue").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-cue-count")?.textContent === "1",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator(".music-cue-row").count(), 1);
  assert.equal(await page.locator(".music-inspector-kicker").textContent(), "MUSIC CUE");

  const change = async (selector, value) => {
    const field = page.locator(selector);
    await field.fill(String(value));
    await field.dispatchEvent("change");
  };
  await change('[data-cue-field="name"]', "Biryong Explore");
  await change('[data-cue-field="gain"]', "0.65");
  await change('[data-cue-transition="fadeInSeconds"]', "0.8");
  await change('[data-cue-transition="fadeOutSeconds"]', "1.1");
  await change('[data-cue-field="priority"]', "7");
  await change("[data-cue-tags]", "tower, explore");
  await change('[data-cue-field="notes"]', "browser authored cue");

  assert.equal(await page.locator(".music-cue-row strong").first().textContent(), "Biryong Explore");
  assert.equal(await page.locator("#music-undo").isEnabled(), true, "Cue edits enter command history");

  await page.locator("#music-duplicate-cue").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-cue-count")?.textContent === "2",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator(".music-cue-row").count(), 2);

  await page.locator("#music-remove-cue").click();
  assert.equal(await page.locator(".music-cue-row").count(), 1, "delete Cue is immediate");
  await page.locator("#music-undo").click();
  assert.equal(await page.locator(".music-cue-row").count(), 2, "Undo restores deleted Cue");
  await page.locator("#music-redo").click();
  assert.equal(await page.locator(".music-cue-row").count(), 1, "Redo deletes it again");
  await page.locator("#music-undo").click();
  assert.equal(await page.locator(".music-cue-row").count(), 2, "final Undo keeps duplicate for persistence");

  // ---- P0.4 PlaceZone / Room Binding authoring ----
  await page.locator(".music-cue-row").first().click();
  await page.locator("#music-add-binding").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-binding-count")?.textContent === "1",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator(".music-inspector-kicker").textContent(), "MUSIC BINDING");

  await page.locator("[data-binding-target]").selectOption("AREA_MAIN_GATE");
  await change('[data-binding-field="priority"]', "5");
  assert.equal(await page.locator("[data-binding-target]").inputValue(), "AREA_MAIN_GATE");
  assert.match(await page.locator(".binding-target-hint").textContent(), /정문·남쪽 진입로/);

  await page.locator("#music-duplicate-binding").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-binding-count")?.textContent === "2",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('[data-binding-field="enabled"]').isChecked(), false,
    "duplicated Binding starts disabled");

  await page.locator('[data-binding-field="targetType"]').selectOption("room");
  await page.locator("[data-binding-target]").selectOption("ROOM_PERSONAL_BASIC");
  await page.locator('[data-binding-field="cueId"]').selectOption("cue.biryong-test.copy");
  await change('[data-binding-field="priority"]', "2");
  await page.locator('[data-binding-field="enabled"]').check();
  assert.match(await page.locator(".binding-target-hint").textContent(), /제1생활관 · 내 방|내 방/);

  await page.locator("#music-remove-binding").click();
  assert.equal(await page.locator(".music-binding-row").count(), 1, "delete Binding is immediate");
  await page.locator("#music-undo").click();
  assert.equal(await page.locator(".music-binding-row").count(), 2, "Undo restores deleted Binding");

  // ---- P0.5 Runtime Preview: Binding resolve -> Cue -> WebAudio crossfade ----
  await page.locator("#music-preview-unlock").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-preview-context")?.textContent === "running",
  null, { timeout: TIMEOUT_MS }));
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("cue.biryong-test"),
  null, { timeout: TIMEOUT_MS }));
  assert.match(await page.locator("#music-preview-target").textContent(), /AREA_MAIN_GATE/);
  assert.equal(await page.locator("#music-preview-state").getAttribute("data-state"), "running");

  await page.locator("#music-preview-place-zone").selectOption("AREA_INKYUNG_STUDENT_CENTER");
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-preview-target")?.textContent ?? "").includes("AREA_INKYUNG_STUDENT_CENTER") &&
    document.getElementById("music-preview-cue")?.textContent === "—",
  null, { timeout: TIMEOUT_MS }));

  await page.locator("#music-preview-space").selectOption("ROOM_PERSONAL_BASIC");
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("cue.biryong-test.copy"),
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#music-preview-place-zone").isDisabled(), true);
  assert.match(await page.locator("#music-preview-target").textContent(), /ROOM_PERSONAL_BASIC/);

  const setRange = async (selector, value) => page.locator(selector).evaluate((element, next) => {
    element.value = next;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(value));
  await setRange("#music-preview-master", "0.60");
  await setRange("#music-preview-music", "0.45");
  assert.equal(await page.locator("#music-preview-master-value").textContent(), "0.60");
  assert.equal(await page.locator("#music-preview-music-value").textContent(), "0.45");
  await page.locator("#music-preview-muted").check();
  assert.equal(await page.locator("#music-preview-muted").isChecked(), true);
  await page.locator("#music-preview-muted").uncheck();

  // Rapid state changes may overlap outgoing/incoming handles, but must settle to one source.
  for (let index = 0; index < 6; index += 1) {
    if (index % 2 === 0) {
      await page.locator("#music-preview-space").selectOption("campus");
      await page.locator("#music-preview-place-zone").selectOption("AREA_MAIN_GATE");
    } else {
      await page.locator("#music-preview-space").selectOption("ROOM_PERSONAL_BASIC");
    }
  }
  await race(fatal, page.waitForFunction(() => {
    const text = document.getElementById("music-preview-sources")?.textContent ?? "99";
    return Number.parseInt(text, 10) <= 1;
  }, null, { timeout: 5_000 }));

  await page.locator("#music-save").click();
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("readback 완료"),
  null, { timeout: TIMEOUT_MS }));

  // ---- P0.6 Validation report + export readback ----
  await page.locator("#music-validate").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-validation-dialog")?.open === true,
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('.validation-row[data-severity="ERROR"]').count(), 0);
  assert.ok(await page.locator('.validation-row[data-severity="WARNING"]').count() >= 1,
    "warning-only project remains exportable");
  assert.match(await page.locator("#music-validation-summary").textContent(), /0 errors/);
  await page.locator("#music-validation-close").click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#music-export").click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath, "music.json export produces a download");
  const exported = JSON.parse(await readFile(downloadPath, "utf8"));
  assert.equal(exported.projectId, "inha-world-music-editor-sandbox");
  assert.equal(exported.assets.length, 1);
  assert.equal(exported.cues.length, 2);
  assert.equal(exported.bindings.length, 2);
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("Export PASS") &&
    (document.getElementById("music-file-status")?.textContent ?? "").includes("readback 동일"),
  null, { timeout: TIMEOUT_MS }));

  const persisted = await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open("inha-world-music-editor-v1");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const settings = db.transaction("settings").objectStore("settings").get("lastProjectId");
      settings.onerror = () => { db.close(); resolve(null); };
      settings.onsuccess = () => {
        const projectId = settings.result;
        const tx = db.transaction(["canonical", "assets"]);
        const canonical = tx.objectStore("canonical").get(projectId);
        const blob = tx.objectStore("assets").get(`${projectId}::music.biryong-test`);
        tx.oncomplete = () => {
          const parsed = canonical.result ? JSON.parse(canonical.result) : null;
          db.close();
          resolve({
            projectId,
            assets: parsed?.assets?.length ?? 0,
            loop: parsed?.assets?.[0]?.editor?.loop ?? null,
            cues: parsed?.cues ?? [],
            bindings: parsed?.bindings ?? [],
            blobBytes: blob.result?.size ?? 0
          });
        };
        tx.onerror = () => { db.close(); resolve(null); };
      };
    };
  }));

  assert.equal(persisted.projectId, "inha-world-music-editor-sandbox");
  assert.equal(persisted.assets, 1);
  assert.deepEqual(persisted.loop, { enabled: true, startSeconds: 0.05, endSeconds: 0.35 });
  assert.equal(persisted.cues.length, 2);
  const explore = persisted.cues.find(cue => cue.id === "cue.biryong-test");
  assert.equal(explore.name, "Biryong Explore");
  assert.equal(explore.gain, 0.65);
  assert.deepEqual(explore.transition, { fadeInSeconds: 0.8, fadeOutSeconds: 1.1 });
  assert.equal(explore.priority, 7);
  assert.deepEqual(explore.tags, ["tower", "explore"]);
  assert.equal(explore.notes, "browser authored cue");
  assert.equal(persisted.bindings.length, 2);
  const gateBinding = persisted.bindings.find(binding => binding.targetId === "AREA_MAIN_GATE");
  const roomBinding = persisted.bindings.find(binding => binding.targetId === "ROOM_PERSONAL_BASIC");
  assert.equal(gateBinding.targetType, "placeZone");
  assert.equal(gateBinding.priority, 5);
  assert.equal(gateBinding.enabled, true);
  assert.equal(roomBinding.targetType, "room");
  assert.equal(roomBinding.priority, 2);
  assert.equal(roomBinding.enabled, true);
  assert.equal(roomBinding.cueId, "cue.biryong-test.copy");
  assert.equal(roomBinding.fallback, "silence");
  assert.ok(persisted.blobBytes > 44, "audio Blob persisted separately from music.json");

  await page.reload({ waitUntil: "domcontentloaded" });
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-asset-count")?.textContent === "1 assets",
  null, { timeout: TIMEOUT_MS }));
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("준비됨"),
  null, { timeout: TIMEOUT_MS }));

  assert.equal(await page.locator("#music-loop-enabled").isChecked(), true);
  assert.equal(await page.locator("#music-loop-start").inputValue(), "0.05");
  assert.equal(await page.locator("#music-loop-end").inputValue(), "0.35");
  assert.match(await page.locator(".music-asset-row small").textContent(), /biryong-test\.wav/);
  assert.equal(await page.locator(".music-cue-row").count(), 2, "Cues survive Save + reload");
  assert.equal(await page.locator(".music-binding-row").count(), 2, "Bindings survive Save + reload");

  // Missing project Blob is an export blocker, not merely a warning.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("inha-world-music-editor-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").delete("inha-world-music-editor-sandbox::music.biryong-test");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.locator("#music-validate").click();
  await race(fatal, page.waitForFunction(() =>
    [...document.querySelectorAll(".validation-row")].some(row => row.dataset.code === "E_MUSIC_ASSET_BLOB_MISSING"),
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator('.validation-row[data-code="E_MUSIC_ASSET_BLOB_MISSING"]').count(), 1);
  await page.locator("#music-validation-close").click();
  await page.locator("#music-export").click();
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-file-status")?.textContent ?? "").includes("Export 차단"),
  null, { timeout: TIMEOUT_MS }));

  assert.deepEqual(smoke.problems, [], "no page errors, console errors or failed same-origin requests");
  console.log(`music editor smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error("music editor smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  throw error;
} finally {
  await smoke.close();
}
