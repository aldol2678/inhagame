import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Observe, never replace, the response the browser actually executes.
export async function verifyHousingShippedMain(response) {
  const source = await readFile(new URL("../../src/main.js", import.meta.url), "utf8");
  const sha256 = value => createHash("sha256").update(value).digest("hex");
  assert.equal(response.status(), 200, "browser loaded shipped main successfully");
  const served = await response.text();
  assert.equal(sha256(served), sha256(source), "housing browser must execute the exact shipped main");
  return { mode: "SHIPPED_SYNTHETIC_HOUSING_AUTHORITY", shippedMainSha256: sha256(source), servedMainSha256: sha256(served) };
}

// Test-only dependency fixture. The shipped online identity, owner parser, native door,
// preparation and Room Session run unchanged. No token means Realtime stays offline;
// harness.mjs still blocks every off-origin request. This is NOT server-authority QA.
export async function installSyntheticHousingAuthority(context) {
  await context.addInitScript(() => {
    // Playwright also evaluates init scripts in a new page's initial empty document.
    if (location.href === "about:blank") return;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname))
      throw new Error("Synthetic housing authority is loopback-only");
    const owner = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const roomId = "33333333-3333-4333-8333-333333333333";
    let userId = null, ownerMismatch = false, channelCalls = 0;
    const listeners = new Set(), calls = [], unsupportedRpcs = {};
    const user = () => userId ? { id: userId, is_anonymous: false, email: "housing-synthetic@example.test" } : null;
    // Deliberately no access_token, refresh_token or persisted credentials.
    const session = () => userId ? { user: user() } : null;
    const failure = message => ({ data: null, error: { message } });
    const owned = () => userId === owner && !ownerMismatch;
    const room = () => ({ roomId, ownerUserId: ownerMismatch ? other : owner, roomType: "DORM_1_BASIC", visibility: "private" });
    const exactArgs = (args, keys) => args && typeof args === "object" && !Array.isArray(args)
      && Object.keys(args).length === keys.length && keys.every(key => Object.hasOwn(args, key));
    const query = table => {
      let singular = false, requestedUser = null;
      const value = () => table === "profiles" && singular && userId && requestedUser === userId
        ? { data: { user_id: userId, nickname: "주거합성검증", is_banned: false }, error: null }
        : failure("OFFLINE_SYNTHETIC_UNSUPPORTED_QUERY");
      let chain;
      chain = new Proxy({}, { get: (_target, property) => property === "then"
        ? (resolve, reject) => Promise.resolve(value()).then(resolve, reject)
        : (...args) => {
          if (property === "single" || property === "maybeSingle") singular = true;
          if (property === "eq" && args[0] === "user_id") requestedUser = args[1];
          return chain;
        } });
      return chain;
    };
    const client = {
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        getUser: async () => ({ data: { user: user() }, error: null }),
        onAuthStateChange(fn) {
          listeners.add(fn);
          return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
        },
        signInAnonymously: async () => ({ data: { user: null, session: null }, error: null })
      },
      from: query,
      channel() {
        channelCalls++;
        const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => "ok",
          track: async () => "ok", untrack: async () => "ok", send: async () => "ok", presenceState: () => ({}) };
        return channel;
      },
      removeChannel: async () => "ok",
      async rpc(name, args = {}) {
        if (!["get_or_create_my_personal_room_v1", "get_world_room_furniture_v1", "check_world_room_access_v1"].includes(name)) {
          unsupportedRpcs[name] = (unsupportedRpcs[name] ?? 0) + 1;
          return failure("OFFLINE_SYNTHETIC_UNSUPPORTED_RPC");
        }
        calls.push({ name, args: structuredClone(args), accountId: userId, ownerMismatch });
        if (name === "get_or_create_my_personal_room_v1") {
          if (!exactArgs(args, [])) return failure("INVALID_ARGUMENTS");
          if (!userId) return failure("PERMANENT_ACCOUNT_REQUIRED");
          if (userId !== owner) return failure("ACCOUNT_UNAVAILABLE");
          // Explicit malformed-authority regression: the shipped owner parser must reject it.
          return { data: room(), error: null };
        }
        const allowed = exactArgs(args, ["p_room"]) && args.p_room === roomId && owned();
        if (name === "get_world_room_furniture_v1") return allowed
          ? { data: { roomId, role: "owner", revision: 0, objects: [] }, error: null }
          : failure("LAYOUT_DENIED");
        return { data: allowed
          ? { roomId, allowed: true, role: "owner", ownerUserId: owner, visibility: "private" }
          : { roomId: args?.p_room ?? null, allowed: false, reason: "DENIED" }, error: null };
      }
    };
    globalThis.supabase = { createClient: () => client };
    globalThis.__HOUSING_SYNTHETIC__ = {
      owner, other, roomId,
      status: () => ({ userId, ownerMismatch, channelCalls, calls: structuredClone(calls), unsupportedRpcs: { ...unsupportedRpcs } }),
      setOwnerMismatch(value) { ownerMismatch = value === true; },
      switchAccount(id) {
        if (![null, owner, other].includes(id)) throw new Error("Unknown synthetic housing account");
        userId = id; ownerMismatch = false;
        for (const fn of listeners) fn(id ? "SIGNED_IN" : "SIGNED_OUT", session());
      }
    };
  });
}
