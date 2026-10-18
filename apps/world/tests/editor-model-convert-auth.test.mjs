import test from "node:test";
import assert from "node:assert/strict";

const CONFIG = {
  url: "https://example.supabase.co",
  publishableKey: "sb_publishable_example"
};

test("editor FBX converter rejects absent public auth SDK/config", async () => {
  const { getEditorModelConvertToken } = await import("../src/editor/editor-model-convert-auth.js?absent");
  await assert.rejects(getEditorModelConvertToken({ sdk: null, config: null }),
    /E_MODEL_CONVERT_AUTH_UNAVAILABLE/);
  await assert.rejects(getEditorModelConvertToken({
    sdk: { createClient() { throw new Error("must not create client"); } },
    config: { url: "http://127.0.0.1", publishableKey: "sb_publishable_test" }
  }), /E_MODEL_CONVERT_AUTH_UNAVAILABLE/);
});

test("editor FBX converter rejects guest and missing sessions", async () => {
  const { getEditorModelConvertToken } = await import("../src/editor/editor-model-convert-auth.js?guest");
  let session = null;
  const sdk = { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; } } }; } };
  await assert.rejects(getEditorModelConvertToken({ sdk, config: CONFIG }),
    /E_MODEL_CONVERT_LOGIN_REQUIRED/);
  session = { access_token: "t".repeat(40), user: { is_anonymous: true } };
  await assert.rejects(getEditorModelConvertToken({ sdk, config: CONFIG }),
    /E_MODEL_CONVERT_LOGIN_REQUIRED/);
});

test("editor FBX converter reads session token, never service key or operator role", async () => {
  const { getEditorModelConvertToken } = await import("../src/editor/editor-model-convert-auth.js?success");
  let created = 0;
  const sdk = {
    createClient(url, key, options) {
      created++;
      assert.equal(url, CONFIG.url);
      assert.equal(key, CONFIG.publishableKey);
      assert.equal(options.auth.persistSession, true);
      return { auth: { async getSession() { return { data: { session: {
        access_token: "valid-session-token".repeat(3), user: { is_anonymous: false }
      } }, error: null }; } } };
    }
  };
  const token = await getEditorModelConvertToken({ sdk, config: CONFIG });
  assert.equal(token, "valid-session-token".repeat(3));
  assert.equal(await getEditorModelConvertToken({ sdk, config: CONFIG }), token);
  assert.equal(created, 1);
});
