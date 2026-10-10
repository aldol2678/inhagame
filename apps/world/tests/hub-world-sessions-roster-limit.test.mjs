// F08: the roster lists at most 100 accounts / 100 blocks. "Not in the list" is NOT evidence that the
// account's heartbeat sessions ended or that a block was lifted. Only an exact per-account read, or a
// list the server says was not truncated, can confirm. Uses only long-standing exports so the same file
// can be pointed at an older module to prove the failure (RED).
import test from "node:test";
import assert from "node:assert/strict";
import { mountWorldSessionAdmin } from "../hub-world-sessions.mjs";

const OPERATOR = "5f000000-0000-4000-8000-000000000061";
const TARGET = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-09T10:40:00.000Z";
const later = "2026-10-09T11:10:00.000Z";
const LIST = "get_world_session_admin_v1";
const KICK = "kick_world_user_v1";
const RESTORE = "restore_world_user_v1";
const TARGET_RPC = "get_world_session_admin_target_v1";

const uid = i => "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
const filler = n => Array.from({ length: n }, (_, i) => ({
  userId: uid(i + 1), nickname: "filler" + i, sessionCount: 1, space: "campus",
  placeZoneId: "AREA_MAIN_GATE", lastSeenAt: now
}));
const roster = ({ accounts = [], blocked = [], extra = {} } = {}) => ({
  operatorUserId: OPERATOR, onlineSessions: accounts.length, guestSessions: 0, accounts, blocked, asOf: now, ...extra
});
const targetAccount = { userId: TARGET, nickname: "canary-a", sessionCount: 2, space: "campus", placeZoneId: "AREA_MAIN_GATE", lastSeenAt: now };
const blockedTarget = { userId: TARGET, nickname: "canary-a", blockedUntil: later };

class FakeNode {
  constructor(tag = "div") { Object.assign(this, { tagName: tag.toUpperCase(), children: [], dataset: {}, listeners: {}, textContent: "", hidden: false, disabled: false, value: "30" }); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  closest(selector) { return selector === "button[data-action]" && this.tagName === "BUTTON" && this.dataset.action ? this : null; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// `lists`: roster before the command; `after`: roster after it. `target`: reply of the exact read
// (undefined = the RPC is unavailable, e.g. an older server).
function scenario({ lists, after, target, kick, restore }) {
  const ids = ["hub-world-session-admin", "hub-world-session-summary", "hub-world-session-status",
    "hub-world-session-accounts", "hub-world-session-blocks", "hub-world-session-refresh", "hub-world-session-duration"];
  const nodes = Object.fromEntries(ids.map(id => [id, new FakeNode()]));
  nodes["hub-world-session-admin"].hidden = true;
  let phase = "before";
  const calls = [];
  const doc = { visibilityState: "visible", getElementById: id => nodes[id] ?? null, createElement: tag => new FakeNode(tag), addEventListener() {} };
  const win = { location: { hash: "#account" }, addEventListener() {}, setInterval: () => 7, clearInterval() {}, setTimeout(fn) { fn(); } };
  const client = {
    auth: {
      async getUser() { return { data: { user: { id: OPERATOR, is_anonymous: false } } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },
    async rpc(name, args) {
      calls.push(name);
      if (name === LIST) return { data: phase === "before" ? lists : after, error: null };
      if (name === KICK) { phase = "after"; return { data: kick ?? { userId: args.p_user_id, sessionsRemoved: 2, blockedUntil: later }, error: null }; }
      if (name === RESTORE) { phase = "after"; return { data: restore ?? true, error: null }; }
      if (name === TARGET_RPC) {
        if (target === undefined) return { data: null, error: { code: "PGRST202", message: "function not found" } };
        return { data: typeof target === "function" ? target() : target, error: null };
      }
      throw new Error("UNEXPECTED_RPC " + name);
    }
  };
  mountWorldSessionAdmin({ client, documentLike: doc, windowLike: win, confirmAction: () => true });
  return { nodes, calls, status: () => nodes["hub-world-session-status"].textContent, summary: () => nodes["hub-world-session-summary"].textContent };
}
async function kickTarget(options) {
  const h = scenario(options);
  await settle();
  const accounts = h.nodes["hub-world-session-accounts"];
  const row = accounts.children.find(r => r.children[1]?.dataset?.userId === TARGET);
  assert.ok(row, "target has a kick button");
  await accounts.listeners.click({ target: row.children[1] });
  return h;
}
async function restoreTarget(options) {
  const h = scenario(options);
  await settle();
  const blocks = h.nodes["hub-world-session-blocks"];
  const row = blocks.children.find(r => r.children[1]?.dataset?.userId === TARGET);
  assert.ok(row, "target has a restore button");
  await blocks.listeners.click({ target: row.children[1] });
  return h;
}

// The target is listed before the command (so it can be kicked), then falls off the 100-row cap.
const crowded = (n = 100) => roster({ accounts: [targetAccount, ...filler(n - 1)] });
const truncatedAfter = ({ blocked = [blockedTarget] } = {}) => roster({
  accounts: filler(100), blocked, extra: { accountsTotal: 117, accountsTruncated: true, blockedTotal: 1, blockedTruncated: false }
});

test("F08: a target missing from a TRUNCATED roster is not reported as session-ended", async () => {
  const h = await kickTarget({ lists: crowded(), after: truncatedAfter(), target: undefined });
  assert.doesNotMatch(h.status(), /접속 집계 세션 종료 확인/, "absence from a capped list proves nothing");
  assert.match(h.status(), /종료는 확인할 수 없음/);
});

test("F08: the exact per-account read decides, even when the roster omits the target", async () => {
  const stillThere = await kickTarget({
    lists: crowded(), after: truncatedAfter(),
    target: { userId: TARGET, sessionRows: 2, activeSessions: 2, blockedUntil: later }
  });
  assert.match(stillThere.status(), /집계 세션이 아직 남아 있어 종료는 미확인/);
  assert.doesNotMatch(stillThere.status(), /접속 집계 세션 종료 확인/);

  const gone = await kickTarget({
    lists: crowded(), after: truncatedAfter(),
    target: { userId: TARGET, sessionRows: 0, activeSessions: 0, blockedUntil: later }
  });
  assert.match(gone.status(), /차단 확인됨/);
  assert.match(gone.status(), /접속 집계 세션 종료 확인\(정리 2개\)/);
  assert.match(gone.status(), /확인할 수 없습니다/, "Realtime closure is still stated as unverified");
});

test("F08: stale heartbeat rows are not 'ended' either - sessionRows, not the 70 s window, is the proof", async () => {
  const h = await kickTarget({
    lists: crowded(), after: truncatedAfter(),
    target: { userId: TARGET, sessionRows: 1, activeSessions: 0, blockedUntil: later }
  });
  assert.doesNotMatch(h.status(), /접속 집계 세션 종료 확인/);
});

test("F08: a block cut from a truncated block list is neither confirmed nor denied without the exact read", async () => {
  const h = await kickTarget({
    lists: crowded(), after: roster({ accounts: [], blocked: [], extra: { blockedTotal: 130, blockedTruncated: true, accountsTotal: 0, accountsTruncated: false } }),
    target: undefined
  });
  assert.match(h.status(), /차단을 확인할 수 없습니다/);
  assert.doesNotMatch(h.status(), /차단 확인됨/);
  assert.doesNotMatch(h.status(), /목록에서 확인되지 않았습니다/, "not 'absent' either: the list was cut");
  const exact = await kickTarget({
    lists: crowded(), after: roster({ accounts: [], blocked: [], extra: { blockedTotal: 130, blockedTruncated: true } }),
    target: { userId: TARGET, sessionRows: 0, activeSessions: 0, blockedUntil: later }
  });
  assert.match(exact.status(), /차단 확인됨/);
});

test("F08: restore is confirmed by the exact read, not by absence from a truncated block list", async () => {
  const blockedList = roster({ blocked: [blockedTarget] });
  const afterCut = roster({ blocked: [], extra: { blockedTotal: 130, blockedTruncated: true } });
  const unknown = await restoreTarget({ lists: blockedList, after: afterCut, target: undefined });
  assert.match(unknown.status(), /해제를 확인할 수 없습니다/);
  assert.doesNotMatch(unknown.status(), /해제를 확인했습니다/);
  const lifted = await restoreTarget({ lists: blockedList, after: afterCut, target: { userId: TARGET, sessionRows: 0, activeSessions: 0, blockedUntil: null } });
  assert.match(lifted.status(), /차단 해제를 확인했습니다/);
  const lingering = await restoreTarget({ lists: blockedList, after: afterCut, target: { userId: TARGET, sessionRows: 0, activeSessions: 0, blockedUntil: later } });
  assert.match(lingering.status(), /차단이 아직 목록에 남아 있습니다/);
});

test("F08: an untruncated roster still confirms without the exact read (older server compatibility)", async () => {
  const h = await kickTarget({
    lists: roster({ accounts: [targetAccount] }),
    after: roster({ accounts: [], blocked: [blockedTarget] }),
    target: undefined
  });
  assert.match(h.status(), /접속 집계 세션 종료 확인/);
  assert.match(h.status(), /차단 확인됨/);
});

test("F08: an older server that sends a full 100-row list without flags is treated as possibly truncated", async () => {
  const h = await kickTarget({
    lists: crowded(), after: roster({ accounts: filler(100), blocked: [blockedTarget] }), target: undefined
  });
  assert.match(h.status(), /종료는 확인할 수 없음/);
});

test("F08: the summary tells the operator when the list is cut", async () => {
  const h = scenario({ lists: truncatedAfter(), after: truncatedAfter(), target: undefined });
  await settle();
  assert.match(h.summary(), /상한 100개/);
  assert.match(h.summary(), /117명/);
});

test("F08: the exact read is requested after a command, and the roster is re-read as well", async () => {
  const h = await kickTarget({
    lists: crowded(), after: truncatedAfter(),
    target: { userId: TARGET, sessionRows: 0, activeSessions: 0, blockedUntil: later }
  });
  const kickAt = h.calls.indexOf(KICK);
  assert.ok(kickAt >= 0);
  assert.ok(h.calls.indexOf(TARGET_RPC) > kickAt, "exact per-account read happens after the command");
  assert.ok(h.calls.lastIndexOf(LIST) > kickAt, "the roster is re-read after the command");
});

test("F08: an unavailable exact read never produces a confirmation on a truncated list", async () => {
  const h = await kickTarget({ lists: crowded(), after: truncatedAfter(), target: undefined });
  assert.ok(h.calls.includes(TARGET_RPC), "the read was attempted");
  assert.doesNotMatch(h.status(), /종료 확인\(/);
});
