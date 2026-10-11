// No broad process termination: abort is the shared harness's optional owned-resource hook.
// The caller supplies a host-bounded phase runner, independent of renderer progress.
export async function finalizeTraceDiagnostic({ smoke, receipt, phase, persist, log,
  fail = () => { process.exitCode = 1; }, exit = code => process.exit(code) }) {
  if (smoke) {
    try { await phase('close-offline-browser', () => smoke.close()); }
    catch (error) {
      receipt.cleanupError = String(error);
      receipt.status = 'DIAGNOSTIC_PARTIAL';
      fail();
      try {
        await phase('abort-offline-browser', () => {
          if (typeof smoke.abort !== 'function') throw new Error('owned-resource abort hook unavailable; integrate PNG harness cleanup first');
          return smoke.abort();
        });
      } catch (abortError) {
        receipt.cleanupAbortError = String(abortError);
        receipt.forcedFailureExit = true;
      }
    }
  }
  receipt.problems = smoke?.problems ?? [];
  receipt.completedAt = new Date().toISOString();
  // Explicit failure termination only follows the awaited durable receipt write.
  // The workflow can then upload the full/partial diagnostic instead of waiting on Node handles.
  await persist();
  log(receipt);
  if (receipt.forcedFailureExit) exit(1);
}
