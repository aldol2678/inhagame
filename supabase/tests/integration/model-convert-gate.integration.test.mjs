// Disposable local-stack integration only. NEVER run against a cloud Supabase project.
// Exercises the unmodified Vercel handler, real local PostgREST quota RPC and a
// synthetic converter response; no credentials or data leave loopback.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const { API_URL, DB_URL, ANON_KEY, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOCAL_API = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u;
const LOCAL_DB = /^postgres(?:ql)?:\/\/[^@/]*@(?:127\.0\.0\.1|localhost):\d+\//u;
assert.match(API_URL || "", LOCAL_API, "must use disposable loopback API only");
assert.match(DB_URL || "", LOCAL_DB, "must use disposable loopback DB only");
assert.ok(ANON_KEY && JWT_SECRET, "local anonymous key and JWT secret required");
assert.notEqual(process.env.CI, "false"); // No remote operation regardless of CI setting.

const PROXY_SUPABASE_URL = "https://isolated-model-convert.supabase.co";
const CONVERTER_URL = "https://model-converter.invalid";
const roleKey = () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ role: "service_role", aud: "authenticated", iss: "supabase",
    iat: now, exp: now + 600 });
  const signature = createHmac("sha256", JWT_SECRET).update(header + "." + payload).digest("base64url");
  return header + "." + payload + "." + signature;
};
const serviceRoleJwt = roleKey();
const users = Array.from({ length: 7 }, () => randomUUID());
const outsider = randomUUID();
const actorIds = [...users, outsider];
const envKeys = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "MODEL_CONVERT_ENABLED", "MODEL_CONVERT_CLOUD_RUN_URL", "MODEL_CONVERT_PROXY_SECRET",
  "MODEL_CONVERT_ALLOWED_USER_IDS"];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  SUPABASE_URL: PROXY_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_LOCAL_ONLY_NOT_A_SECRET",
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
  MODEL_CONVERT_ENABLED: "1",
  MODEL_CONVERT_CLOUD_RUN_URL: CONVERTER_URL,
  MODEL_CONVERT_PROXY_SECRET: "synthetic-only-secret-" + "x".repeat(24),
  MODEL_CONVERT_ALLOWED_USER_IDS: users.join(",")
});

const require = createRequire(import.meta.url);
const handler = require("../../../apps/world/api/model-convert.js");
const fetchActual = globalThis.fetch;
const glb = Buffer.alloc(20);
glb.write("glTF", 0, "ascii");
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
const fbx = Buffer.from("Kaydara FBX Binary  \0\x1a\0", "binary");
let cloudCalls = 0;
let quotaCalls = 0;
let quotaOutage = false;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === PROXY_SUPABASE_URL + "/auth/v1/user") {
    const authorization = String(init.headers?.Authorization || "");
    const actor = authorization.replace(/^Bearer /u, "");
    return actorIds.includes(actor)
      ? Response.json({ id: actor, is_anonymous: false })
      : Response.json({ error: "invalid_token" }, { status: 401 });
  }
  if (url === PROXY_SUPABASE_URL + "/rest/v1/rpc/claim_world_model_convert_quota_v1") {
    quotaCalls++;
    if (quotaOutage) return Response.json({ error: "unavailable" }, { status: 503 });
    // The only real HTTP request is to the disposable loopback PostgREST instance.
    return fetchActual(API_URL + "/rest/v1/rpc/claim_world_model_convert_quota_v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY,
        Authorization: "Bearer " + serviceRoleJwt },
      body: init.body
    });
  }
  if (url === CONVERTER_URL) {
    cloudCalls++;
    return new Response(glb, { status: 200, headers: { "content-type": "model/gltf-binary" } });
  }
  throw new Error("NON_LOCAL_NETWORK_REQUEST_BLOCKED");
};

function runSql(query) {
  const args = ["-v", "ON_ERROR_STOP=1", "-Atq", "-c", query];
  try {
    return execFileSync("psql", [DB_URL, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (error.code !== "ENOENT" || !PSQL_FALLBACK_CONTAINER) throw error;
    return execFileSync("docker", ["exec", PSQL_FALLBACK_CONTAINER, "psql",
      "-U", "postgres", "-d", "postgres", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
}
function clearFixtureClaims() {
  // Only synthetic IDs created in this test file; never touch other fixture data.
  runSql("delete from private.world_model_convert_claims where user_id in (" +
    actorIds.map(id => "'" + id + "'::uuid").join(",") + ")");
}
async function send(id, { authorization = "Bearer " + id } = {}) {
  const res = {
    statusCode: 0, body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
  await handler({
    method: "POST",
    headers: { host: "inhagame.app", "content-type": "application/octet-stream",
      "x-model-filename": "fixture.fbx", authorization },
    body: fbx
  }, res);
  return res;
}
async function directQuota(bearer) {
  return fetchActual(API_URL + "/rest/v1/rpc/claim_world_model_convert_quota_v1", {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: "Bearer " + bearer,
      "Content-Type": "application/json" },
    body: JSON.stringify({ p_user_id: users[0] })
  });
}
test.after(() => {
  try { clearFixtureClaims(); } finally {
    globalThis.fetch = fetchActual;
    for (const [key, original] of Object.entries(savedEnv)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }
});
test("PostgREST rejects anonymous and authenticated RPC access", async () => {
  const anon = await directQuota(ANON_KEY);
  assert.notEqual(anon.status, 200, "anon cannot bypass server quota accounting");
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ role: "authenticated", aud: "authenticated", sub: outsider,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", JWT_SECRET).update(head + "." + body).digest("base64url");
  const authenticated = await directQuota(head + "." + body + "." + sig);
  assert.notEqual(authenticated.status, 200, "signed-in players cannot call service-only quota RPC");
});
test("unverified and non-operator requests never consume quota", async () => {
  const before = quotaCalls;
  assert.equal((await send(users[0], { authorization: "" })).statusCode, 401);
  assert.equal((await send(outsider)).statusCode, 403);
  assert.equal(quotaCalls, before);
  assert.equal(cloudCalls, 0);
});
test("real local PostgREST enforces three operator claims in a rolling hour", async () => {
  clearFixtureClaims();
  for (let n = 0; n < 3; n++) {
    const response = await send(users[0]);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, glb);
  }
  const fourth = await send(users[0]);
  assert.equal(fourth.statusCode, 429);
  assert.deepEqual(fourth.body, { error: "E_MODEL_CONVERT_RATE_LIMITED" });
  assert.equal(cloudCalls, 3);
});
test("real PostgREST blocks the 21st total claim across multiple operators", async () => {
  clearFixtureClaims();
  cloudCalls = 0;
  for (let n = 0; n < 20; n++) {
    assert.equal((await send(users[Math.floor(n / 3)])).statusCode, 200, "claim " + (n + 1));
  }
  assert.equal((await send(users[6])).statusCode, 429, "global cap before seventh user's third claim");
  assert.equal(cloudCalls, 20, "no converter request for the rejected quota claim");
});
test("quota outage fails closed and does not touch the converter", async () => {
  clearFixtureClaims();
  quotaOutage = true;
  const before = cloudCalls;
  try {
    const response = await send(users[0]);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: "E_MODEL_QUOTA_UNAVAILABLE" });
    assert.equal(cloudCalls, before);
  } finally { quotaOutage = false; }
});
