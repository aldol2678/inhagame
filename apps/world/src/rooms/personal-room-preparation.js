// Prepare the shared personal-room scene without revealing it or changing the source scene.
// The transition owns its deadline and account epoch; the lease owns only staged resources.
export function createPersonalRoomPreparation({ getFurniture, getScene, getUserId }) {
  let current = null;
  const aborted = () => Object.assign(new Error("Personal room preparation cancelled"), { name: "AbortError" });

  async function prepare({ metadata, signal, isValid = () => true, stage = () => {}, onProgress = () => {}, onCleanupError = () => {} }) {
    current?.cancel();
    const furniture = getFurniture(), scene = getScene(), account = getUserId();
    const roomId = typeof metadata?.personalRoomId === "string" ? metadata.personalRoomId.toLowerCase() : null;
    let settled = false, started = false, rejectAbort;
    const cancellation = new Promise((_, reject) => { rejectAbort = reject; });
    // Cancellation can happen synchronously before the first raced await is installed.
    void cancellation.catch(() => {});
    const detach = () => signal?.removeEventListener("abort", cancel);
    function cancel() {
      if (settled) return;
      settled = true;
      detach();
      const owns = current === lease;
      if (owns) current = null;
      rejectAbort(aborted());
      if (owns && started) {
        const errors = [];
        try { furniture.reset(); } catch (error) { errors.push(error); }
        try { if (!scene.root?.enabled) scene.onDeactivate?.(); } catch (error) { errors.push(error); }
        if (errors.length) {
          // Abort listeners must never throw asynchronously. The transition keeps its input
          // lock and reports uncertain cleanup rather than enabling a half-restored scene.
          try { onCleanupError(new AggregateError(errors, "Personal room cleanup failed")); } catch { /* reporter owns its failure */ }
        }
      }
    }
    const valid = () => !settled && current === lease && !signal?.aborted && account != null
      && getUserId() === account && isValid();
    const check = () => { if (!valid()) throw aborted(); };
    const lease = {
      cancel,
      commit() {
        check();
        settled = true;
        detach();
        current = null;
      }
    };
    current = lease;
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      check();
      if (!roomId || !furniture?.bind || !furniture?.state || !furniture?.reset || !scene?.ensureVisualAssets) {
        throw new Error("Personal room preparation unavailable");
      }
      stage("furniture");
      check();
      started = true;
      const bound = await Promise.race([furniture.bind(roomId), cancellation]);
      check();
      const state = furniture.state();
      if (bound !== true || state.ready !== true || state.roomId !== roomId || state.error || state.reading) {
        throw new Error(state.error || "Personal room furniture unavailable");
      }
      stage("visuals");
      check();
      // Optional models already resolve with fallback values; only rejection blocks entry.
      await Promise.race([scene.ensureVisualAssets({ signal, onProgress: progress => { if (valid()) onProgress(progress); } }), cancellation]);
      check();
      return lease;
    } catch (error) {
      cancel();
      throw error;
    }
  }
  return { prepare };
}
