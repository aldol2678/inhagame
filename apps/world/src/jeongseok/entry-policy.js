// Jeongseok public lobby and protected inner-area policy (engine-free).
//
// The public lobby never needs an account or grant. Only an explicit CLOSED deployment mode
// closes its outer door. SERVER_GRANT protects the inner lobby and B1: a fresh account-bound
// snapshot gives one short crossing window, then a stay bounded by server pass expiry/rechecks.
// These are local scene guards, not authoritative server position or multiplayer-room checks.

export const JEONGSEOK_ENTRY_MODE = Object.freeze({
  CLOSED: "CLOSED_PENDING_JSL_A",
  VISUAL_PREVIEW: "VISUAL_PREVIEW_LOCAL_ONLY",
  SERVER_GRANT: "SERVER_GRANT_JSL_A"
});
export const JEONGSEOK_LOBBY_POLICY_KEY = "jeongseok-public-lobby";
export const JEONGSEOK_ACCESS_POLICY_KEY = "jeongseok-policy";
export const JEONGSEOK_GRANT_TTL_MS = 15_000;

const MODES = new Set(Object.values(JEONGSEOK_ENTRY_MODE));

// Local expiry of a server pass: server expiry minus the server/device skew of that snapshot.
function localAccessExpiry(snapshot) {
  if (snapshot?.via !== "VISITOR_PASS") return null;
  const end = Date.parse(snapshot?.pass?.expiresAt ?? "");
  const skew = Number(snapshot?.clockOffsetMs);
  return Number.isFinite(end) ? end - (Number.isFinite(skew) ? skew : 0) : Number.NaN;
}

// This receives browser location.hostname, not a URL or host:port. Browsers normalize
// DNS casing and bracket IPv6 hosts. Only these exact loopback hostnames may bypass
// the inner policy for visual QA; shared/public deployment aliases are never previews.
export function isJeongseokVisualPreviewHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resolveJeongseokEntryMode({ previewHost = false, params = new URLSearchParams(), serverAccessAvailable = false } = {}) {
  if (previewHost === true && params.get("jeongseok") === "jsl-b") return JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
  if (serverAccessAvailable) return JEONGSEOK_ENTRY_MODE.SERVER_GRANT;
  return JEONGSEOK_ENTRY_MODE.CLOSED;
}

export function createJeongseokEntryPolicy({ mode = JEONGSEOK_ENTRY_MODE.CLOSED, clock = { now: () => Date.now() },
  grantTtlMs = JEONGSEOK_GRANT_TTL_MS } = {}) {
  if (!MODES.has(mode)) throw new RangeError(`Unknown Jeongseok entry mode ${mode}`);
  let accountId = null;
  let grant = null;   // one pending entry: { accountId, notAfter, accessExpiresAt }
  let session = null; // inside: { accountId, accessExpiresAt }
  let lastRevocation = null;

  const server = () => mode === JEONGSEOK_ENTRY_MODE.SERVER_GRANT;
  const notExpired = (expiresAt, now) => expiresAt === null || (Number.isFinite(expiresAt) && now < expiresAt);

  function allowsEntry() {
    if (mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW) return true;
    if (!server() || !grant || !accountId) return false;
    const now = clock.now();
    return grant.accountId === accountId && now <= grant.notAfter && notExpired(grant.accessExpiresAt, now);
  }
  function allowsStay() {
    if (mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW) return true;
    if (!server() || !session || !accountId) return false;
    return session.accountId === accountId && notExpired(session.accessExpiresAt, clock.now()) &&
      (session.crossed || clock.now() <= session.notAfter);
  }

  return {
    get mode() { return mode; },
    get serverProtected() { return server(); },
    allowsLobby: () => mode !== JEONGSEOK_ENTRY_MODE.CLOSED,
    allowsEntry,
    allowsStay,
    allowsProtectedRoom: () => allowsStay() && (mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW || session?.crossed === true),
    setAccount(next) {
      const id = typeof next === "string" && next ? next : null;
      if (id === accountId) return false;
      accountId = id; grant = null;
      if (session) { session = null; lastRevocation = "ACCOUNT_CHANGED"; }
      return true;
    },
    /** JSL-A onEnter hand-off: only a fresh GRANTED snapshot for the current account counts. */
    acceptServerGrant(snapshot) {
      if (!server() || !accountId || snapshot?.granted !== true || snapshot.decision !== "GRANTED" || !["INHA_MAIL", "VISITOR_PASS"].includes(snapshot.via) || snapshot.userId !== accountId) return false;
      const accessExpiresAt = localAccessExpiry(snapshot);
      if (accessExpiresAt !== null && !(accessExpiresAt > clock.now())) return false;
      grant = { accountId, notAfter: clock.now() + grantTtlMs, accessExpiresAt };
      return true;
    },
    /** Consume one fresh grant at the inner reader; walking across completes the crossing. */
    commitEntry() {
      if (!server()) return mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      if (!allowsEntry()) { grant = null; return false; }
      session = { accountId: grant.accountId, accessExpiresAt: grant.accessExpiresAt, notAfter: grant.notAfter, crossed: false };
      grant = null;
      return true;
    },
    confirmCrossing() { if (!allowsStay()) return false; if (session) session.crossed = true; return true; },
    discardGrant() { grant = null; },
    /** Fresh server re-read while inside (expiry tick, resume, focus). Returns true when the stay continues. */
    revalidate(snapshot) {
      if (!server()) return mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      if (!session) return false;
      if (snapshot?.granted !== true || snapshot.decision !== "GRANTED" || !["INHA_MAIL", "VISITOR_PASS"].includes(snapshot.via) || snapshot.userId !== session.accountId || session.accountId !== accountId) {
        session = null; lastRevocation = snapshot ? `SERVER_${snapshot.decision ?? "UNKNOWN"}` : "SERVER_UNKNOWN";
        return false;
      }
      session.accessExpiresAt = localAccessExpiry(snapshot);
      if (!notExpired(session.accessExpiresAt, clock.now())) { session = null; lastRevocation = "EXPIRED"; return false; }
      return true;
    },
    endSession(reason = "LEFT") { if (session) lastRevocation = reason; session = null; grant = null; },
    status: () => Object.freeze({ mode, serverProtected: server(), accountBound: accountId !== null,
      pendingGrant: grant !== null, session: session !== null, crossed: session?.crossed === true,
      accessExpiresAt: session?.accessExpiresAt ?? null, lastRevocation })
  };
}
