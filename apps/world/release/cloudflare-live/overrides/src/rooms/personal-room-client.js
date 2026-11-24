// Social S1-D1.3 · account-bound personal room client.
// Ownership authority lives in get_or_create_my_personal_room_v1(); the browser never sends a user id.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open — READ + WRITE, A-2): both paths authenticate
// with the v0.1 guest session id in the `X-Session-Id` header only — no other credential header
// is sent. The id is read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The account bound by setAccount IS that session id.
// Ensure: GET /api/world-personal-room. Set visibility: POST /api/world-personal-room
// { action: 'setVisibility', visibility }. The server answers 200 + the room JSON, or an HTTP
// status with { error: <server refusal code> }.
// Before: the client called getClient().rpc() on the signed-in permanent-account client
// (get_or_create_my_personal_room_v1 / set_my_personal_room_visibility_v1). That path is gone;
// only the transport changed — parsing, the caching rules and the error codes are unchanged.

import { readGuestSessionId } from "../activity/session-id.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PERSONAL_ROOM_API_PATH = "/api/world-personal-room";
const ROOM_TYPES=new Set(["DORM_1_BASIC"]);
const VISIBILITY=new Set(["private","friends"]);
const KNOWN_ERRORS=new Set(["PERMANENT_ACCOUNT_REQUIRED","ACCOUNT_UNAVAILABLE","ROOM_NOT_FOUND","INVALID_VISIBILITY"]);

export class PersonalRoomError extends Error {
  constructor(code){super(code);this.code=code;}
}
const isUuid=value=>typeof value==="string"&&UUID.test(value);

export function parsePersonalRoom(raw){
  if(!raw||typeof raw!=="object"||!isUuid(raw.roomId)||!isUuid(raw.ownerUserId))return null;
  if(!ROOM_TYPES.has(raw.roomType)||!VISIBILITY.has(raw.visibility))return null;
  return Object.freeze({
    roomId:raw.roomId,
    ownerUserId:raw.ownerUserId,
    roomType:raw.roomType,
    visibility:raw.visibility,
    createdAt:typeof raw.createdAt==="string"?raw.createdAt:null,
    updatedAt:typeof raw.updatedAt==="string"?raw.updatedAt:null
  });
}

export class PersonalRoomClient{
  constructor({
    getSessionId = readGuestSessionId,
    fetcher = (...args) => globalThis.fetch(...args),
    endpoint = PERSONAL_ROOM_API_PATH,
    getSelfUserId
  }){
    this.getSessionId=getSessionId;
    this.fetcher=fetcher;
    this.endpoint=endpoint;
    this.getSelfUserId=getSelfUserId;
    this.inFlight=null;
    this.cached=null;
    this.cachedUserId=null;
    this.generation=0;
  }
  get available(){
    return isUuid(this.getSelfUserId?.());
  }
  reset(){this.generation++;this.inFlight=null;this.cached=null;this.cachedUserId=null;}

  /** Fetch helper: returns { data } on 200, { error: { message: <code> } } otherwise. */
  async #call(action, body = null) {
    let sessionId=null;
    try { sessionId=await this.getSessionId?.() ?? null; } catch { sessionId=null; }
    if (!sessionId) return { error: { message: "FAILED" } };
    try {
      const response = await this.fetcher(this.endpoint, body === null
        ? { headers: { "X-Session-Id": sessionId } }
        : { method: "POST", headers: { "Content-Type": "application/json", "X-Session-Id": sessionId }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) return { error: { message: typeof data?.error === "string" && data.error ? data.error : "FAILED" } };
      return { data };
    } catch { return { error: { message: "FAILED" } }; }
  }

  async ensure(){
    const userId=this.getSelfUserId?.();
    if(!isUuid(userId))throw new PersonalRoomError("SIGNED_OUT");
    if(this.cached&&this.cachedUserId===userId)return this.cached;
    if(this.cachedUserId&&this.cachedUserId!==userId)this.reset();
    if(this.inFlight)return this.inFlight;
    const generation=this.generation;
    const request=(async()=>{
      const {data,error}=await this.#call("ensure");
      if(this.generation!==generation||this.getSelfUserId?.()!==userId)
        throw new PersonalRoomError("SIGNED_OUT");
      if(error){
        const code=String(error.message??"").trim();
        throw new PersonalRoomError(KNOWN_ERRORS.has(code)?code:"FAILED");
      }
      const room=parsePersonalRoom(data);
      if(!room||room.ownerUserId!==userId)throw new PersonalRoomError("FAILED");
      this.cached=room;
      this.cachedUserId=userId;
      return room;
    })().finally(()=>{if(this.inFlight===request)this.inFlight=null;});
    this.inFlight=request;
    return this.inFlight;
  }
  // S1-D2 owner privacy: PRIVATE / FRIENDS only. The server derives the room from auth.uid().
  async setVisibility(visibility){
    const userId=this.getSelfUserId?.();
    if(!isUuid(userId))throw new PersonalRoomError("SIGNED_OUT");
    if(!VISIBILITY.has(visibility))throw new PersonalRoomError("INVALID_VISIBILITY");
    const generation=this.generation;
    const {data,error}=await this.#call("setVisibility", { action: "setVisibility", visibility });
    if(this.generation!==generation||this.getSelfUserId?.()!==userId)throw new PersonalRoomError("SIGNED_OUT");
    if(error){
      const code=String(error.message??"").trim();
      throw new PersonalRoomError(KNOWN_ERRORS.has(code)?code:"FAILED");
    }
    const room=parsePersonalRoom(data);
    if(!room||room.ownerUserId!==userId||room.visibility!==visibility)throw new PersonalRoomError("FAILED");
    this.cached=room;
    this.cachedUserId=userId;
    return room;
  }
}

