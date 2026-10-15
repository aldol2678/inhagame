// Diagnostic only. Does not mock responses, change deadlines, or exempt failures.
// Self-contained so Playwright can install it before the first document request.
export function observeWorldTimeRequests({ origin }) {
  if (globalThis.location.origin !== origin) return;
  const original = globalThis.fetch, events = [], limit = 128;
  let sequence = 0, dropped = 0;
  const record = (id, type, detail = {}) => {
    if (events.length >= limit) { dropped++; return; }
    events.push({ id, type, atMs: performance.now(), ...detail });
  };
  globalThis.__WORLD_TIME_REQUEST_EVIDENCE__ = {
    snapshot: () => ({ events: events.map(event => ({ ...event })), dropped })
  };
  globalThis.fetch = function(input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.href !== origin + '/api/world-time') return original.call(this, input, options);
    const id = ++sequence, start = performance.now();
    const signal = options && Object.hasOwn(options, 'signal') ? options.signal : input?.signal;
    record(id, 'start', { signalAborted: signal?.aborted === true });
    // Retain the listener after headers: response.json() can still be aborted.
    // Once-only listener is released with its request signal/document.
    const aborted = () => record(id, 'signal-abort', {
      elapsedMs: performance.now() - start, reasonName: signal?.reason?.name ?? null
    });
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
    let request;
    try { request = original.call(this, input, options); }
    catch (error) { record(id, 'fetch-throw', { errorName: error.name }); throw error; }
    return request.then(response => {
      record(id, 'headers', { status: response.status, elapsedMs: performance.now() - start });
      return response;
    }, error => {
      record(id, 'fetch-reject', { errorName: error.name, signalAborted: signal?.aborted === true,
        elapsedMs: performance.now() - start });
      throw error;
    });
  };
}
