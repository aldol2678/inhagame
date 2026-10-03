import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handler = require("../api/asset-canary-flag.js");
const BASE = (process.env.SUPABASE_URL || "http://127.0.0.1:54321");

function response() {
  return {
    statusCode: 0, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.ended = true; return this; },
    end() { this.ended = true; return this; }
  };
}

async function call(method = "GET") {
  const res = response();
  await handler({ method }, res);
  return res;
}

test("asset canary flag: enabled row maps to 200", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify([{ enabled: true }]), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(BASE + "/rest/v1/world_runtime_flags?"));
  assert.match(calls[0].url, /flag=eq\.asset_glb_canary_v1/);
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.headers.apikey);
});

test("asset canary flag: disabled row maps to 404", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([{ enabled: false }]), {
    status: 200, headers: { "content-type": "application/json" }
  });
  assert.equal((await call()).statusCode, 404);
});

test("asset canary flag: malformed/upstream failures fail closed as 503", async () => {
  for (const fetcher of [
    async () => new Response("{}", { status: 500 }),
    async () => new Response(JSON.stringify([]), { status: 200 }),
    async () => new Response(JSON.stringify([{ enabled: "yes" }]), { status: 200 }),
    async () => { throw new Error("offline"); }
  ]) {
    globalThis.fetch = fetcher;
    assert.equal((await call()).statusCode, 503);
  }
});

test("asset canary flag: GET only and no-store", async () => {
  globalThis.fetch = async () => { throw new Error("must not call upstream"); };
  const res = await call("POST");
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
  assert.match(res.headers["cache-control"], /no-store/);
});
