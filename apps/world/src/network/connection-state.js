// Deterministic connection state machine. It never touches the local player:
// every state, including OFFLINE, leaves world play running.

export const ConnectionState = Object.freeze({
  OFFLINE: "OFFLINE",
  CONNECTING: "CONNECTING",
  ONLINE: "ONLINE",
  RECONNECTING: "RECONNECTING"
});

export const DEFAULT_RETRY = Object.freeze({
  // Delay before each reconnect attempt; its length is the attempt budget.
  backoffMs: Object.freeze([500, 1000, 2000, 4000, 8000]),
  // A connect attempt with no status by then counts as failed.
  connectTimeoutMs: 5000
});

const { OFFLINE, CONNECTING, ONLINE, RECONNECTING } = ConnectionState;

// Allowed transitions. Anything else is ignored (returns false), never thrown into the game loop.
const TRANSITIONS = {
  start: { [OFFLINE]: CONNECTING },
  connected: { [CONNECTING]: ONLINE, [RECONNECTING]: ONLINE },
  lost: { [ONLINE]: RECONNECTING, [CONNECTING]: RECONNECTING },
  retryFailed: { [RECONNECTING]: RECONNECTING },
  exhausted: { [RECONNECTING]: OFFLINE },
  stop: { [CONNECTING]: OFFLINE, [ONLINE]: OFFLINE, [RECONNECTING]: OFFLINE }
};

export class ConnectionStateMachine {
  constructor({ retry = DEFAULT_RETRY } = {}) {
    this.retry = { ...DEFAULT_RETRY, ...retry };
    this.state = OFFLINE;
    this.attempts = 0;
    this.nextRetryAt = null;
    this.history = [OFFLINE];
    this.listeners = new Set();
  }

  onChange(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #go(event, nowMs) {
    const next = TRANSITIONS[event]?.[this.state];
    if (!next) return false;
    const previous = this.state;
    this.state = next;
    if (next !== previous) {
      this.history.push(next);
      for (const listener of this.listeners) {
        try { listener({ previous, state: next, event, at: nowMs }); } catch { /* listeners never break the machine */ }
      }
    }
    return true;
  }

  start(nowMs) {
    return this.#go("start", nowMs);
  }

  // `resetRetries: false` keeps the retry budget until the caller confirms the link is healthy
  // (a transport can accept a connect and then fail every channel join).
  connected(nowMs, { resetRetries = true } = {}) {
    if (!this.#go("connected", nowMs)) return false;
    if (resetRetries) this.attempts = 0;
    this.nextRetryAt = null;
    return true;
  }

  // The connection proved itself (e.g. first presence sync): restore the full retry budget.
  confirmHealthy() {
    if (this.state === ONLINE) this.attempts = 0;
  }

  // Connection dropped or an attempt failed. Schedules the next retry or gives up.
  lost(nowMs) {
    const event = this.state === RECONNECTING ? "retryFailed" : "lost";
    if (!this.#go(event, nowMs)) return false;
    if (this.attempts >= this.retry.backoffMs.length) {
      this.nextRetryAt = null;
      return this.#go("exhausted", nowMs);
    }
    this.nextRetryAt = nowMs + this.retry.backoffMs[this.attempts];
    return true;
  }

  // True once when a scheduled retry is due; the caller then reconnects the transport.
  takeDueRetry(nowMs) {
    if (this.state !== RECONNECTING || this.nextRetryAt === null || nowMs < this.nextRetryAt) return false;
    this.nextRetryAt = null;
    this.attempts += 1;
    return true;
  }

  stop(nowMs) {
    this.attempts = 0;
    this.nextRetryAt = null;
    return this.#go("stop", nowMs);
  }
}
