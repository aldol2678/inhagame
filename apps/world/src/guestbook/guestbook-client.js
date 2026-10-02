// Main-gate guestbook P1 client.
// Writes go through rate-limited RPCs only; browser code never writes the table directly.

export const GUESTBOOK_LOCATION = "main_gate";
export const GUESTBOOK_DAILY_LIMIT = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATARS = new Set(["classic", "scholar", "explorer", "star"]);
const KNOWN_ERRORS = new Set([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "INVALID_LOCATION",
  "INVALID_CONTENT", "ENTRY_UNAVAILABLE", "DAILY_LIMIT_REACHED", "GUESTBOOK_COOLDOWN", "SOCIAL_RESTRICTED"
]);

export class GuestbookError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const clip = (value, max) => typeof value === "string" ? value.slice(0, max) : null;
const isUuid = (value) => typeof value === "string" && UUID.test(value);

export function parseGuestbookEntry(raw) {
  if (!raw || typeof raw !== "object" || !isUuid(raw.id) || !isUuid(raw.userId)) return null;
  if (typeof raw.content !== "string" || raw.content.length < 1 || raw.content.length > 150) return null;
  return Object.freeze({
    id: raw.id,
    userId: raw.userId,
    nickname: clip(raw.nickname, 12) ?? "인덕이",
    avatar: AVATARS.has(raw.avatar) ? raw.avatar : "classic",
    inhaVerified: raw.inhaVerified === true,
    content: raw.content,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    mine: raw.mine === true
  });
}

export function parseGuestbookBoard(raw) {
  if (!raw || typeof raw !== "object" || raw.locationKey !== GUESTBOOK_LOCATION) {
    throw new GuestbookError("FAILED");
  }
  const entries = Array.isArray(raw.entries) ? raw.entries.map(parseGuestbookEntry).filter(Boolean) : [];
  const dailyLimit = Number.isInteger(raw.dailyLimit) ? raw.dailyLimit : GUESTBOOK_DAILY_LIMIT;
  const dailyUsed = Number.isInteger(raw.dailyUsed) ? Math.max(0, raw.dailyUsed) : 0;
  return Object.freeze({
    locationKey: GUESTBOOK_LOCATION,
    entries: Object.freeze(entries),
    hasMore: raw.hasMore === true,
    nextBefore: typeof raw.nextBefore === "string" ? raw.nextBefore : null,
    dailyLimit,
    dailyUsed,
    dailyRemaining: Number.isInteger(raw.dailyRemaining)
      ? Math.max(0, raw.dailyRemaining)
      : Math.max(0, dailyLimit - dailyUsed),
    cooldownRemainingSeconds: Number.isInteger(raw.cooldownRemainingSeconds)
      ? Math.max(0, raw.cooldownRemainingSeconds)
      : 0
  });
}

export class GuestbookClient {
  constructor({ getClient, getSelfUserId }) {
    this.getClient = getClient;
    this.getSelfUserId = getSelfUserId;
    this.inFlight = new Map();
  }

  get available() {
    return !!this.getClient?.() && isUuid(this.getSelfUserId?.());
  }

  async #rpc(name, args) {
    const client = this.getClient?.();
    if (!client || !isUuid(this.getSelfUserId?.())) throw new GuestbookError("SIGNED_OUT");
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const code = String(error.message ?? "").trim();
      throw new GuestbookError(KNOWN_ERRORS.has(code) ? code : "FAILED");
    }
    return data;
  }

  #once(key, run) {
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = run().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async load({ before = null, limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    return parseGuestbookBoard(await this.#rpc("get_world_guestbook_v2", {
      p_location_key: GUESTBOOK_LOCATION,
      p_limit: safeLimit,
      p_before: typeof before === "string" ? before : null
    }));
  }

  create(content) {
    const trimmed = typeof content === "string" ? content.trim() : "";
    if (trimmed.length < 1 || trimmed.length > 150) {
      return Promise.reject(new GuestbookError("INVALID_CONTENT"));
    }
    return this.#once("create", async () => {
      const data = await this.#rpc("create_world_guestbook_entry_v2", {
        p_content: trimmed,
        p_location_key: GUESTBOOK_LOCATION
      });
      const entry = parseGuestbookEntry(data);
      if (!entry || !entry.mine) throw new GuestbookError("FAILED");
      return entry;
    });
  }

  update(entryId, content) {
    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!isUuid(entryId)) return Promise.reject(new GuestbookError("ENTRY_UNAVAILABLE"));
    if (trimmed.length < 1 || trimmed.length > 150) {
      return Promise.reject(new GuestbookError("INVALID_CONTENT"));
    }
    return this.#once(`update:${entryId}`, async () => {
      const data = await this.#rpc("update_world_guestbook_entry_v2", {
        p_entry_id: entryId,
        p_content: trimmed
      });
      const entry = parseGuestbookEntry(data);
      if (!entry || !entry.mine || entry.id !== entryId) throw new GuestbookError("FAILED");
      return entry;
    });
  }

  remove(entryId) {
    if (!isUuid(entryId)) return Promise.reject(new GuestbookError("ENTRY_UNAVAILABLE"));
    return this.#once(`delete:${entryId}`, async () => {
      const data = await this.#rpc("delete_world_guestbook_entry_v2", { p_entry_id: entryId });
      return data === true;
    });
  }
}
