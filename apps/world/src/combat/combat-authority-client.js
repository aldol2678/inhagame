export const COMBAT_BUILDING5_FUNCTION = 'world-combat-building5';

const TERMINAL = new Set(['SUCCEEDED','FAILED','CANCELLED','EXPIRED']);
const frozen = value => Object.freeze(value);
const defaultKey = () => globalThis.crypto?.randomUUID?.() ?? (() => { throw new Error('COMBAT_UUID_UNAVAILABLE'); })();

function normalizedEncounter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status ?? '');
  const encounterId = String(raw.encounterId ?? '');
  if (!encounterId || !status) return null;
  return frozen({
    encounterId,
    combatId: String(raw.combatId ?? ''),
    status,
    resultRef: raw.resultRef ? String(raw.resultRef) : null,
    stateVersion: Number(raw.stateVersion ?? 0),
    state: raw.state && typeof raw.state === 'object' ? raw.state : null,
    settlement: raw.settlement && typeof raw.settlement === 'object' ? raw.settlement : null
  });
}

export function createBuilding5CombatAuthorityClient({
  getClient,
  createKey = defaultKey,
  syncIntervalMs = 1000,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval
} = {}) {
  if (typeof getClient !== 'function') throw new TypeError('Combat authority requires getClient');
  if (typeof createKey !== 'function') throw new TypeError('Combat authority requires createKey');

  const listeners = new Set();
  let phase = 'LOCAL_ONLY';
  let encounter = null;
  let lastError = null;
  let pending = 0;
  let startPromise = null;
  let queue = Promise.resolve();
  let timer = null;

  const snapshot = () => frozen({
    phase,
    pending,
    encounter,
    encounterId: encounter?.encounterId ?? null,
    serverStatus: encounter?.status ?? null,
    resultRef: encounter?.resultRef ?? null,
    settlement: encounter?.settlement ?? null,
    lastError
  });

  const emit = event => {
    const state = snapshot();
    for (const listener of listeners) listener(state, event);
    return state;
  };

  const stopSync = () => {
    if (timer != null) clearIntervalFn?.(timer);
    timer = null;
  };

  const syncEnabled = () => encounter?.status === 'ACTIVE' && phase === 'ACTIVE';

  const updateFromResponse = (data, event) => {
    const next = normalizedEncounter(data?.encounter);
    if (next) encounter = next;
    if (encounter && TERMINAL.has(encounter.status)) {
      phase = encounter.status;
      stopSync();
    } else if (encounter?.status === 'ACTIVE') {
      phase = 'ACTIVE';
    }
    lastError = null;
    return emit(event);
  };

  const invoke = async (body) => {
    const client = getClient();
    if (!client?.functions?.invoke) {
      phase = 'LOCAL_ONLY';
      lastError = 'NO_AUTHORITY_CLIENT';
      emit('local-only');
      return null;
    }
    pending += 1;
    emit('pending');
    try {
      const { data, error } = await client.functions.invoke(COMBAT_BUILDING5_FUNCTION, { body });
      if (error) throw error;
      return data;
    } finally {
      pending = Math.max(0, pending - 1);
    }
  };

  const ensureSync = () => {
    if (timer != null || !setIntervalFn || !syncEnabled()) return;
    timer = setIntervalFn(() => {
      if (!syncEnabled()) return;
      void action('sync').catch(() => {});
    }, Math.max(500, Number(syncIntervalMs) || 1000));
  };

  async function start() {
    if (startPromise) return startPromise;
    if (encounter?.status === 'ACTIVE') return snapshot();

    const client = getClient();
    if (!client?.functions?.invoke) {
      phase = 'LOCAL_ONLY';
      lastError = 'NO_AUTHORITY_CLIENT';
      return emit('local-only');
    }

    phase = 'STARTING';
    lastError = null;
    emit('starting');
    const clientEncounterKey = createKey();

    startPromise = invoke({ op: 'start', clientEncounterKey })
      .then(data => {
        if (!data) return snapshot();
        const state = updateFromResponse(data, 'started');
        ensureSync();
        return state;
      })
      .catch(error => {
        phase = 'ERROR';
        lastError = String(error?.message ?? error ?? 'COMBAT_START_FAILED');
        emit('error');
        return snapshot();
      })
      .finally(() => { startPromise = null; });

    return startPromise;
  }

  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  async function action(localAction) {
    return enqueue(async () => {
      if (!encounter?.encounterId) await start();
      if (!encounter?.encounterId || encounter.status !== 'ACTIVE') return snapshot();

      const op = localAction === 'cancel' ? 'cancel' : 'action';
      const body = op === 'cancel'
        ? { op, encounterId: encounter.encounterId, actionKey: createKey() }
        : { op, encounterId: encounter.encounterId, action: localAction, actionKey: createKey() };

      try {
        const data = await invoke(body);
        if (data) updateFromResponse(data, localAction === 'sync' ? 'sync' : 'action');
      } catch (error) {
        lastError = String(error?.message ?? error ?? 'COMBAT_ACTION_FAILED');
        phase = encounter?.status === 'ACTIVE' ? 'ACTIVE' : 'ERROR';
        emit('error');
      }
      ensureSync();
      return snapshot();
    });
  }

  async function refresh() {
    return enqueue(async () => {
      if (!encounter?.encounterId) return snapshot();
      try {
        const data = await invoke({ op: 'snapshot', encounterId: encounter.encounterId });
        if (data) updateFromResponse(data, 'snapshot');
      } catch (error) {
        lastError = String(error?.message ?? error ?? 'COMBAT_SNAPSHOT_FAILED');
        emit('error');
      }
      return snapshot();
    });
  }

  async function cancel() {
    if (!encounter?.encounterId || encounter.status !== 'ACTIVE') return snapshot();
    return action('cancel');
  }

  function reset() {
    stopSync();
    phase = 'LOCAL_ONLY';
    encounter = null;
    lastError = null;
    pending = 0;
    startPromise = null;
    queue = Promise.resolve();
    return emit('reset');
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Combat authority listener must be a function');
    listeners.add(listener);
    if (emitCurrent) listener(snapshot(), 'sync');
    return () => listeners.delete(listener);
  }

  return frozen({
    snapshot,
    start,
    action,
    refresh,
    cancel,
    reset,
    subscribe,
    get active() { return encounter?.status === 'ACTIVE'; }
  });
}

export function combatAuthorityLabel(state) {
  if (!state) return 'LOCAL';
  if (state.phase === 'STARTING' || state.pending > 0) return 'SERVER · SYNC';
  if (state.phase === 'ACTIVE') return 'SERVER';
  if (state.phase === 'SUCCEEDED') {
    const reward = state.settlement?.rewardStatus;
    if (reward === 'SUCCESS' || reward === 'PARTIAL_SUCCESS') return 'CLEAR · +50 EXP';
    if (reward === 'INELIGIBLE_REPEAT') return 'CLEAR · 반복훈련';
    return 'CLEAR';
  }
  if (state.phase === 'FAILED') return 'SERVER · FAIL';
  if (state.phase === 'CANCELLED') return 'SERVER · CANCEL';
  if (state.phase === 'ERROR') return 'SERVER · ERROR';
  return 'LOCAL';
}
