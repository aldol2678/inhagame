import { isUserId, SocialError } from "./social-client.js";

export const ACCOMPANY_POIS = Object.freeze([
  ["poi.main-gate", "정문"], ["poi.main-hall", "본관"],
  ["poi.inkyung-pond", "인경호"], ["poi.jungseok", "정석학술정보관"]
]);
const POI_IDS = new Set(ACCOMPANY_POIS.map(([id]) => id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONE = /^AREA_[A-Z0-9_]{1,60}$/;
const STATES = new Set(["offered", "active"]);
const ERRORS = new Set(["NOT_ALLOWED", "ALREADY_BUSY", "RATE_LIMITED", "TARGET_UNAVAILABLE",
  "INVALID_DESTINATION", "INVALID_PLACE_ZONE", "ACCOUNT_UNAVAILABLE", "PERMANENT_ACCOUNT_REQUIRED"]);

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
  constructor({ getClient, getSelfUserId }) { Object.assign(this, { getClient, getSelfUserId }); }
  async #rpc(name, args = {}) {
    const client = this.getClient();
    if (!client || !isUserId(this.getSelfUserId())) throw new SocialError("SIGNED_OUT");
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const code = String(error.message || "").trim();
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
