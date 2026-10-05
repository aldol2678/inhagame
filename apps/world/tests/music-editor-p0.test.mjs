import test from "node:test";
import assert from "node:assert/strict";

import {
  MUSIC_SCHEMA_VERSION,
  MusicDocument,
  createEmptyMusicProject,
  parseMusicProject,
  serializeMusicProject,
  validateMusicProject
} from "../src/music-editor/music-document.js";
import { MusicCommands } from "../src/music-editor/music-commands.js";

const asset = (overrides = {}) => ({
  id: "music.biryong-test",
  uri: "project://music.biryong-test",
  title: "Biryong Test",
  artist: "",
  fileName: "biryong-test.wav",
  mimeType: "audio/wav",
  byteLength: 16044,
  durationSeconds: 1,
  rights: { source: "team test fixture", license: "internal-test", approved: true },
  editor: { loop: { enabled: false, startSeconds: 0, endSeconds: 1 } },
  ...overrides
});

const cue = (overrides = {}) => ({
  id: "cue.biryong-test.explore",
  name: "Biryong Explore",
  assetId: "music.biryong-test",
  bus: "music",
  gain: 0.8,
  loop: { enabled: true, startSeconds: 0.1, endSeconds: 0.9 },
  transition: { fadeInSeconds: 0.5, fadeOutSeconds: 0.75 },
  priority: 10,
  tags: ["tower", "explore"],
  notes: "P0.3 fixture",
  ...overrides
});

const binding = (overrides = {}) => ({
  id: "binding.biryong-test.main-gate",
  targetType: "placeZone",
  targetId: "AREA_MAIN_GATE",
  cueId: "cue.biryong-test.explore",
  enabled: true,
  priority: 10,
  fallback: "silence",
  ...overrides
});

test("MusicDocument P0 keeps stable schema, asset and preview loop through serialization", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  assert.equal(document.snapshot().schemaVersion, MUSIC_SCHEMA_VERSION);
  assert.equal(document.dirty, false);

  document.addAsset(asset());
  assert.equal(document.dirty, true);
  document.setAssetLoop("music.biryong-test", { enabled: true, startSeconds: 0.15, endSeconds: 0.85 });

  const text = serializeMusicProject(document.snapshot());
  const reopened = parseMusicProject(text);
  assert.equal(reopened.assets.length, 1);
  assert.deepEqual(reopened.assets[0].editor.loop, {
    enabled: true,
    startSeconds: 0.15,
    endSeconds: 0.85
  });
  assert.equal(validateMusicProject(reopened).valid, true);
});

test("MusicDocument rejects duplicate ids and invalid loop ranges before commit", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  const revision = document.revision;

  assert.throws(() => document.addAsset(asset()), /E_MUSIC_ASSET_ID_DUPLICATE/);
  assert.equal(document.revision, revision, "failed duplicate never mutates the document");

  assert.throws(
    () => document.setAssetLoop("music.biryong-test", { enabled: true, startSeconds: 0.9, endSeconds: 0.2 }),
    /E_MUSIC_LOOP_INVALID/
  );
  assert.equal(document.revision, revision, "failed loop never mutates the document");
});

test("Music validation keeps missing rights as warnings and broken runtime values as errors", () => {
  const warningProject = createEmptyMusicProject();
  warningProject.assets.push(asset({ rights: { source: "", license: "", approved: false } }));
  const warning = validateMusicProject(warningProject);
  assert.equal(warning.valid, true);
  assert.ok(warning.warnings.some(item => item.code === "W_MUSIC_RIGHTS_SOURCE_MISSING"));
  assert.ok(warning.warnings.some(item => item.code === "W_MUSIC_LICENSE_MISSING"));

  const invalid = structuredClone(warningProject);
  invalid.assets[0].durationSeconds = 0;
  const result = validateMusicProject(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(item => item.code === "E_MUSIC_DURATION_INVALID"));
});

test("parser rejects unsupported schema versions", () => {
  const project = createEmptyMusicProject();
  project.schemaVersion = 999;
  assert.throws(() => parseMusicProject(JSON.stringify(project)), /E_MUSIC_SCHEMA_UNSUPPORTED/);
});


test("P0.3 Cue contract survives serialization and validates asset references", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.addCue(cue());

  const reopened = parseMusicProject(serializeMusicProject(document.snapshot()));
  assert.deepEqual(reopened.cues, [cue()]);
  assert.equal(validateMusicProject(reopened).valid, true);

  assert.throws(
    () => document.addCue(cue({ id: "cue.missing", assetId: "music.missing" })),
    /E_MUSIC_CUE_ASSET_NOT_FOUND/
  );
  assert.throws(
    () => document.updateCue("cue.biryong-test.explore", { gain: 2.5 }),
    /E_MUSIC_CUE_GAIN_INVALID/
  );
  assert.throws(
    () => document.removeAsset("music.biryong-test"),
    /E_MUSIC_CUE_ASSET_NOT_FOUND/,
    "a referenced asset cannot be removed while its Cue exists"
  );
});

test("S3.3 MusicCommands asset update participates in undo and redo", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.markSaved();
  const commands = new MusicCommands(document);

  commands.updateAsset("music.biryong-test", { title: "Studio Track QA", artist: "INHA Studio" }, "Studio Asset Edit");
  assert.equal(document.getAsset("music.biryong-test").title, "Studio Track QA");
  assert.equal(document.getAsset("music.biryong-test").artist, "INHA Studio");
  assert.equal(commands.canUndo, true);

  assert.equal(commands.undo(), true);
  assert.equal(document.getAsset("music.biryong-test").title, "Biryong Test");
  assert.equal(commands.redo(), true);
  assert.equal(document.getAsset("music.biryong-test").title, "Studio Track QA");
});

test("P0.3 MusicCommands undo and redo Cue add/edit/duplicate/delete", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.markSaved();
  const commands = new MusicCommands(document);

  const added = commands.addCue(cue());
  assert.equal(added.id, "cue.biryong-test.explore");
  assert.equal(commands.canUndo, true);

  commands.updateCue(added.id, { gain: 0.55, transition: { fadeInSeconds: 1.25 } }, "Tune Cue");
  assert.equal(document.getCue(added.id).gain, 0.55);
  assert.equal(document.getCue(added.id).transition.fadeInSeconds, 1.25);
  assert.equal(document.getCue(added.id).transition.fadeOutSeconds, 0.75);

  const duplicate = commands.duplicateCue(added.id, "cue.biryong-test.copy");
  assert.equal(duplicate.name, "Biryong Explore Copy");
  assert.equal(document.cues().length, 2);

  commands.removeCue(duplicate.id);
  assert.equal(document.cues().length, 1);
  assert.equal(commands.undo(), true);
  assert.equal(document.cues().length, 2, "undo restores deleted Cue");
  assert.equal(commands.undo(), true);
  assert.equal(document.cues().length, 1, "undo removes duplicated Cue");
  assert.equal(commands.redo(), true);
  assert.equal(document.cues().length, 2, "redo restores duplicated Cue");
});

test("P0.3 Cue loop is bounded by its referenced Asset duration", () => {
  const project = createEmptyMusicProject();
  project.assets.push(asset());
  project.cues.push(cue({ loop: { enabled: true, startSeconds: 0.2, endSeconds: 1.5 } }));
  const result = validateMusicProject(project);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(item => item.code === "E_MUSIC_LOOP_INVALID" && item.path === "cues[0].loop"));
});


test("P0.4 Binding contract preserves Cue -> PlaceZone/Room links", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.addCue(cue());
  document.addBinding(binding());

  const reopened = parseMusicProject(serializeMusicProject(document.snapshot()));
  assert.deepEqual(reopened.bindings, [binding()]);
  assert.equal(validateMusicProject(reopened, {
    placeZoneIds: new Set(["AREA_MAIN_GATE"]),
    roomIds: new Set(["ROOM_PERSONAL_BASIC"])
  }).valid, true);

  document.updateBinding(binding().id, {
    targetType: "room",
    targetId: "ROOM_PERSONAL_BASIC",
    priority: 4
  });
  assert.deepEqual(document.getBinding(binding().id), binding({
    targetType: "room",
    targetId: "ROOM_PERSONAL_BASIC",
    priority: 4
  }));
});

test("P0.4 Binding rejects broken refs and nondeterministic target priority conflicts", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.addCue(cue());
  document.addBinding(binding());

  assert.throws(
    () => document.addBinding(binding({ id: "binding.bad-cue", cueId: "cue.missing" })),
    /E_MUSIC_BINDING_CUE_NOT_FOUND/
  );
  assert.throws(
    () => document.addBinding(binding({ id: "binding.conflict", cueId: cue().id })),
    /E_MUSIC_BINDING_PRIORITY_CONFLICT/
  );
  assert.throws(
    () => document.addBinding(binding({ id: "binding.bad-target", targetType: "room", targetId: "AREA_MAIN_GATE" })),
    /E_MUSIC_BINDING_TARGET_ID_INVALID/
  );
  assert.throws(
    () => document.removeCue(cue().id),
    /E_MUSIC_BINDING_CUE_NOT_FOUND/,
    "a Cue with active Binding refs cannot be deleted"
  );
});

test("P0.4 Binding validation warns when a syntactically valid target is not in current World registries", () => {
  const project = createEmptyMusicProject();
  project.assets.push(asset());
  project.cues.push(cue());
  project.bindings.push(binding({ targetId: "AREA_FUTURE_ZONE" }));
  const result = validateMusicProject(project, {
    placeZoneIds: new Set(["AREA_MAIN_GATE"]),
    roomIds: new Set(["ROOM_PERSONAL_BASIC"])
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(item => item.code === "W_MUSIC_BINDING_TARGET_UNKNOWN"));
});

test("P0.4 MusicCommands undo/redo Binding changes and Cue rename cascades Binding ref", () => {
  const document = new MusicDocument(createEmptyMusicProject());
  document.addAsset(asset());
  document.addCue(cue());
  document.markSaved();
  const commands = new MusicCommands(document);

  const added = commands.addBinding(binding());
  assert.equal(document.bindings().length, 1);
  commands.updateBinding(added.id, { priority: 3 }, "Tune Binding");
  assert.equal(document.getBinding(added.id).priority, 3);

  commands.updateCue(cue().id, { id: "cue.biryong-test.renamed" }, "Rename Cue");
  assert.equal(document.getBinding(added.id).cueId, "cue.biryong-test.renamed",
    "Cue ID rename cascades to Binding refs");

  const duplicate = commands.duplicateBinding(added.id, "binding.biryong-test.copy");
  assert.equal(duplicate.enabled, false, "duplicate starts disabled to avoid priority conflict");
  assert.equal(document.bindings().length, 2);

  commands.removeBinding(duplicate.id);
  assert.equal(document.bindings().length, 1);
  assert.equal(commands.undo(), true);
  assert.equal(document.bindings().length, 2, "undo restores deleted Binding");
  assert.equal(commands.redo(), true);
  assert.equal(document.bindings().length, 1, "redo removes it again");
});
