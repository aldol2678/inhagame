// JSL-B · Jeongseok interior entry policy (engine-free).
//
// The interior never decides who may enter. Modes:
//   CLOSED_PENDING_JSL_A       default everywhere. No door action, no transition, no stay.
//   VISUAL_PREVIEW_LOCAL_ONLY  preview hosts with an explicit QA flag only. Local blockout review;
//                              it is NOT server-protected access and must never be reported as such.
//   SERVER_GRANT_JSL_A         contract for the JSL-A gate (PR #358): its controller calls onEnter
//                              only with a fresh server snapshot (get_jeongseok_access_v1). One
//                              short-lived grant opens one entry for the same account; the stay ends
//                              when the account changes, the pass expires or a re-read is not GRANTED.
// The gate animation (green light, flaps) is presentation and never reaches this module.
// Interiors are local-only scenes without a Room/Realtime channel, so there is no server room
// join, invite, resume or channel to bypass; when one is added, it must re-check the server.

export const JEONGSEOK_ENTRY_MODE = Object.freeze({
  CLOSED: "CLOSED_PENDING_JSL_A",
  VISUAL_PREVIEW: "VISUAL_PREVIEW_LOCAL_ONLY",
  SERVER_GRANT: "SERVER_GRANT_JSL_A"
});
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

export function resolveJeongseokEntryMode({ previewHost = false, params = new URLSearchParams(), serverAccessAvailable = false } = {}) {
  if (serverAccessAvailable) return JEONGSEOK_ENTRY_MODE.SERVER_GRANT;
  if (previewHost === true && params.get("jeongseok") === "jsl-b") return JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
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
    return session.accountId === accountId && notExpired(session.accessExpiresAt, clock.now());
  }

  return {
    get mode() { return mode; },
    get serverProtected() { return server(); },
    /** Room-transition access predicate: campus entry needs a grant, moves inside need a valid stay. */
    predicate: (entrance, _room) => entrance ? allowsEntry() : allowsStay(),
    allowsEntry,
    allowsStay,
    setAccount(next) {
      const id = typeof next === "string" && next ? next : null;
      if (id === accountId) return false;
      accountId = id; grant = null;
      if (session) { session = null; lastRevocation = "ACCOUNT_CHANGED"; }
      return true;
    },
    /** JSL-A onEnter hand-off: only a fresh GRANTED snapshot for the current account counts. */
    acceptServerGrant(snapshot) {
      if (!server() || !accountId || snapshot?.granted !== true || snapshot.decision !== "GRANTED" || snapshot.userId !== accountId) return false;
      const accessExpiresAt = localAccessExpiry(snapshot);
      if (accessExpiresAt !== null && !(accessExpiresAt > clock.now())) return false;
      grant = { accountId, notAfter: clock.now() + grantTtlMs, accessExpiresAt };
      return true;
    },
    /** Called once the campus → lobby transition commits. A grant opens exactly one entry. */
    commitEntry() {
      if (!server()) return mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      if (!grant) return false;
      session = { accountId: grant.accountId, accessExpiresAt: grant.accessExpiresAt };
      grant = null;
      return true;
    },
    discardGrant() { grant = null; },
    /** Fresh server re-read while inside (expiry tick, resume, focus). Returns true when the stay continues. */
    revalidate(snapshot) {
      if (!server()) return mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      if (!session) return false;
      if (snapshot?.granted !== true || snapshot.userId !== session.accountId || session.accountId !== accountId) {
        session = null; lastRevocation = snapshot ? `SERVER_${snapshot.decision ?? "UNKNOWN"}` : "SERVER_UNKNOWN";
        return false;
      }
      session.accessExpiresAt = localAccessExpiry(snapshot);
      if (!notExpired(session.accessExpiresAt, clock.now())) { session = null; lastRevocation = "EXPIRED"; return false; }
      return true;
    },
    endSession(reason = "LEFT") { if (session) lastRevocation = reason; session = null; grant = null; },
    status: () => Object.freeze({ mode, serverProtected: server(), accountBound: accountId !== null,
      pendingGrant: grant !== null, session: session !== null,
      accessExpiresAt: session?.accessExpiresAt ?? null, lastRevocation })
  };
}
