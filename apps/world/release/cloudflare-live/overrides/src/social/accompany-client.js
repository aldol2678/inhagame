import { isUserId, SocialError } from "./social-client.js";
import { readGuestSessionId } from "../activity/session-id.js";

// AUTH (migrated 2026-11-20, Tier 4 guest-open — A-3): every path authenticates with the v0.1
// guest session id in the `X-Session-Id` header only — no other credential header is sent.
// The id is read lazily by readGuestSessionId() (the single source; null when absent — never
// fabricated). Read: GET /api/world-accompany. Mutations: POST /api/world-accompany
// { action: propose|respond|end, target?, poiId?, placeZoneId?, sessionId?, accept? }.
// The server answers 200 + the result, or an HTTP status with { error: <server refusal code> }.
// A missing profile answers 409 PROFILE_NOT_FOUND (added to ERRORS so the UI can show it).
// Before: the client called getClient().rpc() on the signed-in permanent-account client.
// That path is gone; only the transport changed — parsing and the error mapping are unchanged.
export const ACCOMPANY_API_PATH = "/api/world-accompany";

// RPC name -> Tier 4 request (the Worker maps the action back to the RPC).
function accompanyRequest(name, args, sessionId) {
  const get = (path) => ({ path, init: { headers: { "X-Session-Id": sessionId } } });
  const post = (body) => ({ path: ACCOMPANY_API_PATH, init: { method: "POST", headers: { "Content-Type": "application/json", "X-Session-Id": sessionId }, body: JSON.stringify(body) } });
  switch (name) {
    case "get_my_world_accompany": return get(ACCOMPANY_API_PATH);
    case "propose_world_accompany": return post({ action: "propose", target: args.p_target, poiId: args.p_poi_id, placeZoneId: args.p_place_zone_id });
    case "respond_world_accompany": return post({ action: "respond", sessionId: args.p_session_id, accept: args.p_accept });
    case "end_world_accompany": return post({ action: "end", sessionId: args.p_session_id });
    default: throw new Error(`unknown accompany RPC: ${name}`);
  }
}

export const ACCOMPANY_POIS = Object.freeze([
  ["poi.main-gate", "정문"], ["poi.main-hall", "본관"],
  ["poi.inkyung-pond", "인경호"], ["poi.jungseok", "정석학술정보관"]
]);
const POI_IDS = new Set(ACCOMPANY_POIS.map(([id]) => id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONE = /^AREA_[A-Z0-9_]{1,60}$/;
const STATES = new Set(["offered", "active"]);
const ERRORS = new Set(["NOT_ALLOWED", "ALREADY_BUSY", "RATE_LIMITED", "TARGET_UNAVAILABLE",
  "INVALID_DESTINATION", "INVALID_PLACE_ZONE", "ACCOUNT_UNAVAILABLE", "PERMANENT_ACCOUNT_REQUIRED",
  "PROFILE_NOT_FOUND"]);

export function parseAccompanySession(raw, selfUserId) {
  if (!raw || !UUID.test(raw.id) || !isUserId(raw.inviterId) || !isUserId(raw.inviteeId)
    || !STATES.has(raw.state) || !POI_IDS.has(raw.poiId) || !ZONE.test(raw.placeZoneId)
    || ![raw.inviterId, raw.inviteeId].includes(selfUserId)) return null;
  const peerId = raw.inviterId === selfUserId ? raw.inviteeId : raw.inviterId;
  if (raw.peer?.userId !== peerId) return null;
  const expiresAt = Date.parse(raw.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  return Object.freeze({ id: raw.id, inviterId: raw.inviterId, inviteeId: raw.inviteeId,
    peerId, peerName: String(raw.peer.nickname || "친구").slice(0, 12),
    placeZoneId: raw.placeZoneId, poiId: raw.poiId, state: raw.state, expiresAt });
}

export class AccompanyClient {
  constructor({ getSessionId = readGuestSessionId, getSelfUserId, fetcher = (...args) => globalThis.fetch(...args) } = {}) { Object.assign(this, { getSessionId, getSelfUserId, fetcher }); }
  async #rpc(name, args = {}) {
    if (!isUserId(this.getSelfUserId())) throw new SocialError("SIGNED_OUT");
    let sessionId = null;
    try { sessionId = await this.getSessionId?.() ?? null; } catch { sessionId = null; }
    if (!sessionId) throw new SocialError("SIGNED_OUT");
    const { path, init } = accompanyRequest(name, args, sessionId);
    let response;
    try {
      response = await this.fetcher(path, init);
    } catch {
      throw new SocialError("FAILED");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.error === "string" ? data.error.trim() : `HTTP_${response.status}`;
      throw new SocialError(ERRORS.has(code) ? code : "FAILED");
    }
    return data;
  }
  async mine() {
    const raw = await this.#rpc("get_my_world_accompany");
    return (Array.isArray(raw) ? raw : []).map(s => parseAccompanySession(s, this.getSelfUserId())).filter(Boolean);
  }
  async propose(userId, poiId, zoneId) {
    if (!isUserId(userId) || !POI_IDS.has(poiId) || !ZONE.test(zoneId || "")) throw new SocialError("INVALID_DESTINATION");
    return this.#rpc("propose_world_accompany", { p_target: userId, p_poi_id: poiId, p_place_zone_id: zoneId });
  }
  async respond(id, accept) {
    if (!UUID.test(id)) throw new SocialError("TARGET_UNAVAILABLE");
    return this.#rpc("respond_world_accompany", { p_session_id: id, p_accept: !!accept });
  }
  async end(id) {
    if (!UUID.test(id)) throw new SocialError("TARGET_UNAVAILABLE");
    return this.#rpc("end_world_accompany", { p_session_id: id });
  }
}
