// Biryong's local cache stays authoritative for unsent changes. The existing
// monotonic server merge RPC owns the cloud copy; this controller only schedules it.
export function createBiryongCloudSync({
  getClient,
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
    const { data, error } = await run.client.rpc(name, args);
    if (error) throw error;
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
    const client = getClient?.() ?? null;
    const next = userId && client ? userId : null;
    if (next === (session?.userId ?? null) && (!next || client === session.client)) return false;
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
    session = { generation, userId: next, client, needsRead: true,
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
