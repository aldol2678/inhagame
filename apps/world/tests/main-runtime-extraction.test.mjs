import test from "node:test";
import assert from "node:assert/strict";
import { createEditorWorldRuntime } from "../src/editor/editor-world-runtime.js";
import { installWorldDebugApi } from "../src/debug/world-debug-api.js";

test("disabled editor world runtime is inert and reports no status", async () => {
  const runtime = createEditorWorldRuntime({ enabled: false });
  assert.equal(runtime.status(), null);
  assert.equal(runtime.label, null);
  assert.equal(await runtime.ready, null);
});

test("debug API installs exposed handles and delegates status lazily", () => {
  const windowLike = {};
  let version = 1;
  const api = installWorldDebugApi({
    windowLike,
    exposed: { app: "app", player: "player" },
    getStatus: () => ({ version })
  });

  assert.equal(windowLike.__INHAGAME_P0__, api);
  assert.equal(api.app, "app");
  assert.deepEqual(api.getStatus(), { version: 1 });
  version = 2;
  assert.deepEqual(api.getStatus(), { version: 2 });
});
