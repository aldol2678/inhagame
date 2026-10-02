// Social S1-D2 · friend room visit: server resolver client + visit controller.
//
// Player Card / Friends panel → [🏠 방 방문] → resolve_friend_personal_room_v1(owner) (friendship,
// blocks, room existence and visibility are all checked server-side) → the shared
// ROOM_PERSONAL_BASIC scene with visitor metadata. Leaving always lands in the 제1생활관 Dorm
// Lobby, never at an arbitrary campus position. Allowed from the campus and from the Dorm Lobby;
// not from another interior, the main lobby shell, a mount or mid-transition.

import { DORM_1_LOBBY_MY_ROOM_RETURN } from "./dorm1-lobby-layout.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_TYPES = new Set(["DORM_1_BASIC"]);
const VISIBILITY = new Set(["private", "friends"]);
const KNOWN = new Set([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "TARGET_UNAVAILABLE",
  "NOT_FRIENDS", "ROOM_NOT_FOUND", "ROOM_PRIVATE"
]);
export const PERSONAL_ROOM_ID = "ROOM_PERSONAL_BASIC";
export const DORM_LOBBY_ID = "ROOM_DORM1_LOBBY";

export class FriendRoomVisitError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseFriendRoom(raw) {
  if (!raw || typeof raw !== "object" || !UUID.test(raw.roomId ?? "") || !UUID.test(raw.ownerUserId ?? "")) return null;
  if (!ROOM_TYPES.has(raw.roomType) || !VISIBILITY.has(raw.visibility)) return null;
  return Object.freeze({
    roomId: raw.roomId,
    ownerUserId: raw.ownerUserId,
    ownerDisplayName: typeof raw.ownerDisplayName === "string" && raw.ownerDisplayName.trim()
      ? raw.ownerDisplayName.trim().slice(0, 40) : "친구",
    roomType: raw.roomType,
    visibility: raw.visibility
  });
}

export class FriendRoomVisitClient {
  constructor({ getClient, getSelfUserId }) {
    this.getClient = getClient;
    this.getSelfUserId = getSelfUserId;
  }
  get available() { return !!this.getClient?.() && UUID.test(this.getSelfUserId?.() ?? ""); }
  async resolve(ownerUserId) {
    const client = this.getClient?.();
    const self = this.getSelfUserId?.();
    if (!client || !UUID.test(self ?? "")) throw new FriendRoomVisitError("SIGNED_OUT");
    if (!UUID.test(ownerUserId ?? "") || ownerUserId === self) throw new FriendRoomVisitError("TARGET_UNAVAILABLE");
    const { data, error } = await client.rpc("resolve_friend_personal_room_v1", { p_owner: ownerUserId });
    if (this.getSelfUserId?.() !== self) throw new FriendRoomVisitError("SIGNED_OUT");
    if (error) {
      const code = String(error.message ?? "").trim();
      throw new FriendRoomVisitError(KNOWN.has(code) ? code : "FAILED");
    }
    const room = parseFriendRoom(data);
    if (!room || room.ownerUserId !== ownerUserId) throw new FriendRoomVisitError("FAILED");
    return room;
  }
}

export const FRIEND_ROOM_VISIT_TEXT = Object.freeze({
  busy: "잠시 후 다시 시도해 주세요.",
  mounted: "탈것에서 내린 뒤 친구 방을 방문할 수 있어요.",
  lobby_shell: "캠퍼스에 들어간 뒤 친구 방을 방문할 수 있어요.",
  inside_room: "지금 있는 곳에서 나간 뒤 방문할 수 있어요.",
  signed_out: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  SIGNED_OUT: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  PERMANENT_ACCOUNT_REQUIRED: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  ACCOUNT_UNAVAILABLE: "현재 계정으로는 친구 방을 방문할 수 없어요.",
  ROOM_NOT_FOUND: "친구가 아직 제1생활관 방을 열지 않았어요.",
  ROOM_PRIVATE: "친구가 방을 비공개로 해 두었어요.",
  NOT_FRIENDS: "지금은 이 친구의 방을 방문할 수 없어요.",
  TARGET_UNAVAILABLE: "지금은 이 친구의 방을 방문할 수 없어요.",
  FAILED: "친구 방을 불러오지 못했어요."
});

export function createFriendRoomVisitController({
  client, rooms, isMounted = () => false, isSeated = () => false, standUp = () => {},
  stopFollow = () => {}, isLobbyShell = () => false, onStatus = () => {},
  returnAnchor = DORM_1_LOBBY_MY_ROOM_RETURN
} = {}) {
  let visiting = false;

  function canVisit() {
    if (!client?.available) return { ok: false, reason: "signed_out" };
    if (isLobbyShell()) return { ok: false, reason: "lobby_shell" };
    const status = rooms?.status?.() ?? {};
    if (status.busy || visiting) return { ok: false, reason: "busy" };
    const space = rooms?.currentSpace;
    if (space !== "campus" && space !== DORM_LOBBY_ID) return { ok: false, reason: "inside_room" };
    if (isMounted()) return { ok: false, reason: "mounted" };
    return { ok: true, reason: null };
  }

  async function visit(ownerUserId) {
    const verdict = canVisit();
    if (!verdict.ok) { onStatus(FRIEND_ROOM_VISIT_TEXT[verdict.reason] ?? FRIEND_ROOM_VISIT_TEXT.FAILED); return verdict; }
    visiting = true;
    try {
      const visitorUserId = client.getSelfUserId?.();
      const authority = await client.resolve(ownerUserId);
      // The world may have changed while the resolver ran (sign-out, a door, a mount).
      const again = (() => { visiting = false; const v = canVisit(); visiting = true; return v; })();
      if (client.getSelfUserId?.() !== visitorUserId || !again.ok) {
        const reason = client.getSelfUserId?.() !== visitorUserId ? "signed_out" : again.reason;
        onStatus(FRIEND_ROOM_VISIT_TEXT[reason] ?? FRIEND_ROOM_VISIT_TEXT.FAILED);
        return { ok: false, reason };
      }
      if (isSeated()) standUp();
      stopFollow();
      const metadata = {
        personalRoomId: authority.roomId, ownerUserId: authority.ownerUserId,
        ownerDisplayName: authority.ownerDisplayName, visitRole: "visitor"
      };
      const isValid = () => client.available && client.getSelfUserId?.() === visitorUserId;
      const options = { returnPosition: returnAnchor.position, returnYaw: returnAnchor.yaw, metadata, isValid };
      const ok = rooms.currentSpace === DORM_LOBBY_ID
        ? rooms.enterNested(PERSONAL_ROOM_ID, { ...options, fromRoomId: DORM_LOBBY_ID })
        : rooms.enterNestedFromCampus(PERSONAL_ROOM_ID, { ...options, parentRoomId: DORM_LOBBY_ID });
      if (!ok) { onStatus(FRIEND_ROOM_VISIT_TEXT.busy); return { ok: false, reason: "busy" }; }
      return { ok: true, authority };
    } catch (error) {
      const code = error instanceof FriendRoomVisitError ? error.code : "FAILED";
      onStatus(FRIEND_ROOM_VISIT_TEXT[code] ?? FRIEND_ROOM_VISIT_TEXT.FAILED);
      return { ok: false, reason: code };
    } finally {
      visiting = false;
    }
  }

  return { canVisit, visit, get visiting() { return visiting; } };
}

