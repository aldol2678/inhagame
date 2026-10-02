// Social S1-C1 client: thin, validated wrapper over the World social RPCs (migration
// 20260926030000). The database is authoritative; this layer never decides relationships.
//
// Identity rule: every operation targets a user id taken from the trusted Presence/RemotePlayer
// model. Nicknames, DOM text and chat text are display only and are never accepted as targets.
// (Presence ids are still client-declared; a modified peer could misreport its id. The caller
// is always auth.uid() on the server, so nobody can act *as* someone else.)

export const Relationship = Object.freeze({
  NONE: "none",
  OUTGOING: "outgoing",
  INCOMING: "incoming",
  FRIENDS: "friends",
  BLOCKED_BY_ME: "blocked_by_me",
  UNAVAILABLE: "unavailable"
});
const RELATIONSHIPS = new Set(Object.values(Relationship));

export const REPORT_CATEGORIES = Object.freeze(["spam", "harassment", "inappropriate_name", "other"]);
export const AVATARS = Object.freeze({ classic: "🦆", scholar: "🎓", explorer: "🧭", star: "⭐" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_ZONE = /^AREA_[A-Z0-9_]{1,60}$/;
const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

export const isUserId = (value) => typeof value === "string" && UUID.test(value);

// Only the allowlisted public card fields survive; anything else the server might send is dropped.
export function parseCard(raw) {
  if (!raw || typeof raw !== "object" || !isUserId(raw.userId)) return null;
  const relationship = RELATIONSHIPS.has(raw.relationship) ? raw.relationship : Relationship.NONE;
  if (raw.available === false || relationship === Relationship.UNAVAILABLE) {
    return { userId: raw.userId, available: false, relationship: Relationship.UNAVAILABLE, nickname: null, title: null, avatar: "classic", inhaVerified: false };
  }
  return {
    userId: raw.userId,
    available: true,
    relationship,
    nickname: clip(raw.nickname, 12),
    title: clip(raw.title, 40),
    avatar: Object.hasOwn(AVATARS, raw.avatar) ? raw.avatar : "classic",
    inhaVerified: raw.inhaVerified === true
  };
}

function parseList(list) {
  return Array.isArray(list) ? list.map((item) => parseCard({ ...item, available: true, relationship: Relationship.NONE })).filter(Boolean) : [];
}

export function parseSocial(raw) {
  return {
    friends: parseList(raw?.friends),
    incoming: parseList(raw?.incoming),
    outgoing: parseList(raw?.outgoing),
    blocked: parseList(raw?.blocked)
  };
}

const parseState = (raw) => (RELATIONSHIPS.has(raw?.relationship) ? raw.relationship : null);

export class SocialError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Server error codes the UI may show; anything else becomes a generic failure.
const KNOWN_ERRORS = new Set(["NOT_ALLOWED", "TARGET_UNAVAILABLE", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE",
  "RATE_LIMITED", "CANNOT_REPORT_SELF", "INVALID_CATEGORY", "INVALID_PLACE_ZONE", "SOCIAL_RESTRICTED"]);

export class SocialClient {
  constructor({ getClient, getSelfUserId }) {
    this.getClient = getClient;
    this.getSelfUserId = getSelfUserId;
    this.inFlight = new Map();
    this.blocked = new Set(); // users *I* blocked (never who blocked me)
    this.listeners = new Set();
    // Last database-confirmed relationship per user (S1-C2 Follow gate). Never persisted.
    this.relationships = new Map();
    this.relationshipListeners = new Set();
  }

  onRelationshipChange(handler) {
    this.relationshipListeners.add(handler);
    return () => this.relationshipListeners.delete(handler);
  }

  #setRelationship(userId, state) {
    const previous = this.relationships.get(userId) ?? null;
    if (state === null) this.relationships.delete(userId); else this.relationships.set(userId, state);
    if (previous !== state) for (const listener of this.relationshipListeners) {
      try { listener(userId, state); } catch { /* a broken listener never breaks the client */ }
    }
  }

  relationshipOf(userId) { return this.relationships.get(userId) ?? null; }

  // Signed out: forget every cached relationship (listeners see them go).
  reset() {
    for (const id of [...this.blocked]) this.#setBlocked(id, false);
    for (const id of [...this.relationships.keys()]) this.#setRelationship(id, null);
  }

  onBlockedChange(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #setBlocked(userId, blocked) {
    const had = this.blocked.has(userId);
    if (blocked) this.blocked.add(userId); else this.blocked.delete(userId);
    if (had !== blocked) for (const listener of this.listeners) {
      try { listener(userId, blocked); } catch { /* UI never breaks social state */ }
    }
  }

  isBlocked(userId) { return this.blocked.has(userId); }

  get available() { return !!this.getClient() && isUserId(this.getSelfUserId()); }

  async #rpc(name, args) {
    const client = this.getClient();
    if (!client || !isUserId(this.getSelfUserId())) throw new SocialError("SIGNED_OUT");
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const code = String(error.message ?? "").trim();
      throw new SocialError(KNOWN_ERRORS.has(code) ? code : "FAILED");
    }
    return data;
  }

  // Double clicks and retries of the same operation share one request.
  #once(key, run) {
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = run().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  #target(userId) {
    if (!isUserId(userId)) throw new SocialError("TARGET_UNAVAILABLE");
    if (userId === this.getSelfUserId()) throw new SocialError("TARGET_UNAVAILABLE");
    return userId;
  }

  async profile(userId) {
    const target = this.#target(userId);
    const card = parseCard(await this.#rpc("get_world_public_profile", { p_target: target }));
    if (!card || card.userId !== target) throw new SocialError("FAILED");
    if (card.relationship === Relationship.BLOCKED_BY_ME) this.#setBlocked(target, true);
    this.#setRelationship(target, card.relationship);
    return card;
  }

  // Current relationship straight from the database (Follow's periodic re-check).
  async relationship(userId) {
    const target = this.#target(userId);
    const state = parseState(await this.#rpc("get_world_relationship", { p_target: target }));
    if (!state) throw new SocialError("FAILED");
    this.#setRelationship(target, state);
    return state;
  }

  async #mutation(op, rpc, userId, extra = {}) {
    const target = this.#target(userId);
    return this.#once(`${op}:${target}`, async () => {
      const state = parseState(await this.#rpc(rpc, { p_target: target, ...extra }));
      if (!state) throw new SocialError("FAILED");
      this.#setBlocked(target, state === Relationship.BLOCKED_BY_ME);
      this.#setRelationship(target, state);
      return state;
    });
  }

  request(userId) { return this.#mutation("request", "send_world_friend_request", userId); }
  accept(userId) { return this.#mutation("accept", "respond_world_friend_request", userId, { p_accept: true }); }
  reject(userId) { return this.#mutation("reject", "respond_world_friend_request", userId, { p_accept: false }); }
  cancel(userId) { return this.#mutation("cancel", "cancel_world_friend_request", userId); }
  remove(userId) { return this.#mutation("remove", "remove_world_friend", userId); }
  block(userId) { return this.#mutation("block", "block_world_user", userId); }
  unblock(userId) { return this.#mutation("unblock", "unblock_world_user", userId); }

  async mine() {
    const social = parseSocial(await this.#rpc("get_my_world_social", {}));
    const blocked = new Set(social.blocked.map((b) => b.userId));
    for (const id of [...this.blocked]) if (!blocked.has(id)) this.#setBlocked(id, false);
    for (const id of blocked) this.#setBlocked(id, true);
    // My lists are authoritative for friends and requests: anything no longer listed is NONE.
    const listed = new Map();
    for (const person of social.friends) listed.set(person.userId, Relationship.FRIENDS);
    for (const person of social.incoming) listed.set(person.userId, Relationship.INCOMING);
    for (const person of social.outgoing) listed.set(person.userId, Relationship.OUTGOING);
    for (const person of social.blocked) listed.set(person.userId, Relationship.BLOCKED_BY_ME);
    for (const [id, state] of [...this.relationships]) {
      if (!listed.has(id) && state !== Relationship.UNAVAILABLE) this.#setRelationship(id, Relationship.NONE);
    }
    for (const [id, state] of listed) this.#setRelationship(id, state);
    return social;
  }

  // Structured only: target id, category from the allowlist, semantic zone. Never chat text.
  async report(userId, category, placeZoneId = null) {
    const target = this.#target(userId);
    if (!REPORT_CATEGORIES.includes(category)) throw new SocialError("INVALID_CATEGORY");
    const zone = PLACE_ZONE.test(placeZoneId ?? "") ? placeZoneId : null;
    return this.#once(`report:${target}:${category}`, async () => {
      const data = await this.#rpc("report_world_user", { p_target: target, p_category: category, p_place_zone_id: zone });
      return data?.status === "duplicate" ? "duplicate" : "received";
    });
  }
}
