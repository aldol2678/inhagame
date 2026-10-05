// INHA WORLD · 캠퍼스 출석부 client (P1f).
// The server owns attendance: the Asia/Seoul day and month, the monthly count, milestones and the
// rewards. This module reads the caller's status and, only when the player presses the button, sends
// the claim (no arguments). It never claims on load / login / refresh, never sends a date, and never
// adds coins on its own: after a claim that paid, the caller re-reads the Wallet authority.
//
// Account-scoped like the daily quiz / inventory: every account change bumps a generation counter,
// drops the previous status at once and discards responses (and reward callbacks) from an older one.

import { isQuestRewardResult } from "../../npc-factory/quest-reward-shape.mjs";

export const ATTENDANCE_RPC = Object.freeze({
  READ: "get_my_world_attendance_v1",
  CLAIM: "claim_my_world_attendance_v1"
});

export const ATTENDANCE_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

export const ATTENDANCE_MILESTONES = Object.freeze([3, 7, 14, 21]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const isCount = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const isCoin = (value) => Number.isSafeInteger(value) && value > 0;

function parseMilestones(raw) {
  if (!Array.isArray(raw) || raw.length !== ATTENDANCE_MILESTONES.length) return null;
  const list = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || entry.days !== ATTENDANCE_MILESTONES[index] || typeof entry.claimed !== "boolean" || !isCoin(entry.bonusCoin)) return null;
    list.push(Object.freeze({ days: entry.days, claimed: entry.claimed, bonusCoin: entry.bonusCoin }));
  }
  return Object.freeze(list);
}

/** Server status → frozen snapshot, or null when it is not the documented contract. */
export function parseAttendance(raw) {
  if (!raw || typeof raw !== "object" || !DATE.test(raw.rewardDate ?? "") || !MONTH.test(raw.month ?? "")) return null;
  if (!raw.rewardDate.startsWith(raw.month) || typeof raw.claimedToday !== "boolean" || !isCount(raw.attendedDays, 31)) return null;
  if (!isCoin(raw.dailyCoin) || !Array.isArray(raw.attendedDates)) return null;
  const dates = raw.attendedDates;
  // Only this month's dates, ascending, none after today, and exactly attendedDays of them.
  if (dates.length !== raw.attendedDays || !dates.every((d, i) => typeof d === "string" && DATE.test(d) &&
      d.startsWith(raw.month) && d <= raw.rewardDate && (i === 0 || dates[i - 1] < d))) return null;
  if (raw.claimedToday !== dates.includes(raw.rewardDate)) return null;
  const milestones = parseMilestones(raw.milestones);
  if (!milestones) return null;
  const next = raw.nextMilestone ?? null;
  if (next !== null && (!ATTENDANCE_MILESTONES.includes(next.days) || next.days <= raw.attendedDays || !isCoin(next.bonusCoin))) return null;
  return Object.freeze({
    rewardDate: raw.rewardDate,
    month: raw.month,
    claimedToday: raw.claimedToday,
    attendedDays: raw.attendedDays,
    attendedDates: Object.freeze([...dates]),
    dailyCoin: raw.dailyCoin,
    nextMilestone: next ? Object.freeze({ days: next.days, bonusCoin: next.bonusCoin }) : null,
    milestones
  });
}

const KNOWN_CODES = ["ATTENDANCE_REWARD_FAILED", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE"];
export function attendanceErrorCode(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return KNOWN_CODES.find(code => text.includes(code)) ?? "FAILED";
}

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), onRewards?: (rewards: object[], snapshot: object) => void }} options
 *   onRewards is called once with the server Reward results of a claim that paid (daily, then an
 *   optional milestone), for the current account only.
 */
export function createAttendanceClient({ getClient, onRewards = () => {} } = {}) {
  if (typeof getClient !== "function") throw new Error("Attendance client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = ATTENDANCE_STATE.SIGNED_OUT;
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
      try { listener(change); } catch (error) { console.warn("Attendance listener failed:", error); }
    }
  }

  async function call(rpc) {
    const client = getClient();
    if (!client?.rpc) return { error: { message: "SIGNED_OUT" } };
    try {
      return await client.rpc(rpc);
    } catch (error) {
      return { error };
    }
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    // A read sent during a claim can still observe its old server snapshot. Defer
    // and coalesce these refresh requests until the claim settles; never retry it.
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
        const { data, error } = await call(ATTENDANCE_RPC.READ);
        if (gen !== generation || version !== readVersion) return false;
        const next = error ? null : parseAttendance(data);
        if (error) console.warn("World attendance unavailable:", error?.message ?? error);
        if (next) set(ATTENDANCE_STATE.READY, next, reason);
        else set(ATTENDANCE_STATE.UNAVAILABLE, null, reason);
        return Boolean(next);
      } finally {
        if (reading === run) reading = null;
      }
    })();
    reading = run;
    return run;
  }

  /** The explicit "오늘 출석하기" action. One claim at a time: a second click while pending is BUSY. */
  async function claim() {
    if (!accountId || !getClient()?.rpc) return { outcome: "SIGNED_OUT" };
    if (pending) return { outcome: "BUSY" };
    const gen = generation;
    const token = {};
    token.done = new Promise(resolve => { token.finish = resolve; });
    pending = token;
    // Failure recovery and later refreshes must not reuse a pre-claim status read.
    readVersion += 1;
    reading = null;
    set(state, snapshot, "claim");
    try {
      const { data, error } = await call(ATTENDANCE_RPC.CLAIM);
      if (gen !== generation) return { outcome: "STALE" };
      if (error) {
        const code = attendanceErrorCode(error);
        pending = null;
        void refresh("claim");
        return { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code };
      }
      const next = parseAttendance(data);
      const rewards = Array.isArray(data?.rewards) ? data.rewards : null;
      const claimed = data?.claimed === true && data?.replayed === false;
      const replayed = data?.claimed === false && data?.replayed === true;
      const valid = next && next.claimedToday && rewards && (claimed
        ? rewards.length >= 1 && rewards.length <= 2 && rewards.every(isQuestRewardResult)
        : replayed && rewards.length === 0);
      if (!valid) {
        pending = null;
        void refresh("claim");
        return { outcome: "FAILED", code: "MALFORMED_RESPONSE" };
      }
      pending = null;
      set(ATTENDANCE_STATE.READY, next, "claim");
      if (claimed) {
        try { onRewards(rewards, next); } catch (error) { console.warn("Attendance reward display failed:", error); }
      }
      return { outcome: claimed ? "CLAIMED" : "ALREADY_CLAIMED", snapshot: next, rewards };
    } finally {
      if (pending === token) {
        pending = null;
        if (gen === generation) set(state, snapshot, "claim");
      }
      token.finish();
    }
  }

  /** Account boundary. Same id is a no-op; any change drops the old status and in-flight responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === ATTENDANCE_STATE.READY);
    generation += 1;
    accountId = next;
    pending = null;
    reading = null;
    if (!next) {
      set(ATTENDANCE_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(ATTENDANCE_STATE.LOADING, null, "account");
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    claim,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    get pending() { return pending !== null; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, claimedToday: snapshot?.claimedToday ?? null,
        attendedDays: snapshot?.attendedDays ?? 0, month: snapshot?.month ?? null, pending: pending !== null };
    }
  };
}
