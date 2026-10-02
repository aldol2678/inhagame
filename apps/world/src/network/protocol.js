// Online P0 wire protocol: presence, pose and action packets plus their validators.
// Pure data rules only. No transport, no PlayCanvas, no Supabase.
// Pose coordinates are NON-AUTHORITATIVE visual state: never use them for rewards, ranking or outcomes.

export const PROTOCOL_VERSION = 1;

export const Anim = Object.freeze({
  IDLE: "idle",
  WALK: "walk",
  RUN: "run",
  AIR: "air",
  FLY: "fly",
  // Social S1-B sit: durable pose state (late joiners see it), position/yaw = the seat anchor.
  SIT: "sit"
});
const ANIM_VALUES = new Set(Object.values(Anim));

// Which mount a FLY pose is riding. `anim` stays FLY for every mount so clients that predate this
// field keep accepting the pose (they rebuild poses from POSE_FIELDS and drop `mount`).
// Receivers: FLY without a known `mount` is the legacy dragon; `mount` on a non-FLY pose is ignored.
export const Mount = Object.freeze({
  BIKE: "bike",
  DRAGON: "dragon"
});
const MOUNT_VALUES = new Set(Object.values(Mount));
export function isValidMount(value) { return typeof value === "string" && MOUNT_VALUES.has(value); }
// The mount a pose shows: null unless FLY; FLY without a valid `mount` falls back to the dragon.
export function mountOf(anim, mount) {
  if (anim !== Anim.FLY) return null;
  return isValidMount(mount) ? mount : Mount.DRAGON;
}

export const ActionType = Object.freeze({
  JUMP: "jump",
  TELEPORT: "teleport",
  // Social S1-B1: payload { emote: one of EMOTE_IDS }.
  EMOTE: "emote",
  // Social S1-B2 local chat: payload { text, x, y, z } (sender position at send time).
  CHAT: "chat"
});
const ACTION_VALUES = new Set(Object.values(ActionType));
// Guests only move and jump: teleport is movement (a snap). Chat and emote stay member-only on
// both ends, because Realtime authorizes per channel and cannot inspect action payloads.
export const GUEST_ACTION_TYPES = Object.freeze([ActionType.JUMP, ActionType.TELEPORT]);
const GUEST_ACTION_SET = new Set(GUEST_ACTION_TYPES);
export function isGuestAction(type) { return GUEST_ACTION_SET.has(type); }

// Presence carries only public-display fields the World needs. Anything else is dropped.
export const PRESENCE_FIELDS = Object.freeze(["v", "sessionId", "userId", "displayName", "placeZoneId", "joinedAt"]);
// `guest: true` marks an anonymous guest session. Members omit it, so their presence is unchanged.
// `equipment` (Multiplayer Equipment Projection P0): members' sparse, visual-only equipped items.
export const PRESENCE_OPTIONAL_FIELDS = Object.freeze(["guest", "equipment"]);
export const POSE_FIELDS = Object.freeze(["v", "seq", "x", "y", "z", "yaw", "vx", "vz", "anim"]);
// Sent only while mounted (anim FLY). Never required, so older senders stay valid.
export const POSE_OPTIONAL_FIELDS = Object.freeze(["mount"]);
export const ACTION_FIELDS = Object.freeze(["v", "id", "type", "payload"]);

// Presence `equipment` wire contract (visual only, client-declared: never a reward, ownership or
// access-control input). A sparse object: slot → { itemId, catalogStatus }; empty slots are omitted
// and an empty loadout sends no field at all. Stable wire names: never rename, only append.
export const EQUIPMENT_WIRE_SLOTS = Object.freeze(["BODY", "FACE", "HAIR", "HEAD", "TOP", "BOTTOM", "SHOES", "BACK", "ACCESSORY"]);
export const EQUIPMENT_WIRE_STATUSES = Object.freeze(["ACTIVE", "COMING_SOON", "LOCKED", "DISABLED", "HIDDEN", "UNKNOWN_ITEM"]);
const EQUIPMENT_STATUS_SET = new Set(EQUIPMENT_WIRE_STATUSES);
// Same shape as the catalog item id rule (collection/item-catalog.js ITEM_ID_PATTERN), bounded.
const EQUIPMENT_ITEM_ID = /^[a-z][a-z0-9_]{0,39}\.[a-z0-9_]{1,40}$/;
const EMPTY_EQUIPMENT = Object.freeze({});

// Mirrors the campus nickname rule (campus-profile.js) so an email or token can never become a display name.
const DISPLAY_NAME = /^[가-힣A-Za-z0-9_ ]{2,12}$/u;
export const DEFAULT_DISPLAY_NAME = "인덕이";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// Abstract semantic Place Zone ID supplied by the spatial layer (e.g. AREA_MAIN_HALL). Never a render chunk.
const PLACE_ZONE_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Social S1-B1 expression set. Stable wire IDs: never rename, only append.
export const EMOTE_IDS = Object.freeze(["wave", "clap", "laugh", "dance", "photo_pose"]);
const EMOTE_ID_SET = new Set(EMOTE_IDS);
export function isValidEmoteId(value) { return typeof value === "string" && EMOTE_ID_SET.has(value); }

// Local chat text rule, shared by the sender and every receiver.
export const CHAT_MAX_LENGTH = 120; // Unicode code points, after normalization.
// C0/C1 controls, bidi overrides/isolates, zero-width space/no-break/word joiner/BOM.
// U+200D (zero-width joiner) is kept: emoji sequences need it.
const CHAT_STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const CHAT_SPACE = /[\t\n\r\u00A0\u2028\u2029\u3000 ]+/g;

// Returns { ok, text } or { ok: false, reason: "empty" | "too_long" | "malformed" }.
export function normalizeChatText(input) {
  if (typeof input !== "string") return { ok: false, reason: "malformed" };
  const text = input.normalize("NFC").replace(CHAT_STRIP, "").replace(CHAT_SPACE, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (Array.from(text).length > CHAT_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}
// Sanity bound only (campus is a few hundred metres); not anti-cheat.
export const MAX_ABS_COORDINATE = 100000;
export const MAX_ABS_VELOCITY = 1000;

export function isValidId(value) { return typeof value === "string" && ID.test(value); }
export function isValidPlaceZoneId(value) { return typeof value === "string" && PLACE_ZONE_ID.test(value); }

// Realtime topic for a semantic place zone, identical to PlaceZoneRegistry's
// futureRealtimeChannelKey. Only AREA_* place IDs; render chunk IDs are never a channel.
export const PLACE_ZONE_TOPIC = /^world:campus:AREA_[A-Z0-9_]{1,60}$/;
export function placeZoneTopic(placeZoneId) {
  const topic = `world:campus:${placeZoneId}`;
  if (!isValidPlaceZoneId(placeZoneId) || !PLACE_ZONE_TOPIC.test(topic)) throw new TypeError(`Invalid placeZoneId: ${placeZoneId}`);
  return topic;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isFiniteIn(value, limit) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}
function isSeq(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
const fail = (reason) => ({ ok: false, reason });

// A guest never chooses its name: every receiver derives it from the session id, so a guest
// cannot pose as a member nickname. e.g. "게스트 3F9A".
export function guestDisplayName(sessionId) {
  const tag = String(sessionId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
  return tag ? `게스트 ${tag}` : "게스트";
}

export function normalizeDisplayName(value) {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  return DISPLAY_NAME.test(name) ? name : DEFAULT_DISPLAY_NAME;
}

// Degrees in (-180, 180].
export function normalizeYaw(deg) {
  let yaw = deg % 360;
  if (yaw <= -180) yaw += 360;
  else if (yaw > 180) yaw -= 360;
  return yaw;
}

const clean = (value) => (Object.is(value, -0) ? 0 : value);
const q2 = (value) => clean(Math.round(value * 100) / 100);
const q1 = (value) => clean(Math.round(value * 10) / 10);

/**
 * Sanitizes a Presence `equipment` value. Only the nine known slots are read (a payload with
 * thousands of keys costs nine lookups); each entry keeps exactly { itemId, catalogStatus } and an
 * invalid entry is dropped on its own. Never throws, never rejects the presence: anything that is not
 * a plain object yields the frozen empty snapshot. Returns a frozen sparse object.
 */
export function sanitizeEquipment(raw) {
  if (!isPlainObject(raw)) return EMPTY_EQUIPMENT;
  let out = null;
  for (const slot of EQUIPMENT_WIRE_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(raw, slot)) continue;
    const entry = raw[slot];
    if (!isPlainObject(entry)) continue;
    const { itemId, catalogStatus } = entry;
    if (typeof itemId !== "string" || !EQUIPMENT_ITEM_ID.test(itemId)) continue;
    if (typeof catalogStatus !== "string" || !EQUIPMENT_STATUS_SET.has(catalogStatus)) continue;
    (out ??= {})[slot] = Object.freeze({ itemId, catalogStatus });
  }
  return out ? Object.freeze(out) : EMPTY_EQUIPMENT;
}

/** Canonical string of a sanitized equipment snapshot (slot order fixed): equal snapshots ⇔ equal keys. */
export function equipmentKey(equipment) {
  const clean = sanitizeEquipment(equipment);
  return EQUIPMENT_WIRE_SLOTS.filter((slot) => clean[slot]).map((slot) => `${slot}=${clean[slot].itemId}:${clean[slot].catalogStatus}`).join("|");
}

// Builds the presence packet from an identity using the allowlist only.
// Passing a full auth session here is safe: email, tokens and metadata are not copied.
// `equipment` is sanitized and omitted when empty; a guest presence never carries it.
export function buildPresence({ sessionId, userId, displayName, placeZoneId, joinedAt, guest = false, equipment = null }) {
  const presence = {
    v: PROTOCOL_VERSION,
    sessionId,
    userId,
    displayName: guest === true ? guestDisplayName(sessionId) : normalizeDisplayName(displayName),
    placeZoneId,
    joinedAt
  };
  if (guest === true) presence.guest = true;
  else {
    const clean = sanitizeEquipment(equipment);
    if (Object.keys(clean).length) presence.equipment = clean;
  }
  return presence;
}

export function validatePresence(packet) {
  if (!isPlainObject(packet)) return fail("malformed");
  if (packet.v !== PROTOCOL_VERSION) return fail("unsupported_version");
  if (!isValidId(packet.sessionId) || !isValidId(packet.userId)) return fail("malformed");
  if (!isValidPlaceZoneId(packet.placeZoneId)) return fail("malformed");
  if (!Number.isSafeInteger(packet.joinedAt) || packet.joinedAt < 0) return fail("malformed");
  return { ok: true, presence: buildPresence(packet) };
}

export function encodePose(seq, { x, y, z, yaw, vx = 0, vz = 0, anim, mount = null }) {
  const packet = {
    v: PROTOCOL_VERSION,
    seq,
    x: q2(x), y: q2(y), z: q2(z),
    yaw: q1(normalizeYaw(yaw)),
    vx: q2(vx), vz: q2(vz),
    anim
  };
  if (anim === Anim.FLY && isValidMount(mount)) packet.mount = mount;
  return packet;
}

export function validatePose(packet) {
  if (!isPlainObject(packet)) return fail("malformed");
  if (packet.v !== PROTOCOL_VERSION) return fail("unsupported_version");
  if (!isSeq(packet.seq)) return fail("malformed");
  for (const key of ["x", "y", "z", "yaw"]) {
    if (!(key in packet)) return fail("missing_field");
    if (!isFiniteIn(packet[key], MAX_ABS_COORDINATE)) return fail("non_finite");
  }
  for (const key of ["vx", "vz"]) {
    if (!(key in packet)) return fail("missing_field");
    if (!isFiniteIn(packet[key], MAX_ABS_VELOCITY)) return fail("non_finite");
  }
  if (!ANIM_VALUES.has(packet.anim)) return fail("malformed");
  const pose = {
    v: packet.v, seq: packet.seq,
    x: packet.x, y: packet.y, z: packet.z,
    yaw: normalizeYaw(packet.yaw), vx: packet.vx, vz: packet.vz,
    anim: packet.anim
  };
  // Tolerant: an unknown or misplaced mount never rejects the pose; mountOf() applies the fallback.
  if (packet.anim === Anim.FLY && isValidMount(packet.mount)) pose.mount = packet.mount;
  return { ok: true, pose };
}

function validateActionPayload(type, payload) {
  if (!isPlainObject(payload)) return null;
  if (type === ActionType.JUMP) return {};
  if (type === ActionType.TELEPORT) {
    for (const key of ["x", "y", "z", "yaw"]) if (!isFiniteIn(payload[key], MAX_ABS_COORDINATE)) return null;
    if (!isSeq(payload.poseSeq)) return null;
    return { x: payload.x, y: payload.y, z: payload.z, yaw: normalizeYaw(payload.yaw), poseSeq: payload.poseSeq };
  }
  if (type === ActionType.CHAT) {
    const chat = normalizeChatText(payload.text);
    // Only already-normalized text is accepted: receivers never re-shape what the sender sent.
    if (!chat.ok || chat.text !== payload.text) return null;
    for (const key of ["x", "y", "z"]) if (!isFiniteIn(payload[key], MAX_ABS_COORDINATE)) return null;
    return { text: chat.text, x: payload.x, y: payload.y, z: payload.z };
  }
  if (type === ActionType.EMOTE) {
    return isValidEmoteId(payload.emote) ? { emote: payload.emote } : null;
  }
  return null;
}

export function encodeAction(id, type, payload = {}) {
  const normalized = type === ActionType.TELEPORT
    ? { x: q2(payload.x), y: q2(payload.y), z: q2(payload.z), yaw: q1(normalizeYaw(payload.yaw)), poseSeq: payload.poseSeq }
    : type === ActionType.CHAT
      ? { text: payload.text, x: q2(payload.x), y: q2(payload.y), z: q2(payload.z) }
      : payload;
  return { v: PROTOCOL_VERSION, id, type, payload: normalized };
}

export function validateAction(packet) {
  if (!isPlainObject(packet)) return fail("malformed");
  if (packet.v !== PROTOCOL_VERSION) return fail("unsupported_version");
  if (!isSeq(packet.id)) return fail("malformed");
  if (!ACTION_VALUES.has(packet.type)) return fail("unknown_action");
  const payload = validateActionPayload(packet.type, packet.payload ?? {});
  if (!payload) return fail("malformed");
  return { ok: true, action: { v: packet.v, id: packet.id, type: packet.type, payload } };
}

// Local controller flags → network anim. The world adapter derives `sprint`
// (PlayerController does not expose it) from horizontal speed above walk speed.
export function classifyAnim({ moving = false, sprint = false, grounded = true, mounted = false, seated = false }) {
  if (seated) return Anim.SIT;
  if (mounted) return Anim.FLY;
  if (!grounded) return Anim.AIR;
  if (!moving) return Anim.IDLE;
  return sprint ? Anim.RUN : Anim.WALK;
}
