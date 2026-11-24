// Housing H3 · knock before a friend visit.
//
// Visitor: knock_friend_personal_room_v1(owner) → OPEN (owner away, admitted by visibility) or PENDING
// (owner home) → poll get_my_room_knock_v1 until ACCEPTED / DECLINED / EXPIRED.
// Owner: while inside the own room, poll list_my_room_knocks_v1 (it is also the presence heartbeat
// that makes the server ask visitors to knock) and answer with respond_room_knock_v1.
// The server decides everything; this module only carries requests and parses answers.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open reads, profile-required writes — A-2): all four
// actions authenticate with the v0.1 guest session id in the `X-Session-Id` header only — no
// other credential header is sent. The id is read lazily by readGuestSessionId()
// (fishing-reporter-wiring.js: localStorage 'inha-v01:sync-session', fallback
// 'inha-v01:server-session'; null when absent — never fabricated). The account bound by
// setAccount IS that session id.
// All actions: POST /api/world-room-knock { action: 'knock' | 'get' | 'list' | 'respond',
// ownerUserId?, knockId?, accept? }. The server answers 200 + the knock JSON, or an HTTP
// status with { error: <server refusal code> }. The design is POLLING, not push: the visitor
// polls its knock, the owner polls the pending list. Push delivery belongs to the C-group
// backbone and is out of scope here.
// Before: the client called getClient().rpc() on the signed-in permanent-account client
// (knock_friend_personal_room_v1, get_my_room_knock_v1, list_my_room_knocks_v1,
// respond_room_knock_v1). That path is gone; only the transport changed — parsing, the
// polling constants and the watcher rules are unchanged.

import { readGuestSessionId } from "../activity/session-id.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROOM_KNOCK_API_PATH = "/api/world-room-knock";

export const KNOCK_STATUS = Object.freeze({
  PENDING: "PENDING", ACCEPTED: "ACCEPTED", DECLINED: "DECLINED", EXPIRED: "EXPIRED", OPEN: "OPEN"
});
const STATUSES = new Set(Object.values(KNOCK_STATUS));
// Visitor polls its own knock; the server keeps a knock pending for 30 s.
export const KNOCK_POLL_MS = 1500;
export const KNOCK_WAIT_MS = 32_000;
// Owner heartbeat + knock list. The server treats an owner as home for 12 s after a poll.
export const OWNER_KNOCK_POLL_MS = 3000;

const KNOWN = new Set([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "SOCIAL_RESTRICTED", "TARGET_UNAVAILABLE",
  "NOT_FRIENDS", "ROOM_NOT_FOUND", "ROOM_PRIVATE", "VISIT_DECLINED", "KNOCK_REQUIRED",
  "KNOCK_NOT_FOUND", "RATE_LIMITED", "INVALID_RESPONSE",
  // A-2: the Tier 4 social caller raises PROFILE_NOT_FOUND for a missing or banned profile and
  // the Worker maps it to 409 PROFILE_REQUIRED (the origin raised ACCOUNT_UNAVAILABLE here).
  "PROFILE_NOT_FOUND", "PROFILE_REQUIRED"
]);

export class RoomKnockError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseKnock(raw) {
  if (!raw || typeof raw !== "object" || !UUID.test(raw.knockId ?? "") || !UUID.test(raw.roomId ?? "")) return null;
  if (!UUID.test(raw.visitorUserId ?? "") || !STATUSES.has(raw.status)) return null;
  return Object.freeze({
    knockId: raw.knockId,
    roomId: raw.roomId,
    visitorUserId: raw.visitorUserId,
    status: raw.status,
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : null,
    ownerPresent: raw.ownerPresent === true,
    visitorDisplayName: typeof raw.visitorDisplayName === "string" && raw.visitorDisplayName.trim()
      ? raw.visitorDisplayName.trim().slice(0, 40) : "친구"
  });
}

export class RoomKnockClient {
  constructor({
    getSessionId = readGuestSessionId,
    fetcher = (...args) => globalThis.fetch(...args),
    endpoint = ROOM_KNOCK_API_PATH,
    getSelfUserId
  }) {
    this.getSessionId = getSessionId;
    this.fetcher = fetcher;
    this.endpoint = endpoint;
    this.getSelfUserId = getSelfUserId;
  }
  get available() { return UUID.test(this.getSelfUserId?.() ?? ""); }
  async #call(rpc, args) {
    const self = this.getSelfUserId?.();
    if (!UUID.test(self ?? "")) throw new RoomKnockError("SIGNED_OUT");
    const action = rpc === "knock_friend_personal_room_v1" ? "knock"
      : rpc === "get_my_room_knock_v1" ? "get"
      : rpc === "list_my_room_knocks_v1" ? "list" : "respond";
    const body = { action };
    if (rpc === "knock_friend_personal_room_v1") body.ownerUserId = args.p_owner;
    if (rpc === "get_my_room_knock_v1") body.knockId = args.p_knock;
    if (rpc === "respond_room_knock_v1") { body.knockId = args.p_knock; body.accept = args.p_accept; }
    let sessionId = null;
    try { sessionId = await this.getSessionId?.() ?? null; } catch { sessionId = null; }
    if (!sessionId) throw new RoomKnockError("SIGNED_OUT");
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    // A sign-out or account switch while the request ran voids the answer.
    if (this.getSelfUserId?.() !== self) throw new RoomKnockError("SIGNED_OUT");
    if (!response.ok) {
      const code = typeof data?.error === "string" ? data.error.trim() : "";
      throw new RoomKnockError(KNOWN.has(code) ? code : "FAILED");
    }
    return { data, self };
  }
  async knock(ownerUserId) {
    if (!UUID.test(ownerUserId ?? "")) throw new RoomKnockError("TARGET_UNAVAILABLE");
    const { data, self } = await this.#call("knock_friend_personal_room_v1", { p_owner: ownerUserId });
    const knock = parseKnock(data);
    if (!knock || knock.visitorUserId !== self) throw new RoomKnockError("FAILED");
    return knock;
  }
  async get(knockId) {
    if (!UUID.test(knockId ?? "")) throw new RoomKnockError("KNOCK_NOT_FOUND");
    const { data, self } = await this.#call("get_my_room_knock_v1", { p_knock: knockId });
    const knock = parseKnock(data);
    if (!knock || knock.knockId !== knockId || knock.visitorUserId !== self) throw new RoomKnockError("FAILED");
    return knock;
  }
  async list() {
    const { data } = await this.#call("list_my_room_knocks_v1", {});
    if (!data || !UUID.test(data.roomId ?? "") || !Array.isArray(data.knocks)) throw new RoomKnockError("FAILED");
    return Object.freeze({
      roomId: data.roomId,
      knocks: Object.freeze(data.knocks.map(parseKnock).filter(k => k && k.roomId === data.roomId &&
        k.status === KNOCK_STATUS.PENDING))
    });
  }
  async respond(knockId, accept) {
    if (!UUID.test(knockId ?? "")) throw new RoomKnockError("KNOCK_NOT_FOUND");
    const { data } = await this.#call("respond_room_knock_v1", { p_knock: knockId, p_accept: accept === true });
    const knock = parseKnock(data);
    if (!knock || knock.knockId !== knockId) throw new RoomKnockError("FAILED");
    return knock;
  }
}

// Visitor side: wait for the owner's answer. Resolves with the final knock, or with the last seen
// knock and `cancelled: true` when isCancelled() turns true. Network errors while polling are
// retried until the deadline; the server's own 30 s expiry is the authority.
export async function waitForKnockAnswer({
  client, knock, isCancelled = () => false,
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(), pollMs = KNOCK_POLL_MS, timeoutMs = KNOCK_WAIT_MS
}) {
  let current = knock;
  const deadline = now() + timeoutMs;
  while (current.status === KNOCK_STATUS.PENDING) {
    if (isCancelled()) return { knock: current, cancelled: true };
    if (now() >= deadline) return { knock: Object.freeze({ ...current, status: KNOCK_STATUS.EXPIRED }), cancelled: false };
    await sleep(pollMs);
    if (isCancelled()) return { knock: current, cancelled: true };
    try { current = await client.get(current.knockId); }
    catch (error) {
      if (error instanceof RoomKnockError && error.code !== "FAILED") throw error;
    }
  }
  return { knock: current, cancelled: false };
}

// Owner side: poll while the owner is inside the own room and surface each new pending knock once.
export function createOwnerKnockWatcher({
  client, isOwnerInRoom = () => false, onKnock = () => {}, onPolled = () => {}, onError = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, pollMs = OWNER_KNOCK_POLL_MS
} = {}) {
  let timer = null;
  let polling = false;
  let running = false;
  const seen = new Set();

  async function poll() {
    timer = null;
    if (!running) return;
    if (!isOwnerInRoom() || !client?.available) { schedule(); return; }
    if (polling) { schedule(); return; }
    polling = true;
    try {
      const { knocks } = await client.list();
      for (const knock of knocks) {
        if (seen.has(knock.knockId)) continue;
        seen.add(knock.knockId);
        try { onKnock(knock); } catch { /* the prompt never stops the heartbeat */ }
      }
      try { onPolled(knocks); } catch { /* ignore */ }
    } catch (error) {
      try { onError(error); } catch { /* ignore */ }
    } finally {
      polling = false;
      schedule();
    }
  }
  function schedule() {
    if (running && timer === null) timer = setTimer(() => { void poll(); }, pollMs);
  }
  return {
    start() { if (running) return; running = true; void poll(); },
    stop() { running = false; if (timer !== null) clearTimer(timer); timer = null; seen.clear(); },
    pollNow() { if (running && !polling) { if (timer !== null) clearTimer(timer); timer = null; void poll(); } },
    get running() { return running; }
  };
}

// Owner arrival notices: which visitors joined or left between two Room Session snapshots.
export function diffRoomVisitors(previous, next) {
  const visitors = (snapshot) => new Map((snapshot?.participants ?? [])
    .filter(p => !p.local && p.role === "visitor" && typeof p.userId === "string")
    .map(p => [p.userId, p.displayName?.trim?.() || "친구"]));
  const before = visitors(previous);
  const after = visitors(next);
  return {
    joined: [...after].filter(([id]) => !before.has(id)).map(([, name]) => name),
    left: [...before].filter(([id]) => !after.has(id)).map(([, name]) => name)
  };
}
