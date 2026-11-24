import { readGuestSessionId } from "../activity/session-id.js";

// AUTH (migrated 2026-11-20, Tier 4 guest-open — A-3): both paths authenticate with the v0.1
// guest session id in the `X-Session-Id` header only — no other credential header is sent.
// The id is read lazily by readGuestSessionId() (the single source; null when absent — never
// fabricated). Read: GET /api/world-biryong-progress (null when the cloud copy does not exist
// yet). Merge: POST /api/world-biryong-progress { progress, migratedFromLocal }. The server
// answers 200 + the merged progress, or an HTTP status with { error: <server refusal code> }.
// Before: the controller called run.client.rpc() on the signed-in permanent-account client
// (get_my_biryong_progress_v1 / merge_my_biryong_progress_v1). That path is gone; only the
// transport changed — the debounce, generation guard, retry and merge rules are unchanged.
// The account bound by setAccount IS the guest session id.
export const BIRYONG_PROGRESS_API_PATH = "/api/world-biryong-progress";

// Biryong's local cache stays authoritative for unsent changes. The existing
// monotonic server merge RPC owns the cloud copy; this controller only schedules it.
export function createBiryongCloudSync({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = BIRYONG_PROGRESS_API_PATH,
  progress,
  onStatus = () => {},
  onAccountSyncing = () => {},
  onSettled = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = 250
} = {}) {
  let generation = 0;
  let session = null;
  let timer = null;
  let active = false;
  let disposed = false;

  const current = run => !disposed && run === session && run.generation === generation;
  const status = () => Object.freeze({
    state: session?.state ?? 'idle',
    dirty: session?.dirty ?? false,
    canRetry: session?.state === 'failed'
  });
  const publish = () => onStatus(status());
  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    // One bounded coalescing window, rather than a trailing debounce that a
    // continuous stream of progress can postpone indefinitely.
    if (disposed || !session?.dirty || session.state === 'failed' || active || timer !== null) return;
    timer = setTimer(() => { timer = null; void flush(); }, debounceMs);
  }
  async function rpc(run, name, args) {
    let sessionId = null;
    try { sessionId = await getSessionId?.() ?? null; } catch { sessionId = null; }
    if (!sessionId) throw new Error("SIGNED_OUT");
    const isRead = name === 'get_my_biryong_progress_v1';
    const response = await fetcher(endpoint, isRead
      ? { headers: { "X-Session-Id": sessionId } }
      : { method: "POST", headers: { "Content-Type": "application/json", "X-Session-Id": sessionId }, body: JSON.stringify({ progress: args?.p_progress ?? null, migratedFromLocal: args?.p_migrated_from_local ?? false }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.error === "string" && data.error ? data.error : `HTTP_${response.status}`);
    return data ?? null;
  }
  async function flush() {
    if (disposed || active || !session?.dirty || session.state === 'failed') return;
    const run = session;
    const reconcileInitial = run.needsRead;
    active = true;
    run.state = 'saving';
    publish();
    try {
      if (run.needsRead) {
        const remote = await rpc(run, 'get_my_biryong_progress_v1');
        if (!current(run)) return;
        if (remote) progress.merge(remote, { notify: false });
        run.needsRead = false;
        run.latest = progress.snapshot();
      }
      if (!current(run)) return;
      const revision = run.revision;
      const merged = await rpc(run, 'merge_my_biryong_progress_v1', {
        p_progress: run.latest,
        p_migrated_from_local: run.migrated
      });
      if (!current(run)) return;
      // Ordinary saves historically only acknowledged the local snapshot. Do
      // not run reload normalization over a live REACTION dialogue phase, or
      // overwrite progress made while the initial merge was in flight.
      if (merged && reconcileInitial && run.revision === revision) progress.merge(merged, { notify: false });
      run.migrated = false;
      run.latest = progress.snapshot();
      run.dirty = run.revision !== revision;
      run.state = run.dirty ? 'pending' : 'saved';
    } catch {
      if (!current(run)) return;
      // Keep the latest local snapshot and require an explicit retry. More
      // gameplay while offline updates that snapshot without a request storm.
      run.state = 'failed';
      run.dirty = true;
    } finally {
      active = false;
      if (current(run)) {
        onAccountSyncing(false);
        onSettled();
        publish();
        schedule();
      } else if (!disposed && session?.dirty && session.state !== 'failed') {
        // A new account never shares the previous generation's request/result.
        // Keep the transport serialized even across A -> B -> A switches.
        void flush();
      }
    }
  }
  function setAccount(userId) {
    if (disposed) return false;
    const next = userId ? userId : null;
    if (next === (session?.userId ?? null)) return false;
    generation += 1;
    cancelTimer();
    if (!next) {
      session = null;
      progress.setScope('guest');
      onAccountSyncing(false);
      onSettled();
      publish();
      return true;
    }
    onAccountSyncing(true);
    const scope = progress.setScope(`account:${next}`, { adoptLegacy: true });
    session = { generation, userId: next, needsRead: true,
      migrated: Boolean(scope?.migrated), latest: progress.snapshot(), revision: 0, dirty: true, state: 'pending' };
    publish();
    void flush();
    return true;
  }
  function queue(snapshot) {
    if (disposed || !session || !snapshot) return false;
    session.latest = snapshot;
    session.revision += 1;
    session.dirty = true;
    if (session.state !== 'failed' && session.state !== 'saving') session.state = 'pending';
    publish();
    schedule();
    return true;
  }
  function retry() {
    if (disposed || session?.state !== 'failed') return false;
    session.latest = progress.snapshot();
    session.state = 'pending';
    if (session.needsRead) onAccountSyncing(true);
    publish();
    void flush();
    return true;
  }
  function dispose() {
    if (disposed) return;
    cancelTimer();
    generation += 1;
    session = null;
    disposed = true;
    onAccountSyncing(false);
    publish();
  }
  return Object.freeze({ setAccount, queue, retry, status, dispose });
}
