export const RECAST_RUNTIME_SHADOW_VERSION = 'p0-live-shadow-v1';

export const RECAST_RUNTIME_SHADOW_RESULT = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  ERROR: 'ERROR'
});

const finitePoint = point => Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.z);
const point = value => ({ x: value.x, z: value.z });
const routeCopy = route => Array.isArray(route) ? route.map(point) : null;

export function createRecastRuntimeShadowNavigator(canonicalNavigator, {
  enabled = false,
  WorkerCtor = globalThis.Worker,
  workerUrl = new URL('./recast-runtime-shadow-worker.mjs', import.meta.url),
  maxRecords = 64,
  maxBacklog = 128
} = {}) {
  if (!canonicalNavigator || typeof canonicalNavigator.route !== 'function' ||
      typeof canonicalNavigator.networkRoute !== 'function' ||
      typeof canonicalNavigator.wanderRoute !== 'function') {
    throw new TypeError('Canonical NPC navigator is required');
  }
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 ||
      !Number.isSafeInteger(maxBacklog) || maxBacklog < 1) {
    throw new TypeError('Invalid Recast runtime shadow limits');
  }

  let worker = null;
  let state = enabled ? 'STARTING' : 'DISABLED';
  let nextId = 0;
  let pending = 0;
  let dropped = 0;
  let skippedWanderNoRoute = 0;
  let init = null;
  let workerErrors = 0;
  const backlog = [];
  const records = [];
  const counts = { match: 0, mismatch: 0, error: 0 };

  const remember = record => {
    records.push(Object.freeze({ ...record }));
    if (records.length > maxRecords) records.splice(0, records.length - maxRecords);
  };

  const post = message => {
    try {
      worker.postMessage(message);
      pending += 1;
    } catch (error) {
      dropped += 1;
      remember({ id: message.id, kind: message.kind, status: RECAST_RUNTIME_SHADOW_RESULT.ERROR,
        reason: String(error?.message ?? error), latencyMs: null });
      counts.error += 1;
    }
  };

  const flush = () => {
    while (backlog.length && state === 'READY') post(backlog.shift());
  };

  const enqueue = (kind, from, to, canonicalRoute, meta = null) => {
    if (!enabled || !finitePoint(from) || !finitePoint(to)) return;
    const message = {
      type: 'OBSERVE_ROUTE',
      id: ++nextId,
      kind,
      from: point(from),
      to: point(to),
      canonicalRoute: routeCopy(canonicalRoute),
      meta
    };
    if (state === 'READY') {
      post(message);
      return;
    }
    if (state === 'STARTING' && backlog.length < maxBacklog) {
      backlog.push(message);
      return;
    }
    dropped += 1;
  };

  const onMessage = event => {
    const message = event?.data ?? {};
    if (message.type === 'READY') {
      state = 'READY';
      init = Object.freeze({
        version: message.version ?? null,
        packageVersion: message.packageVersion ?? null,
        initialization: message.initialization ?? null,
        elapsedMs: Number.isFinite(message.elapsedMs) ? message.elapsedMs : null
      });
      flush();
      return;
    }
    if (message.type === 'INIT_ERROR') {
      state = 'ERROR';
      workerErrors += 1;
      dropped += backlog.length;
      backlog.length = 0;
      init = Object.freeze({ reason: String(message.reason ?? 'RECAST_RUNTIME_SHADOW_INIT') });
      return;
    }
    if (message.type !== 'RESULT') return;
    pending = Math.max(0, pending - 1);
    const status = Object.values(RECAST_RUNTIME_SHADOW_RESULT).includes(message.status)
      ? message.status : RECAST_RUNTIME_SHADOW_RESULT.ERROR;
    if (status === RECAST_RUNTIME_SHADOW_RESULT.MATCH) counts.match += 1;
    else if (status === RECAST_RUNTIME_SHADOW_RESULT.MISMATCH) counts.mismatch += 1;
    else counts.error += 1;
    remember({
      id: message.id,
      kind: message.kind,
      status,
      reason: message.reason ?? null,
      canonicalOk: message.canonicalOk === true,
      recastOk: message.recastOk === true,
      canonicalLength: Number.isFinite(message.canonicalLength) ? message.canonicalLength : null,
      recastLength: Number.isFinite(message.recastLength) ? message.recastLength : null,
      lengthDeltaPct: Number.isFinite(message.lengthDeltaPct) ? message.lengthDeltaPct : null,
      latencyMs: Number.isFinite(message.latencyMs) ? message.latencyMs : null,
      meta: message.meta ?? null
    });
  };

  const onError = event => {
    state = 'ERROR';
    workerErrors += 1;
    dropped += backlog.length + pending;
    backlog.length = 0;
    pending = 0;
    init = Object.freeze({ reason: String(event?.message ?? 'RECAST_RUNTIME_SHADOW_WORKER') });
  };

  if (enabled) {
    if (typeof WorkerCtor !== 'function') {
      state = 'UNAVAILABLE';
      init = Object.freeze({ reason: 'WORKER_UNAVAILABLE' });
    } else {
      try {
        worker = new WorkerCtor(workerUrl, { type: 'module' });
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
      } catch (error) {
        state = 'UNAVAILABLE';
        init = Object.freeze({ reason: String(error?.message ?? error) });
      }
    }
  }

  function route(from, to) {
    const canonical = canonicalNavigator.route(from, to);
    enqueue('ROUTE', from, to, canonical);
    return canonical;
  }

  function networkRoute(from, to) {
    const canonical = canonicalNavigator.networkRoute(from, to);
    enqueue('NETWORK', from, to, canonical);
    return canonical;
  }

  function wanderRoute(from, anchor, id, leg, maxRadius) {
    const canonical = canonicalNavigator.wanderRoute(from, anchor, id, leg, maxRadius);
    const destination = canonical?.at?.(-1);
    if (finitePoint(destination)) {
      enqueue('WANDER', from, destination, canonical, {
        npcId: typeof id === 'string' ? id : null,
        leg: Number.isSafeInteger(leg) ? leg : null
      });
    } else if (enabled) {
      skippedWanderNoRoute += 1;
    }
    return canonical;
  }

  function status() {
    return Object.freeze({
      schema: 'inha.recast-runtime-shadow/1',
      version: RECAST_RUNTIME_SHADOW_VERSION,
      enabled: Boolean(enabled),
      advisoryOnly: true,
      authorityEffect: 'NONE',
      canonicalAuthority: 'JS_NAVIGATOR',
      shadowEngine: 'RECAST_WASM',
      state,
      init,
      queued: backlog.length,
      pending,
      dropped,
      skippedWanderNoRoute,
      workerErrors,
      observed: counts.match + counts.mismatch + counts.error,
      counts: Object.freeze({ ...counts }),
      records: Object.freeze([...records])
    });
  }

  function destroy() {
    if (state === 'DESTROYED') return;
    state = 'DESTROYED';
    dropped += backlog.length + pending;
    backlog.length = 0;
    pending = 0;
    try { worker?.terminate?.(); } catch {}
    worker = null;
  }

  return {
    ...canonicalNavigator,
    route,
    networkRoute,
    wanderRoute,
    recastRuntimeShadow: Object.freeze({
      enabled: Boolean(enabled),
      status,
      destroy
    })
  };
}
