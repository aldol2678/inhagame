import test from "node:test";
import assert from "node:assert/strict";

import { validateMusicProject } from "../src/music-editor/music-document.js";
import { resolveMusicBinding } from "../src/audio/music-binding-resolver.js";
import { BIRYONG_PLACE_ID, BIRYONG_PLACE_ZONE_ID } from "../src/biryong/biryong-layout.js";

const project = () => ({
  schemaVersion: 1,
  projectId: "music-place-pilot",
  name: "Music Place Pilot",
  assets: [{
    id: "music.biryong",
    type: "audio",
    uri: "/assets/audio/biryong.mp3",
    title: "Biryong",
    artist: "",
    fileName: "biryong.mp3",
    mimeType: "audio/mpeg",
    byteLength: 1,
    durationSeconds: 35.78195,
    rights: { source: "team", license: "internal-pilot", approved: true },
    editor: { loop: { enabled: false, startSeconds: 0, endSeconds: 35.78195 } }
  }],
  cues: [{
    id: "cue.biryong",
    name: "Biryong Tower",
    assetId: "music.biryong",
    bus: "music",
    gain: 0.75,
    loop: { enabled: true, startSeconds: 2.879274, endSeconds: 35.78195 },
    transition: { fadeInSeconds: 1, fadeOutSeconds: 1.5 },
    priority: 10,
    tags: ["tower"],
    notes: ""
  }],
  bindings: [
    { id: "binding.zone", targetType: "placeZone", targetId: BIRYONG_PLACE_ZONE_ID, cueId: "cue.biryong", enabled: true, priority: 1, fallback: "silence" },
    { id: "binding.place", targetType: "place", targetId: BIRYONG_PLACE_ID, cueId: "cue.biryong", enabled: true, priority: 10, fallback: "silence" }
  ],
  metadata: {}
});

test("semantic Place bindings validate against canonical place IDs", () => {
  const result = validateMusicProject(project(), {
    placeZoneIds: new Set([BIRYONG_PLACE_ZONE_ID]),
    placeIds: new Set([BIRYONG_PLACE_ID]),
    roomIds: new Set()
  });
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 0);
});

test("specific semantic Place binding wins over enclosing PlaceZone and falls back cleanly", () => {
  const current = project();
  let resolved = resolveMusicBinding(current, {
    space: "campus",
    placeZoneId: BIRYONG_PLACE_ZONE_ID,
    placeId: BIRYONG_PLACE_ID
  });
  assert.equal(resolved.targetType, "place");
  assert.equal(resolved.targetId, BIRYONG_PLACE_ID);
  assert.equal(resolved.binding.id, "binding.place");

  resolved = resolveMusicBinding(current, {
    space: "campus",
    placeZoneId: BIRYONG_PLACE_ZONE_ID
  });
  assert.equal(resolved.targetType, "placeZone");
  assert.equal(resolved.targetId, BIRYONG_PLACE_ZONE_ID);
  assert.equal(resolved.binding.id, "binding.zone");
});
