import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAttendanceClient, parseAttendance, ATTENDANCE_RPC, ATTENDANCE_STATE } from "../src/attendance/attendance-client.js";
import { createAttendancePanel, calendarCells, monthLabel, ATTENDANCE_TEXT } from "../src/attendance/attendance-panel.js";
import { rewardToastMessage, rewardLine } from "../src/events/zombie-university-2026/event-ui.js";

const coinReward = (rewardId, amount) => Object.freeze({
  rewardId, rewardVersion: 1, rewardTransactionId: `tx-${rewardId}`, status: "SUCCESS", replayed: false, completedAt: "2026-09-29T00:00:00Z",
  entries: [{ grantType: "CURRENCY", targetId: "currency.induck_coin", requested: amount, granted: amount, status: "GRANTED", reason: null }]
});
const MILESTONES = [[3, 30], [7, 50], [14, 100], [21, 150]];

// A server stand-in with the P1f contract for one account in September 2026.
function fakeServer({ today = "2026-09-29", attended = [] } = {}) {
  const dates = [...attended];
  const claimedMilestones = new Set(MILESTONES.filter(([d]) => d <= dates.length).map(([d]) => d));
  const calls = [];
  const view = () => {
    const n = dates.length;
    const next = MILESTONES.find(([d]) => d > n);
    return { rewardDate: today, month: today.slice(0, 7), claimedToday: dates.includes(today), attendedDays: n,
      attendedDates: [...dates].sort(), dailyCoin: 10, nextMilestone: next ? { days: next[0], bonusCoin: next[1] } : null,
      milestones: MILESTONES.map(([days, bonusCoin]) => ({ days, bonusCoin, claimed: claimedMilestones.has(days) })) };
  };
  const rpc = async (fn) => {
    calls.push(fn);
    if (fn === ATTENDANCE_RPC.READ) return { data: view(), error: null };
    if (fn === ATTENDANCE_RPC.CLAIM) {
      if (dates.includes(today)) return { data: { ...view(), claimed: false, replayed: true, rewards: [] }, error: null };
      dates.push(today);
      const rewards = [coinReward("reward.attendance.daily", 10)];
      const hit = MILESTONES.find(([d]) => d === dates.length);
      if (hit) { claimedMilestones.add(hit[0]); rewards.push(coinReward(`reward.attendance.monthly_${hit[0]}`, hit[1])); }
      return { data: { ...view(), claimed: true, replayed: false, rewards }, error: null };
    }
    throw new Error(fn);
  };
  return { rpc, calls, dates };
}
const harness = (server = fakeServer()) => {
  const paid = [];
  const attendance = createAttendanceClient({ getClient: () => ({ rpc: server.rpc }), onRewards: (rewards) => paid.push(rewards) });
  return { attendance, paid, server };
};

test("account bind + status refresh read the server status and never claim", async () => {
  const { attendance, server } = harness();
  assert.equal(attendance.state, ATTENDANCE_STATE.SIGNED_OUT);
  await attendance.setAccount("user-a");
  assert.equal(attendance.state, ATTENDANCE_STATE.READY);
  assert.deepEqual([attendance.snapshot.claimedToday, attendance.snapshot.attendedDays, attendance.snapshot.month], [false, 0, "2026-09"]);
  await attendance.refresh();
  await attendance.setAccount("user-a");
  assert.ok(!server.calls.includes(ATTENDANCE_RPC.CLAIM), "no automatic claim on bind / refresh");
});

test("claim success: one daily reward, then replay returns no rewards and no callback", async () => {
  const { attendance, paid } = harness();
  await attendance.setAccount("user-a");
  const first = await attendance.claim();
  assert.equal(first.outcome, "CLAIMED");
  assert.equal(attendance.snapshot.claimedToday, true);
  assert.equal(paid.length, 1);
  assert.deepEqual(paid[0].map(r => r.rewardId), ["reward.attendance.daily"]);
  const again = await attendance.claim();
  assert.equal(again.outcome, "ALREADY_CLAIMED");
  assert.equal(paid.length, 1, "replay never calls onRewards");
});

test("milestone day: two rewards (daily + monthly_3) in one callback", async () => {
  const { attendance, paid } = harness(fakeServer({ attended: ["2026-09-01", "2026-09-10"] }));
  await attendance.setAccount("user-a");
  assert.deepEqual(attendance.snapshot.nextMilestone, { days: 3, bonusCoin: 30 });
  await attendance.claim();
  assert.deepEqual(paid[0].map(r => [r.rewardId, r.entries[0].granted]), [["reward.attendance.daily", 10], ["reward.attendance.monthly_3", 30]]);
  assert.equal(attendance.snapshot.attendedDays, 3);
  assert.equal(attendance.snapshot.milestones[0].claimed, true);
});

test("duplicate click lock: a second claim while one is pending is BUSY and never sent", async () => {
  let release;
  const server = fakeServer();
  const gate = new Promise(resolve => { release = resolve; });
  const attendance = createAttendanceClient({ getClient: () => ({ rpc: async (fn) => { if (fn === ATTENDANCE_RPC.CLAIM) await gate; return server.rpc(fn); } }) });
  await attendance.setAccount("user-a");
  const first = attendance.claim();
  assert.equal((await attendance.claim()).outcome, "BUSY");
  release();
  assert.equal((await first).outcome, "CLAIMED");
  assert.equal(server.calls.filter(c => c === ATTENDANCE_RPC.CLAIM).length, 1);
});

test("logout / account switch: no late status or rewards from the old account", async () => {
  let release;
  const server = fakeServer();
  const gate = new Promise(resolve => { release = resolve; });
  const paid = [];
  const attendance = createAttendanceClient({ getClient: () => ({ rpc: async (fn) => { if (fn === ATTENDANCE_RPC.CLAIM) await gate; return server.rpc(fn); } }),
    onRewards: (r) => paid.push(r) });
  await attendance.setAccount("user-a");
  const pending = attendance.claim();
  await attendance.setAccount("user-b");
  release();
  assert.equal((await pending).outcome, "STALE");
  assert.equal(paid.length, 0);
  await attendance.setAccount(null);
  assert.equal(attendance.state, ATTENDANCE_STATE.SIGNED_OUT);
  assert.equal(attendance.snapshot, null);
});

test("malformed responses are rejected: no rewards shown, status re-read", async () => {
  const base = fakeServer();
  const good = (await base.rpc(ATTENDANCE_RPC.READ)).data;
  assert.equal(parseAttendance({ ...good, attendedDates: ["2026-09-30"], attendedDays: 1 }), null, "no future dates");
  assert.equal(parseAttendance({ ...good, attendedDates: ["2026-08-31"], attendedDays: 1 }), null, "only this month");
  assert.equal(parseAttendance({ ...good, attendedDays: 2 }), null, "count must match the dates");
  assert.equal(parseAttendance({ ...good, claimedToday: true }), null, "claimedToday must match the dates");
  assert.equal(parseAttendance({ ...good, milestones: good.milestones.slice(1) }), null);
  const paid = [];
  const attendance = createAttendanceClient({ getClient: () => ({ rpc: async (fn) => fn === ATTENDANCE_RPC.READ ? base.rpc(fn)
    : { data: { ...good, claimedToday: true, attendedDays: 1, attendedDates: ["2026-09-29"], claimed: true, replayed: false,
        rewards: [{ ...coinReward("reward.attendance.daily", 10), status: "FAILED" }] }, error: null } }), onRewards: (r) => paid.push(r) });
  await attendance.setAccount("user-a");
  const result = await attendance.claim();
  assert.equal(result.code, "MALFORMED_RESPONSE");
  assert.equal(paid.length, 0);
});

test("month change: the server's new month resets the view to 0 without touching the old month", async () => {
  const server = fakeServer({ today: "2026-09-30", attended: ["2026-09-01", "2026-09-02"] });
  const { attendance } = harness(server);
  await attendance.setAccount("user-a");
  assert.equal(attendance.snapshot.attendedDays, 2);
  const october = fakeServer({ today: "2026-10-01" });
  const next = createAttendanceClient({ getClient: () => ({ rpc: october.rpc }) });
  await next.setAccount("user-a");
  assert.deepEqual([next.snapshot.month, next.snapshot.attendedDays, next.snapshot.claimedToday], ["2026-10", 0, false]);
  assert.equal(monthLabel("2026-10"), "2026년 10월");
});

test("calendar cells come from the server month: stamps for attended days, future days flagged", () => {
  const snapshot = parseAttendance({ rewardDate: "2026-09-29", month: "2026-09", claimedToday: true, attendedDays: 2,
    attendedDates: ["2026-09-03", "2026-09-29"], dailyCoin: 10, nextMilestone: { days: 3, bonusCoin: 30 },
    milestones: MILESTONES.map(([days, bonusCoin]) => ({ days, bonusCoin, claimed: false })) });
  const cells = calendarCells(snapshot);
  assert.equal(cells.filter(c => c === null).length, 2, "2026-09-01 is a Tuesday");
  assert.equal(cells.filter(Boolean).length, 30);
  assert.deepEqual(cells.filter(c => c?.attended).map(c => c.day), [3, 29]);
  assert.deepEqual(cells.filter(c => c?.future).map(c => c.day), [30]);
});

test("toasts: daily through the reward toast, milestone as a queued 누적 출석 보상 line", () => {
  assert.equal(rewardToastMessage({ status: "CLAIMED", rewardResult: { status: "SUCCESS", entries: coinReward("reward.attendance.daily", 10).entries } }).text,
    "🎁 보상 획득\n+10 인덕코인");
  assert.equal(["누적 출석 보상", ...coinReward("reward.attendance.monthly_3", 30).entries.map(rewardLine)].join("\n"), "누적 출석 보상\n+30 인덕코인");
});

function fakeDoc() {
  const make = (tag) => ({ tagName: tag, children: [], dataset: {}, hidden: false, disabled: false, textContent: "", className: "", listeners: {},
    append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, focus() {}, click() { return this.listeners.click?.(); } });
  return { createElement: make, addEventListener() {}, make };
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map(n => n.textContent).filter(Boolean).join("|");

test("panel: unclaimed → 오늘 출석하기 → ✅ 오늘 출석 완료 and next-milestone distance", async () => {
  const doc = fakeDoc();
  const panel = doc.make("section");
  const { attendance, server } = harness(fakeServer({ attended: ["2026-09-01"] }));
  const ui = createAttendancePanel({ panel, attendance, doc });
  await attendance.setAccount("user-a");
  ui.setOpen(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(text(panel), /📅 캠퍼스 출석부\|2026년 9월\|이번 달 1일 출석/);
  assert.match(text(panel), /오늘 출석 🪙 \+10\|누적 3일 🪙 \+30\|오늘 출석하기/);
  assert.ok(!server.calls.includes(ATTENDANCE_RPC.CLAIM), "opening the panel never claims");
  await all(panel).find(n => n.textContent === ATTENDANCE_TEXT.claim).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(text(panel), /✅ 오늘 출석 완료\|다음 보상: 3일 출석까지 1일/);
  assert.equal(all(panel).some(n => n.textContent === ATTENDANCE_TEXT.claim), false, "no claim button once claimed");
  assert.match(text(panel), /3일\|○\|\+30\|7일\|○\|\+50\|14일\|○\|\+100\|21일\|○\|\+150/);
  assert.doesNotMatch(text(panel), /연속|streak/i, "no streak wording");
});

test("main.js wiring: ☰ 📅 출석부, own BLOCKING_UI owner, account binding, wallet-only re-read", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const inputRuntime = await readFile(new URL("../src/input/world-input-runtime.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../campus/index.html", import.meta.url), "utf8");
  assert.match(html, /id="hud-menu"[\s\S]*id="open-attendance"[^>]*>📅 출석부<\/button>/);
  assert.match(html, /id="attendance-panel"[^>]*role="dialog"/);
  assert.match(inputRuntime, /"attendance", INPUT_FOCUS_POLICY\.BLOCKING_UI/);
  assert.match(main, /void attendance\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  const block = main.slice(main.indexOf("const attendance = createAttendanceClient"), main.indexOf("\n});", main.indexOf("const attendance = createAttendanceClient")));
  assert.match(block, /mcmEventUi\.showReward\(/);
  assert.match(block, /누적 출석 보상/);
  assert.match(block, /wallet\.refresh\("reward"\)/);
  assert.doesNotMatch(block, /progression\.refresh|inventory\.refresh|\+ *(10|30|50|100|150)\b|Date|balance/, "coin only, no client math");
  assert.equal((main.match(/attendancePanel\.setOpen\(false\)/g) ?? []).length >= 6, true, "one modal at a time");
  const client = await readFile(new URL("../src/attendance/attendance-client.js", import.meta.url), "utf8");
  assert.doesNotMatch(client, /Date\.now|new Date|localStorage|Intl\./, "the client never decides the day");
});
