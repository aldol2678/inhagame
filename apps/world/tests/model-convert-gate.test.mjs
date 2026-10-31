import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createModelConvertHandler,
  createSlidingWindowLimiter,
  modelConvertAllowlistFromEnv,
  modelConvertClientIp,
  modelConvertIpKey,
  modelConvertLimitsFromEnv
} from "../server/model-convert-gate.mjs";
import { getEditorModelConvertToken, resetEditorModelConvertAuthForTest } from "../src/editor/editor-model-convert-auth.js";

// Synthetic placeholders only; no real Supabase session or converter secret is involved.
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TOKENS = { ["fake-token-user-a-000000"]: USER_A, ["fake-token-user-b-000000"]: USER_B };
const UPSTREAM = "https://converter.invalid/";

function glb() {
  const bytes = Buffer.alloc(28);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  return bytes;
}

function fakeVerifyUser() {
  const calls = [];
  const verifyUser = async authorization => {
    calls.push(authorization);
    const match = /^Bearer (.+)$/u.exec(authorization ?? "");
    return match ? TOKENS[match[1]] ?? null : null;
  };
  return { verifyUser, calls };
}

function fakeUpstream() {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(glb(), { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
  };
  return { fetcher, calls };
}

function request({ method = "POST", token, ip = "203.0.113.7", headers = {}, body = Buffer.from("; FBX 7.4.0 project file") } = {}) {
  return {
    method,
    headers: {
      host: "inhagame.test",
      "x-model-filename": "student.fbx",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body,
    socket: { remoteAddress: ip }
  };
}

function response() {
  return {
    statusCode: 0, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function harness(overrides = {}) {
  const auth = fakeVerifyUser();
  const upstream = fakeUpstream();
  let clock = 1_000_000;
  const handler = createModelConvertHandler({
    enabled: true, upstreamUrl: UPSTREAM, proxySecret: "placeholder-proxy-key",
    verifyUser: auth.verifyUser, fetcher: upstream.fetcher,
    limits: { userMax: 2, ipMax: 4, windowSec: 60, authFailIpMax: 3, authFailWindowSec: 30, maxKeys: 100 },
    now: () => clock,
    ...overrides
  });
  const call = async (options, req = request(options)) => { const res = response(); await handler(req, res); return res; };
  return { call, auth, upstream, advance: ms => { clock += ms; } };
}

test("unauthenticated request is rejected with 401 before any auth or upstream call", async () => {
  const { call, upstream, auth } = harness();
  const res = await call({});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "E_MODEL_CONVERT_LOGIN_REQUIRED");
  assert.equal(res.headers["www-authenticate"], "Bearer");
  assert.equal(auth.calls.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("invalid token is rejected with 401 before any upstream call", async () => {
  const { call, upstream, auth } = harness();
  const res = await call({ token: "not-a-real-session-token-000" });
  assert.equal(res.statusCode, 401);
  assert.equal(auth.calls.length, 1);
  assert.equal(upstream.calls.length, 0);
});

test("auth provider outage fails closed with 503 and no upstream call", async () => {
  const { call, upstream } = harness({ verifyUser: async () => { throw new Error("AUTH_UNAVAILABLE"); } });
  const res = await call({ token: "fake-token-user-a-000000" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "E_MODEL_AUTH_UNAVAILABLE");
  assert.equal(upstream.calls.length, 0);
});

test("valid member session passes through to the (mocked) converter", async () => {
  const { call, upstream } = harness();
  const res = await call({ token: "fake-token-user-a-000000" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "model/gltf-binary");
  assert.ok(Buffer.isBuffer(res.body) && res.body.subarray(0, 4).toString("ascii") === "glTF");
  assert.equal(upstream.calls.length, 1);
  assert.equal(upstream.calls[0].url, UPSTREAM);
  assert.equal(upstream.calls[0].init.headers["X-Converter-Key"], "placeholder-proxy-key");
  // The caller's session token is never forwarded to the converter.
  assert.equal(JSON.stringify(upstream.calls[0].init.headers).includes("fake-token"), false);
});

test("per-user limit returns 429 with Retry-After and does not call upstream", async () => {
  const { call, upstream, advance } = harness();
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "198.51.100.1" })).statusCode, 200);
  advance(10_000);
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "198.51.100.2" })).statusCode, 200);
  const res = await call({ token: "fake-token-user-a-000000", ip: "198.51.100.3" });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "E_MODEL_CONVERT_RATE_LIMITED");
  assert.equal(res.headers["retry-after"], "50");
  assert.equal(upstream.calls.length, 2);
  // Another member is unaffected, and the window slides.
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "198.51.100.4" })).statusCode, 200);
  advance(50_000);
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "198.51.100.5" })).statusCode, 200);
});

test("failed logins do not consume the authenticated per-IP quota", async () => {
  const { call, upstream } = harness();
  // A shared NAT IP: someone loops missing tokens (free to reject, never counted) and bad tokens.
  for (let i = 0; i < 20; i++) assert.equal((await call({ ip: "203.0.113.9" })).statusCode, 401);
  for (let i = 0; i < 2; i++) assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.9" })).statusCode, 401);
  // Members behind the same IP still get the full authenticated IP quota (4).
  for (const token of ["fake-token-user-a-000000", "fake-token-user-a-000000", "fake-token-user-b-000000", "fake-token-user-b-000000"])
    assert.equal((await call({ token, ip: "203.0.113.9" })).statusCode, 200);
  assert.equal(upstream.calls.length, 4);
});

test("pre-auth limiter stops repeated rejected logins per IP before Supabase Auth", async () => {
  const { call, auth, upstream, advance } = harness();
  for (let i = 0; i < 3; i++) assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.20" })).statusCode, 401);
  assert.equal(auth.calls.length, 3);
  const res = await call({ token: "not-a-real-session-token-000", ip: "203.0.113.20" });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "30", "auth-failure window is separate and shorter");
  assert.equal(auth.calls.length, 3, "blocked before calling Supabase Auth");
  // Successful logins never count as failures, and other IPs are unaffected.
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.21" })).statusCode, 200);
  advance(30_000);
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.20" })).statusCode, 200);
  assert.equal(upstream.calls.length, 2);
});

test("allowlist 403s count as failed auth for the pre-auth limiter", async () => {
  const { call, auth } = harness({ allowedUserIds: new Set([USER_A]) });
  for (let i = 0; i < 3; i++) assert.equal((await call({ token: "fake-token-user-b-000000", ip: "203.0.113.30" })).statusCode, 403);
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "203.0.113.30" })).statusCode, 429);
  assert.equal(auth.calls.length, 3);
});

test("concurrent bad tokens cannot exceed the pre-auth limit while auth is in flight", async () => {
  const auth = fakeVerifyUser();
  let releaseAuth;
  const pending = new Promise(resolve => { releaseAuth = resolve; });
  const { call } = harness({ verifyUser: async header => { await pending; return auth.verifyUser(header); } });
  const inFlight = Array.from({ length: 10 }, () => call({ token: "not-a-real-session-token-000", ip: "203.0.113.40" }));
  releaseAuth();
  const statuses = (await Promise.all(inFlight)).map(res => res.statusCode);
  assert.equal(statuses.filter(code => code === 401).length, 3);
  assert.equal(statuses.filter(code => code === 429).length, 7);
  assert.equal(auth.calls.length, 3, "only authFailIpMax attempts reach Supabase Auth");
});

test("concurrent member logins are released on success and do not count as failures", async () => {
  const auth = fakeVerifyUser();
  let releaseAuth;
  const pending = new Promise(resolve => { releaseAuth = resolve; });
  const { call } = harness({
    verifyUser: async header => { await pending; return auth.verifyUser(header); },
    limits: { userMax: 10, ipMax: 10, windowSec: 60, authFailIpMax: 3, authFailWindowSec: 30, maxKeys: 100 }
  });
  const members = Array.from({ length: 3 }, () => call({ token: "fake-token-user-a-000000", ip: "203.0.113.41" }));
  releaseAuth();
  assert.deepEqual((await Promise.all(members)).map(res => res.statusCode), [200, 200, 200]);
  // All three reservations were released, so the full failure budget is still available.
  for (let i = 0; i < 3; i++) assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.41" })).statusCode, 401);
  assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.41" })).statusCode, 429);
});

test("auth provider errors count toward the pre-auth limit", async () => {
  let calls = 0;
  const { call } = harness({ verifyUser: async () => { calls++; throw new Error("AUTH_UNAVAILABLE"); } });
  for (let i = 0; i < 3; i++) assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.42" })).statusCode, 503);
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.42" })).statusCode, 429);
  assert.equal(calls, 3);
});

test("full failed-login table never blocks a member on a new IP", async () => {
  const { call, auth } = harness({
    limits: { userMax: 10, ipMax: 10, windowSec: 60, authFailIpMax: 3, authFailWindowSec: 30, maxKeys: 2 }
  });
  // Fill the table with failing IPs (one of them blocked).
  for (let i = 0; i < 3; i++) await call({ token: "not-a-real-session-token-000", ip: "203.0.113.50" });
  await call({ token: "not-a-real-session-token-000", ip: "203.0.113.51" });
  assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.51" })).statusCode, 401);
  // Members on fresh IPs pass the pre-auth check and reach the converter.
  // (Two IPs: the authenticated per-IP table shares maxKeys: 2 and stays fail-closed.)
  for (const ip of ["198.51.100.60", "2001:db8:1:2::9"])
    assert.equal((await call({ token: "fake-token-user-a-000000", ip })).statusCode, 200);
  // A new failing IP is still counted and limited (the oldest entry makes room for it).
  for (let i = 0; i < 3; i++) assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.52" })).statusCode, 401);
  assert.equal((await call({ token: "not-a-real-session-token-000", ip: "203.0.113.52" })).statusCode, 429);
  assert.equal(auth.calls.filter(header => header.includes("not-a-real")).length, 8);
});

test("authenticated per-IP limit returns 429 across users without consuming user quota", async () => {
  const { call, upstream } = harness({ limits: { userMax: 2, ipMax: 3, windowSec: 60, maxKeys: 100 } });
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.9" })).statusCode, 200);
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "203.0.113.9" })).statusCode, 200);
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "203.0.113.9" })).statusCode, 200);
  const res = await call({ token: "fake-token-user-b-000000", ip: "203.0.113.9" });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "60");
  // User B's refused attempt did not use their quota: two more conversions from another IP.
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "203.0.113.10" })).statusCode, 200);
  assert.equal(upstream.calls.length, 4);
});

test("IPv6 clients share one per-IP bucket per /64", async () => {
  const { call } = harness({ limits: { userMax: 5, ipMax: 2, windowSec: 60, maxKeys: 100 } });
  assert.equal((await call({ token: "fake-token-user-a-000000", ip: "2001:db8:1:2::1" })).statusCode, 200);
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "2001:db8:1:2:ffff:0:0:9" })).statusCode, 200);
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "2001:db8:1:2:abcd::7" })).statusCode, 429);
  assert.equal((await call({ token: "fake-token-user-b-000000", ip: "2001:db8:1:3::1" })).statusCode, 200);
  assert.equal(modelConvertIpKey("2001:DB8:0:0:1::5%eth0"), "2001:db8:0:0::/64");
  assert.equal(modelConvertIpKey("::ffff:203.0.113.5"), "203.0.113.5");
  assert.equal(modelConvertIpKey("203.0.113.5"), "203.0.113.5");
  assert.equal(modelConvertIpKey("not::an::ip"), "not::an::ip");
});

test("rejected requests never read the upload body", async () => {
  const { call, upstream } = harness({ allowedUserIds: new Set([USER_A]), limits: { userMax: 1, ipMax: 10, windowSec: 60, maxKeys: 100 } });
  let reads = 0;
  const poisoned = options => {
    const req = request(options);
    Object.defineProperty(req, "body", { get() { reads++; throw new Error("body read before auth"); } });
    req[Symbol.asyncIterator] = () => { reads++; throw new Error("stream read before auth"); };
    return req;
  };
  assert.equal((await call(null, poisoned({}))).statusCode, 401);
  assert.equal((await call(null, poisoned({ token: "not-a-real-session-token-000" }))).statusCode, 401);
  assert.equal((await call(null, poisoned({ token: "fake-token-user-b-000000" }))).statusCode, 403);
  assert.equal((await call({ token: "fake-token-user-a-000000" })).statusCode, 200);
  assert.equal((await call(null, poisoned({ token: "fake-token-user-a-000000" }))).statusCode, 429);
  assert.equal(reads, 0);
  assert.equal(upstream.calls.length, 1);
});

test("optional allowlist returns 403 for other members and fails closed when malformed", async () => {
  const allowlisted = harness({ allowedUserIds: modelConvertAllowlistFromEnv({ MODEL_CONVERT_ALLOWED_USER_IDS: ` ${USER_A.toUpperCase()} ` }) });
  assert.equal((await allowlisted.call({ token: "fake-token-user-a-000000" })).statusCode, 200);
  assert.equal((await allowlisted.call({ token: "fake-token-user-b-000000" })).statusCode, 403);
  assert.equal(allowlisted.upstream.calls.length, 1);
  assert.equal(modelConvertAllowlistFromEnv({}), null);
  assert.equal(modelConvertAllowlistFromEnv({ MODEL_CONVERT_ALLOWED_USER_IDS: "nope" }).size, 0);
});

test("upstream auth/limit failures are not reported as the caller's 401/429", async () => {
  for (const status of [401, 429, 500]) {
    const { call } = harness({ fetcher: async () => new Response(JSON.stringify({ error: "E_MODEL_CONVERT_AUTH" }), { status }) });
    const res = await call({ token: "fake-token-user-a-000000" });
    assert.equal(res.statusCode, 502);
  }
});

test("disabled handler keeps GET status and 404 without auth, limits or upstream", async () => {
  const { call, upstream, auth } = harness({ enabled: false });
  const get = await call({ method: "GET" });
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body, { enabled: false });
  for (let i = 0; i < 10; i++) {
    const res = await call({ token: "fake-token-user-a-000000" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "E_MODEL_CONVERT_DISABLED");
  }
  assert.equal(auth.calls.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("Vercel entry stays disabled by default without loading the gate", async () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve("../api/model-convert.js");
  const saved = { enabled: process.env.MODEL_CONVERT_ENABLED, url: process.env.MODEL_CONVERT_CLOUD_RUN_URL };
  try {
    for (const env of [{}, { MODEL_CONVERT_ENABLED: "1" }, { MODEL_CONVERT_ENABLED: "1", MODEL_CONVERT_CLOUD_RUN_URL: "http://plain.invalid" }]) {
      delete process.env.MODEL_CONVERT_ENABLED;
      delete process.env.MODEL_CONVERT_CLOUD_RUN_URL;
      Object.assign(process.env, env);
      delete require.cache[path];
      const handler = require(path);
      const get = response();
      await handler(request({ method: "GET" }), get);
      assert.deepEqual(get.body, { enabled: false });
      const post = response();
      await handler(request({ token: "fake-token-user-a-000000" }), post);
      assert.equal(post.statusCode, 404);
      assert.equal(post.body.error, "E_MODEL_CONVERT_DISABLED");
    }
  } finally {
    delete require.cache[path];
    for (const [key, value] of [["MODEL_CONVERT_ENABLED", saved.enabled], ["MODEL_CONVERT_CLOUD_RUN_URL", saved.url]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Vercel entry wires auth, limits and proxy headers when enabled (fetch mocked)", async () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve("../api/model-convert.js");
  const keys = ["MODEL_CONVERT_ENABLED", "MODEL_CONVERT_CLOUD_RUN_URL", "MODEL_CONVERT_PROXY_SECRET", "MODEL_CONVERT_RATE_USER_MAX", "VERCEL"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const authCalls = [];
  const converterCalls = [];
  // The real verifyNpcAiUser runs against this mocked Supabase /auth/v1/user; no network is used.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/auth/v1/user")) {
      authCalls.push(url);
      const token = /^Bearer (.+)$/u.exec(init.headers?.Authorization ?? "")?.[1];
      return TOKENS[token]
        ? new Response(JSON.stringify({ id: TOKENS[token], is_anonymous: false }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    if (url === UPSTREAM) { converterCalls.push(init); return new Response(glb(), { status: 200 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, {
      MODEL_CONVERT_ENABLED: "1", MODEL_CONVERT_CLOUD_RUN_URL: UPSTREAM,
      MODEL_CONVERT_PROXY_SECRET: "placeholder-proxy-key", MODEL_CONVERT_RATE_USER_MAX: "1", VERCEL: "1"
    });
    delete require.cache[path];
    const handler = require(path);
    const send = async (options) => { const res = response(); await handler(request(options), res); return res; };
    const get = await send({ method: "GET" });
    assert.deepEqual(get.body, { enabled: true });
    assert.equal((await send({})).statusCode, 401);
    assert.equal((await send({ token: "not-a-real-session-token-000" })).statusCode, 401);
    const ok = await send({ token: "fake-token-user-a-000000", headers: { "x-vercel-forwarded-for": "198.51.100.40" } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers["content-type"], "model/gltf-binary");
    assert.equal(converterCalls.length, 1);
    assert.equal(converterCalls[0].headers["X-Converter-Key"], "placeholder-proxy-key");
    // Env limits are applied: MODEL_CONVERT_RATE_USER_MAX=1.
    const again = await send({ token: "fake-token-user-a-000000", headers: { "x-vercel-forwarded-for": "198.51.100.41" } });
    assert.equal(again.statusCode, 429);
    assert.equal(authCalls.length, 3);
    assert.equal(converterCalls.length, 1);
  } finally {
    globalThis.fetch = savedFetch;
    delete require.cache[path];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("client IP uses platform headers only when trusted and ignores raw x-forwarded-for", () => {
  const req = { headers: { "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "198.51.100.8", "x-real-ip": "198.51.100.9" }, socket: { remoteAddress: "10.0.0.1" } };
  assert.equal(modelConvertClientIp(req), "10.0.0.1");
  assert.equal(modelConvertClientIp(req, { trustProxyHeaders: true }), "198.51.100.8");
  assert.equal(modelConvertClientIp({ headers: { "x-forwarded-for": "1.2.3.4" }, socket: { remoteAddress: "10.0.0.1" } }, { trustProxyHeaders: true }), "10.0.0.1");
  assert.equal(modelConvertClientIp({ headers: { "x-real-ip": "<script>" }, socket: {} }, { trustProxyHeaders: true }), "unknown");
});

test("limit env parsing uses safe defaults for missing or invalid values", () => {
  const defaults = { userMax: 5, ipMax: 60, windowSec: 3600, authFailIpMax: 30, authFailWindowSec: 600, maxKeys: 10000 };
  assert.deepEqual(modelConvertLimitsFromEnv({}), defaults);
  assert.deepEqual(
    modelConvertLimitsFromEnv({
      MODEL_CONVERT_RATE_USER_MAX: "0", MODEL_CONVERT_RATE_IP_MAX: "abc", MODEL_CONVERT_RATE_WINDOW_SEC: "-5",
      MODEL_CONVERT_RATE_AUTH_FAIL_IP_MAX: "1.5", MODEL_CONVERT_RATE_AUTH_FAIL_WINDOW_SEC: "999999"
    }),
    defaults);
  assert.deepEqual(
    modelConvertLimitsFromEnv({
      MODEL_CONVERT_RATE_USER_MAX: "3", MODEL_CONVERT_RATE_IP_MAX: "9", MODEL_CONVERT_RATE_WINDOW_SEC: "600",
      MODEL_CONVERT_RATE_AUTH_FAIL_IP_MAX: "7", MODEL_CONVERT_RATE_AUTH_FAIL_WINDOW_SEC: "120"
    }),
    { userMax: 3, ipMax: 9, windowSec: 600, authFailIpMax: 7, authFailWindowSec: 120, maxKeys: 10000 });
});

test("full key table evicts expired keys first and refuses only until the soonest key frees", () => {
  let t = 0;
  const limiter = createSlidingWindowLimiter({ max: 2, windowMs: 10_000, maxKeys: 2, now: () => t });
  assert.equal(limiter.take("a").ok, true);
  t = 4000;
  assert.equal(limiter.take("b").ok, true);
  t = 6000;
  assert.equal(limiter.take("a").ok, true);
  // Full: "b" (last hit at 4s) frees at 14s, before "a" (last hit at 6s) frees at 16s.
  assert.deepEqual(limiter.take("c"), { ok: false, retryAfterSec: 8 });
  assert.deepEqual(limiter.take("d"), { ok: false, retryAfterSec: 8 });
  assert.equal(limiter.take("b").ok, true, "existing keys keep working while the table is full");
  t = 16_000;
  // Both "a" and "b" (re-hit at 6s) have fully expired by 16s and are evicted for "c".
  assert.equal(limiter.take("c").ok, true, "expired keys are evicted for new ones");
  assert.equal(limiter.size(), 1);
  assert.equal(limiter.check("d").ok, true);
  assert.equal(limiter.size(), 1, "check does not record");
});

test("evictWhenFull limiter passes unknown keys and reserve/release undo a hit", () => {
  let t = 0;
  const limiter = createSlidingWindowLimiter({ max: 2, windowMs: 10_000, maxKeys: 2, evictWhenFull: true, now: () => t });
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  t = 1000;
  assert.equal(limiter.take("b").ok, true);
  assert.equal(limiter.check("a").ok, false);
  assert.equal(limiter.check("c").ok, true, "unknown key passes while the table is full");
  const held = limiter.reserve("c");
  assert.equal(held.ok, true);
  assert.equal(limiter.size(), 2, "oldest key evicted to stay within maxKeys");
  assert.equal(limiter.check("a").ok, true);
  held.release();
  held.release();
  assert.equal(limiter.size(), 1, "released hit is removed and the empty key dropped");
  const first = limiter.reserve("b");
  assert.equal(first.ok, true);
  assert.equal(limiter.reserve("b").ok, false, "a pending reservation counts toward max");
  first.release();
  assert.equal(limiter.reserve("b").ok, true);
});

test("editor token helper returns only a member session token", async () => {
  const config = { url: "https://example.invalid", publishableKey: "placeholder" };
  const sdkWith = session => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }) } }) });
  resetEditorModelConvertAuthForTest();
  assert.equal(await getEditorModelConvertToken({ sdk: sdkWith({ access_token: "member-token", user: { is_anonymous: false } }), config }), "member-token");
  resetEditorModelConvertAuthForTest();
  assert.equal(await getEditorModelConvertToken({ sdk: sdkWith({ access_token: "guest-token", user: { is_anonymous: true } }), config }), null);
  resetEditorModelConvertAuthForTest();
  assert.equal(await getEditorModelConvertToken({ sdk: sdkWith(null), config }), null);
  assert.equal(await getEditorModelConvertToken({ sdk: undefined, config }), null);
  resetEditorModelConvertAuthForTest();
});
