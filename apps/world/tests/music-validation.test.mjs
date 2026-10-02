import test from "node:test";
import assert from "node:assert/strict";

import { createEmptyMusicProject } from "../src/music-editor/music-document.js";
import {
  buildMusicExportCandidate,
  describeMusicDiagnostic,
  diagnoseMusicProject
} from "../src/music-editor/music-validation.js";

const asset = (overrides = {}) => ({
  id: "music.export-test",
  type: "audio",
  uri: "project://music.export-test",
  title: "Export Test",
  artist: "",
  fileName: "export-test.wav",
  mimeType: "audio/wav",
  byteLength: 16044,
  durationSeconds: 2,
  rights: { source: "team", license: "internal-test", approved: true },
  editor: { loop: { enabled: false, startSeconds: 0, endSeconds: 2 } },
  ...overrides
});

const cue = (overrides = {}) => ({
  id: "cue.export-test",
  name: "Export Cue",
  assetId: "music.export-test",
  bus: "music",
  gain: 0.8,
  loop: { enabled: true, startSeconds: 0.1, endSeconds: 1.9 },
  transition: { fadeInSeconds: 0.5, fadeOutSeconds: 0.5 },
  priority: 0,
  tags: [],
  notes: "",
  ...overrides
});

const binding = (overrides = {}) => ({
  id: "binding.export-test",
  targetType: "placeZone",
  targetId: "AREA_MAIN_GATE",
  cueId: "cue.export-test",
  enabled: true,
  priority: 0,
  fallback: "silence",
  ...overrides
});

const project = () => {
  const p = createEmptyMusicProject();
  p.assets.push(asset());
  p.cues.push(cue());
  p.bindings.push(binding());
  return p;
};

const registries = {
  placeZoneIds: new Set(["AREA_MAIN_GATE"]),
  roomIds: new Set(["ROOM_PERSONAL_BASIC"])
};

test("P0.6 export candidate performs parse/readback semantic equality", async () => {
  const p = project();
  const result = await buildMusicExportCandidate(p, {
    ...registries,
    hasAssetBlob: async () => true
  });
  assert.equal(result.ok, true);
  assert.equal(result.semanticEqual, true);
  assert.ok(result.text.endsWith("\n"));
  assert.deepEqual(result.readback, p);
  assert.equal(result.counts.errors, 0);
});

test("P0.6 warnings do not block export but missing project Blob does", async () => {
  const p = project();
  p.assets[0].rights = { source: "", license: "", approved: false };
  p.cues[0].gain = 1.15;

  const warningOnly = await buildMusicExportCandidate(p, {
    ...registries,
    hasAssetBlob: async () => true
  });
  assert.equal(warningOnly.ok, true);
  for (const code of [
    "W_MUSIC_RIGHTS_SOURCE_MISSING",
    "W_MUSIC_LICENSE_MISSING",
    "W_MUSIC_RIGHTS_UNAPPROVED",
    "W_MUSIC_CUE_GAIN_ABOVE_UNITY"
  ]) assert.ok(warningOnly.warnings.some(item => item.code === code), code);

  const missing = await buildMusicExportCandidate(p, {
    ...registries,
    hasAssetBlob: async () => false
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.text, null);
  assert.ok(missing.errors.some(item => item.code === "E_MUSIC_ASSET_BLOB_MISSING"));
});

test("P0.6 diagnoses unused assets/cues and suspiciously short loop/fade", () => {
  const p = project();
  p.assets.push(asset({
    id: "music.unused",
    uri: "project://music.unused",
    fileName: "unused.wav"
  }));
  p.cues.push(cue({
    id: "cue.unused",
    name: "Unused Cue",
    loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.2 },
    transition: { fadeInSeconds: 0.05, fadeOutSeconds: 0.05 }
  }));

  const result = diagnoseMusicProject(p, registries);
  for (const code of [
    "W_MUSIC_ASSET_UNUSED",
    "W_MUSIC_CUE_UNUSED",
    "W_MUSIC_LOOP_VERY_SHORT",
    "W_MUSIC_FADE_VERY_SHORT"
  ]) assert.ok(result.warnings.some(item => item.code === code), code);
});

test("P0.6 unknown current-world targets remain warning-only while structural errors block", async () => {
  const future = project();
  future.bindings[0].targetId = "AREA_FUTURE_ZONE";
  const warning = await buildMusicExportCandidate(future, {
    ...registries,
    hasAssetBlob: async () => true
  });
  assert.equal(warning.ok, true);
  assert.ok(warning.warnings.some(item => item.code === "W_MUSIC_BINDING_TARGET_UNKNOWN"));

  const broken = project();
  broken.bindings[0].cueId = "cue.missing";
  const result = await buildMusicExportCandidate(broken, {
    ...registries,
    hasAssetBlob: async () => true
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "E_MUSIC_BINDING_CUE_NOT_FOUND"));
});

test("P0.6 diagnostic labels are human-readable for export blockers", () => {
  assert.match(describeMusicDiagnostic({ code: "E_MUSIC_ASSET_BLOB_MISSING" }), /음원 원본/);
  assert.match(describeMusicDiagnostic({ code: "W_MUSIC_RIGHTS_UNAPPROVED" }), /권리 승인/);
});
