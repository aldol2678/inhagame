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
    this.accountId = isUuid(getSelfUserId?.()) ? getSelfUserId() : null;
    this.accountExplicit = false;
    this.generation = 0;
  }

  #replaceAccount(next) {
    if (next === this.accountId) return false;
    this.accountId = next;
    this.generation += 1;
    this.inFlight.clear();
    return true;
  }

  // Auth callbacks are authoritative, especially while the transport getter still
  // exposes the old session during logout. Same-account reconnect is a no-op.
  setAccount(userId) {
    this.accountExplicit = true;
    return this.#replaceAccount(isUuid(userId) ? userId : null);
  }

  #syncAccount() {
    if (!this.accountExplicit) {
      const userId = this.getSelfUserId?.();
      this.#replaceAccount(isUuid(userId) ? userId : null);
    }
    return this.accountId;
  }

  get available() {
    const accountId = this.#syncAccount();
    return !!accountId && !!this.getClient?.() && this.getSelfUserId?.() === accountId;
  }

  #owner() {
    const accountId = this.#syncAccount();
    if (!accountId) throw new GuestbookError("SIGNED_OUT");
    return { accountId, generation: this.generation };
  }

  #assertCurrent(owner) {
    if (this.#syncAccount() !== owner.accountId || this.generation !== owner.generation ||
        this.getSelfUserId?.() !== owner.accountId) throw new GuestbookError("STALE");
  }

  async #rpc(name, args, owner) {
    const client = this.getClient?.();
    this.#assertCurrent(owner);
    if (!client) throw new GuestbookError("SIGNED_OUT");
    try {
      const { data, error } = await client.rpc(name, args);
      this.#assertCurrent(owner);
      if (error) {
        const code = String(error.message ?? "").trim();
        throw new GuestbookError(KNOWN_ERRORS.has(code) ? code : "FAILED");
      }
      return data;
    } catch (error) {
      this.#assertCurrent(owner); // stale failures are not errors for the new account
      throw error instanceof GuestbookError ? error : new GuestbookError("FAILED");
    }
  }

  #once(key, run) {
    let owner;
    try { owner = this.#owner(); }
    catch (error) { return Promise.reject(error); }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    // Reserve the slot before invoking RPC code, which may reenter an auth reset.
    // Never replay a write after an account change or a transport failure.
    const promise = Promise.resolve().then(() => {
      this.#assertCurrent(owner);
      return run(owner);
    }).finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  async load({ before = null, limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const owner = this.#owner();
    const data = await this.#rpc("get_world_guestbook_v2", {
      p_location_key: GUESTBOOK_LOCATION,
      p_limit: safeLimit,
      p_before: typeof before === "string" ? before : null
    }, owner);
    this.#assertCurrent(owner);
    const board = parseGuestbookBoard(data);
    if (board.entries.some(entry => entry.mine && entry.userId !== owner.accountId)) throw new GuestbookError("FAILED");
    return board;
  }

  create(content) {
    const trimmed = typeof content === "string" ? content.trim() : "";
    if (trimmed.length < 1 || trimmed.length > 150) {
      return Promise.reject(new GuestbookError("INVALID_CONTENT"));
    }
    return this.#once("create", async (owner) => {
      const data = await this.#rpc("create_world_guestbook_entry_v2", {
        p_content: trimmed,
        p_location_key: GUESTBOOK_LOCATION
      }, owner);
      this.#assertCurrent(owner);
      const entry = parseGuestbookEntry(data);
      if (!entry || !entry.mine || entry.userId !== owner.accountId) throw new GuestbookError("FAILED");
      return entry;
    });
  }

  update(entryId, content) {
    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!isUuid(entryId)) return Promise.reject(new GuestbookError("ENTRY_UNAVAILABLE"));
    if (trimmed.length < 1 || trimmed.length > 150) {
      return Promise.reject(new GuestbookError("INVALID_CONTENT"));
    }
    return this.#once(`update:${entryId}`, async (owner) => {
      const data = await this.#rpc("update_world_guestbook_entry_v2", {
        p_entry_id: entryId,
        p_content: trimmed
      }, owner);
      this.#assertCurrent(owner);
      const entry = parseGuestbookEntry(data);
      if (!entry || !entry.mine || entry.userId !== owner.accountId || entry.id !== entryId) throw new GuestbookError("FAILED");
      return entry;
    });
  }

  remove(entryId) {
    if (!isUuid(entryId)) return Promise.reject(new GuestbookError("ENTRY_UNAVAILABLE"));
    return this.#once(`delete:${entryId}`, async (owner) => {
      const data = await this.#rpc("delete_world_guestbook_entry_v2", { p_entry_id: entryId }, owner);
      this.#assertCurrent(owner);
      return data === true;
    });
  }
}
