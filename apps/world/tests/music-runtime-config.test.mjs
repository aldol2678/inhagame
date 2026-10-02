import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  loadRuntimeMusicProject,
  validateRuntimeMusicProject
} from "../src/audio/music-runtime-config.js";

const asset = (overrides = {}) => ({
  id: "music.runtime-test",
  type: "audio",
  uri: "/assets/audio/runtime-test.wav",
  title: "Runtime Test",
  artist: "",
  fileName: "runtime-test.wav",
  mimeType: "audio/wav",
  byteLength: 1024,
  durationSeconds: 1,
  rights: { source: "team", license: "internal-test", approved: true },
  editor: { loop: { enabled: false, startSeconds: 0, endSeconds: 1 } },
  ...overrides
});

const project = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: "inha-world-music-runtime",
  name: "Runtime Test",
  assets: [asset()],
  cues: [],
  bindings: [],
  metadata: {},
  ...overrides
});

test("P1 runtime config accepts production-safe assets and empty safe default", () => {
  const valid = validateRuntimeMusicProject(project());
  assert.equal(valid.assets[0].uri, "/assets/audio/runtime-test.wav");

  const empty = validateRuntimeMusicProject({
    schemaVersion: 1,
    projectId: "inha-world-music-runtime",
    name: "Empty",
    assets: [],
    cues: [],
    bindings: [],
    metadata: {}
  });
  assert.equal(empty.assets.length, 0);
});

test("P1 runtime config rejects editor-local URIs and unapproved rights", () => {
  assert.throws(
    () => validateRuntimeMusicProject(project({
      assets: [asset({ uri: "project://music.runtime-test" })]
    })),
    /E_MUSIC_RUNTIME_PROJECT_URI/
  );
  assert.throws(
    () => validateRuntimeMusicProject(project({
      assets: [asset({ rights: { source: "", license: "", approved: false } })]
    })),
    /E_MUSIC_RUNTIME_RIGHTS_UNAPPROVED/
  );
});

test("P1 runtime loader fetches JSON and validates before returning", async () => {
  const expected = project();
  const loaded = await loadRuntimeMusicProject({
    url: "/data/music/music.json",
    fetchFn: async url => ({
      ok: url === "/data/music/music.json",
      status: 200,
      async json() { return expected; }
    })
  });
  assert.deepEqual(loaded, expected);

  await assert.rejects(
    loadRuntimeMusicProject({
      fetchFn: async () => ({ ok: false, status: 404, async json() { return {}; } })
    }),
    /E_MUSIC_RUNTIME_CONFIG_HTTP/
  );
  await assert.rejects(
    loadRuntimeMusicProject({
      fetchFn: async () => ({ ok: true, status: 200, async json() { throw new Error("bad json"); } })
    }),
    /E_MUSIC_RUNTIME_CONFIG_JSON/
  );
});


test("public music configuration is schema-valid and silent",()=>{
 const raw=JSON.parse(readFileSync(new URL("../data/music/music.json",import.meta.url),"utf8"));
 const value=validateRuntimeMusicProject(raw);
 assert.deepEqual(value.assets,[]); assert.deepEqual(value.cues,[]); assert.deepEqual(value.bindings,[]);
 assert.deepEqual(raw.metadata,{});
});
