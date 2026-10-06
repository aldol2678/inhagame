// INHA WORLD · Campus Daily Quiz client (P1e).
// The server owns the quiz: the Asia/Seoul day, the run, the three questions, the correct answers, the
// scoring and the reward. This module only reads the caller's state, asks to start, and forwards the
// option the player picked (run id + question id + index). It never sends a date, score, success flag,
// reward id or amount, never keeps correct answers, and never adds coins or EXP on its own: after a
// PASSED answer the caller re-reads the Wallet / Progression authorities.
//
// Account-scoped like inventory / wallet: every account change bumps a generation counter, drops the
// previous state at once and discards responses (and reward callbacks) from an older generation.

import { isQuestRewardResult } from "../../npc-factory/quest-reward-shape.mjs";

export const DAILY_QUIZ_RPC = Object.freeze({
  READ: "get_my_world_daily_quiz_v1",
  START: "start_my_world_daily_quiz_v1",
  ANSWER: "answer_my_world_daily_quiz_v1"
});

export const DAILY_QUIZ_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

export const DAILY_QUIZ_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  ACTIVE: "ACTIVE",
  PASSED: "PASSED",
  FAILED: "FAILED"
});

const STATUSES = new Set(Object.values(DAILY_QUIZ_STATUS));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isText = (value, max = 300) => typeof value === "string" && value.length > 0 && value.length <= max;
const isCount = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function parseProgress(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { answered, total, correct } = raw;
  if (total !== 3 || !isCount(answered, 3) || !isCount(correct, answered)) return null;
  return Object.freeze({ answered, total, correct });
}

function parseQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { questionId, index, prompt, options } = raw;
  if (!isText(questionId, 120) || !isCount(index, 2) || !isText(prompt)) return null;
  if (!Array.isArray(options) || options.length !== 4 || !options.every(option => isText(option, 120))) return null;
  return Object.freeze({ questionId, index, prompt, options: Object.freeze([...options]) });
}

function parsePreview(raw) {
  if (!Array.isArray(raw)) return null;
  const entries = [];
  for (const entry of raw) {
    if (!entry || !isText(entry.grantType, 20) || !isText(entry.targetId, 120) ||
        !Number.isSafeInteger(entry.amount) || entry.amount <= 0) return null;
    entries.push(Object.freeze({ grantType: entry.grantType, targetId: entry.targetId, amount: entry.amount }));
  }
  return Object.freeze(entries);
}

function parseLastAnswer(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || !isText(raw.questionId, 120) || !isCount(raw.index, 2) ||
      typeof raw.correct !== "boolean") return undefined;
  return Object.freeze({ questionId: raw.questionId, index: raw.index, correct: raw.correct });
}

/** Server state → frozen snapshot, or null when it is not the documented contract. */
export function parseDailyQuiz(raw) {
  if (!raw || typeof raw !== "object" || !STATUSES.has(raw.status) ||
      typeof raw.rewardDate !== "string" || !DATE.test(raw.rewardDate)) return null;
  const progress = parseProgress(raw.progress);
  const rewardPreview = parsePreview(raw.rewardPreview);
  const lastAnswer = parseLastAnswer(raw.lastAnswer);
  if (!progress || !rewardPreview || lastAnswer === undefined) return null;
  const available = raw.status === DAILY_QUIZ_STATUS.AVAILABLE;
  if (available ? raw.runId != null : !UUID.test(raw.runId ?? "")) return null;
  const active = raw.status === DAILY_QUIZ_STATUS.ACTIVE;
  const question = active ? parseQuestion(raw.question) : null;
  if (active ? !question || question.index !== progress.answered : raw.question != null) return null;
  if (!active && !available && progress.answered !== 3) return null;
  return Object.freeze({
    status: raw.status,
    rewardDate: raw.rewardDate,
    runId: available ? null : raw.runId,
    progress,
    question,
    rewardPreview,
    lastAnswer
  });
}

// The server error code from a PostgREST error, or FAILED when it is not one of ours.
const KNOWN_CODES = ["QUIZ_ALREADY_ANSWERED", "QUIZ_QUESTION_MISMATCH", "QUIZ_RUN_NOT_FOUND", "QUIZ_RUN_EXPIRED",
  "QUIZ_UNAVAILABLE", "QUIZ_REWARD_FAILED", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "INVALID_ANSWER"];
export function dailyQuizErrorCode(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return KNOWN_CODES.find(code => text.includes(code)) ?? "FAILED";
}

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), onReward?: (reward: object) => void, onRecoveryReadback?: () => void }} options
 *   getClient returns the signed-in permanent-account Supabase client (online.supabase), or null.
 *   onReward is called once with the server Reward result of the PASSED answer, for the current account.
 */
export function createDailyQuizClient({ getClient, onReward = () => {}, onRecoveryReadback = () => {} } = {}) {
  if (typeof getClient !== "function") throw new Error("Daily quiz client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = DAILY_QUIZ_STATE.SIGNED_OUT;
  let snapshot = null;
  let pending = null;
  let reading = null;
  let readVersion = 0;
  const listeners = new Set();

  function set(nextState, nextSnapshot, reason) {
    state = nextState;
    snapshot = nextSnapshot;
    const change = { state, snapshot, accountId, reason, pending: pending !== null };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Daily quiz listener failed:", error); }
    }
  }

  async function call(rpc, args) {
    const client = getClient();
    if (!client?.rpc) return { error: { message: "SIGNED_OUT" } };
    try {
      return (await client.rpc(rpc, args)) ?? {};
    } catch (error) {
      return { error };
    }
  }

  // The server may have committed before an error/malformed response reached us.
  // Re-read economic authorities separately; never synthesize/replay reward results.
  function recoverReadback(gen) {
    if (gen !== generation) return;
    try { onRecoveryReadback(); } catch (error) { console.warn("Daily reward recovery readback failed:", error); }
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    // A read sent during a write can still observe its old server snapshot. Defer and
    // coalesce these refresh requests until the write settles, without retrying it.
    if (pending) {
      const gen = generation;
      pending.refresh ??= pending.done.then(() => gen === generation ? refresh(reason) : false);
      return pending.refresh;
    }
    if (reading) return reading;
    const gen = generation;
    const version = readVersion;
    const run = (async () => {
      try {
        const { data, error } = await call(DAILY_QUIZ_RPC.READ);
        if (gen !== generation || version !== readVersion) return false;
        const next = error ? null : parseDailyQuiz(data);
        if (error) console.warn("World daily quiz unavailable:", error?.message ?? error);
        if (next) set(DAILY_QUIZ_STATE.READY, next, reason);
        else set(DAILY_QUIZ_STATE.UNAVAILABLE, null, reason);
        return Boolean(next);
      } finally {
        if (reading === run) reading = null;
      }
    })();
    reading = run;
    return run;
  }

  // One write at a time (duplicate clicks get BUSY); the response is applied only for the same account.
  async function write(kind, rpc, args) {
    if (!accountId || !getClient()?.rpc) return { outcome: "SIGNED_OUT" };
    if (pending) return { outcome: "BUSY" };
    const gen = generation;
    const claim = {};
    claim.done = new Promise(resolve => { claim.finish = resolve; });
    pending = claim;
    // Invalidate reads already in flight so neither success nor failure recovery
    // can be overwritten (or coalesced) with a pre-mutation status response.
    readVersion += 1;
    reading = null;
    set(state, snapshot, kind);
    try {
      const { data, error } = await call(rpc, args);
      if (gen !== generation) return { outcome: "STALE" };
      if (error) {
        const code = dailyQuizErrorCode(error);
        pending = null;
        recoverReadback(gen);
        void refresh(kind);
        return { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code };
      }
      const next = parseDailyQuiz(data);
      const reward = data?.reward ?? null;
      if (!next || (reward !== null && !(next.status === DAILY_QUIZ_STATUS.PASSED && isQuestRewardResult(reward)))) {
        pending = null;
        recoverReadback(gen);
        void refresh(kind);
        return { outcome: "FAILED", code: "MALFORMED_RESPONSE" };
      }
      pending = null;
      set(DAILY_QUIZ_STATE.READY, next, kind);
      if (!reward && next.status === DAILY_QUIZ_STATUS.PASSED) recoverReadback(gen);
      if (reward) {
        try { onReward(reward); } catch (error) { console.warn("Daily quiz reward display failed:", error); }
      }
      return { outcome: "OK", snapshot: next, reward };
    } finally {
      if (pending === claim) {
        pending = null;
        if (gen === generation) set(state, snapshot, kind);
      }
      claim.finish();
    }
  }

  function start() {
    return write("start", DAILY_QUIZ_RPC.START, undefined);
  }

  /** Answer the current question with option `index` (0..3). Only ids and the index are sent. */
  function answer(index) {
    const question = snapshot?.question;
    if (!question || snapshot.status !== DAILY_QUIZ_STATUS.ACTIVE || !isCount(index, 3))
      return Promise.resolve({ outcome: "REFUSED", code: "NO_ACTIVE_QUESTION" });
    return write("answer", DAILY_QUIZ_RPC.ANSWER,
      { p_run_id: snapshot.runId, p_question_id: question.questionId, p_answer_index: index });
  }

  /** Account boundary. Same id is a no-op; any change drops the old state and in-flight responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === DAILY_QUIZ_STATE.READY);
    generation += 1;
    accountId = next;
    pending = null;
    reading = null;
    if (!next) {
      set(DAILY_QUIZ_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(DAILY_QUIZ_STATE.LOADING, null, "account");
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    start,
    answer,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    get pending() { return pending !== null; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, quiz: snapshot?.status ?? null,
        answered: snapshot?.progress.answered ?? 0, pending: pending !== null };
    }
  };
}
