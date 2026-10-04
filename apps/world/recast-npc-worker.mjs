// A single evaluation owns its WASM resources. Termination cancels synchronous work.
self.onmessage = async ({ data }) => {
  if (data?.type !== 'RUN') return;
  self.onmessage = null;
  const { requestId, prebuiltMode } = data;
  const send = (type, payload) => self.postMessage({ type, requestId, ...payload });
  try {
    const { runRecastEvaluation } = await import('./recast-npc-evaluation.mjs');
    const result = await runRecastEvaluation({ prebuiltMode,
      onPhase: phase => send('PHASE', { phase }) });
    send('RESULT', { result });
  } catch (error) {
    send('RESULT', { result: { verdict: 'ERROR', message: error?.message ?? String(error),
      stack: error?.stack ?? null } });
  } finally { self.close(); }
};
