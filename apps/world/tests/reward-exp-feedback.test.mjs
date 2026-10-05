// INHA WORLD Progression P1a · Reward EXP detail feedback (+N EXP).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rewardExpLine } from "../src/progression/reward-exp-line.js";
import { rewardLine, rewardToastMessage } from "../src/events/zombie-university-2026/event-ui.js";
import { levelUpMessage } from "../src/progression/progression-hud.js";
import { PROGRESSION_STATE } from "../src/progression/progression-client.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/^\s*\/\/.*$/gm, "");
const coin = (amount = 120) => ({ grantType: "CURRENCY", targetId: "INDUCK_COIN", requested: amount, granted: amount, status: "GRANTED", reason: null });
const item = (status = "GRANTED") => ({ grantType: "ITEM", targetId: "badge.mcm_2026_landlord", requested: 1, granted: status === "GRANTED" ? 1 : 0, status, reason: status === "GRANTED" ? null : "ALREADY_OWNED" });
const exp = (amount = 50, extra = {}) => ({ grantType: "EXP", targetId: "EXP", requested: amount, granted: amount, status: "GRANTED", reason: null, ...extra });
const claimed = (entries, extra = {}) => ({ claimType: "MAIN_CLEAR", status: "CLAIMED", replayed: false, rewardStatus: "SUCCESS", rewardResult: { status: "SUCCESS", entries }, ...extra });

test("1. CURRENCY line is unchanged", () => {
  assert.equal(rewardLine(coin(120)), "+120 인덕코인");
  assert.equal(rewardLine({ ...coin(80), granted: 0 }), "+80 인덕코인");
});

test("2. ITEM granted line is unchanged", () => {
  assert.equal(rewardLine(item()), "건물주 챌린지 배지 획득");
});

test("3. ITEM skipped line is unchanged", () => {
  assert.equal(rewardLine(item("SKIPPED")), "건물주 챌린지 배지 · 이미 보유");
});

test("4. EXP GRANTED → +50 EXP", () => {
  assert.equal(rewardExpLine(exp(50)), "+50 EXP");
  assert.equal(rewardLine(exp(50)), "+50 EXP");
});

test("5. EXP uses World thousands separators", () => {
  assert.equal(rewardLine(exp(1000)), "+1,000 EXP");
  assert.equal(rewardLine(exp(1234567)), "+1,234,567 EXP");
});

test("5b. EXP amount is the server-settled granted value, never requested", () => {
  assert.equal(rewardLine(exp(50, { requested: 999 })), "+50 EXP");
});

test("6. CURRENCY + ITEM + EXP keeps the server entry order under the reward heading", () => {
  assert.equal(rewardToastMessage(claimed([coin(120), item(), exp(50)])).text,
    "🎁 보상 획득\n+120 인덕코인\n건물주 챌린지 배지 획득\n+50 EXP");
  assert.equal(rewardToastMessage(claimed([exp(50), coin(120)])).text,
    "🎁 보상 획득\n+50 EXP\n+120 인덕코인");
});

test("7. without an EXP entry the toast is exactly the previous output", () => {
  const message = rewardToastMessage(claimed([coin(120), item("SKIPPED")]));
  assert.deepEqual(message, { text: "🎁 보상 획득\n+120 인덕코인\n건물주 챌린지 배지 · 이미 보유", ms: 4500 });
  assert.doesNotMatch(message.text, /EXP/);
});

test("8. PREVIEW shows no EXP, even if entries were present", () => {
  const message = rewardToastMessage({ status: "PREVIEW", replayed: false, rewardResult: { entries: [exp(50)] } });
  assert.equal(message.text, "🧪 QA PREVIEW · 실제 보상은 지급되지 않습니다.");
  assert.doesNotMatch(message.text, /EXP/);
});

test("9. REWARD_FAILED keeps the failure notice and shows no +EXP (partial siblings included)", () => {
  const message = rewardToastMessage({
    status: "REWARD_FAILED", replayed: false, rewardStatus: "FAILED",
    rewardResult: { status: "FAILED", entries: [coin(120), exp(50), { ...exp(50), status: "FAILED", granted: 0, reason: "EXP_READBACK_FAILED" }] }
  });
  assert.equal(message.text, "보상 정산에 실패했어요. 완료 기록은 보존됐으며 다시 시도할 수 있습니다.");
  assert.doesNotMatch(message.text, /EXP|READBACK/);
});

test("9b. a FAILED or SKIPPED EXP entry never reads as earned and never leaks the server reason", () => {
  assert.equal(rewardLine({ ...exp(50), status: "FAILED", granted: 0, reason: "EXP_READBACK_FAILED" }), null);
  assert.equal(rewardLine({ ...exp(50), status: "SKIPPED", granted: 0, reason: "SOMETHING" }), null);
  const text = rewardToastMessage(claimed([coin(10), { ...exp(50), status: "FAILED", granted: 0, reason: "EXP_READBACK_FAILED" }])).text;
  assert.equal(text, "🎁 보상 획득\n+10 인덕코인");
});

test("10. ALREADY_CLAIMED / replayed keeps the settled heading, never the new-reward heading", () => {
  const message = rewardToastMessage({ ...claimed([coin(120), exp(50)]), status: "ALREADY_CLAIMED", replayed: true });
  assert.equal(message.text, "이미 정산된 보상입니다\n+120 인덕코인\n+50 EXP");
  assert.doesNotMatch(message.text, /🎁 보상 획득/);
});

test("11. malformed EXP entries produce no raw / NaN text", () => {
  for (const granted of [null, undefined, 0, -5, Number.NaN, Infinity, 1.5, "50", {}, 2 ** 60]) {
    assert.equal(rewardLine(exp(50, { granted })), null, `granted=${String(granted)}`);
  }
  assert.equal(rewardExpLine(null), null);
  assert.equal(rewardExpLine({ ...exp(50), grantType: "CURRENCY" }), null);
  const text = rewardToastMessage(claimed([exp(50, { granted: Number.NaN }), null, coin(5)])).text;
  assert.equal(text, "🎁 보상 획득\n+5 인덕코인");
  assert.doesNotMatch(text, /NaN|undefined|null|\[object/);
});

test("12. reward presentation never touches progression state", () => {
  const result = claimed([exp(50)]);
  const before = JSON.stringify(result);
  rewardToastMessage(result);
  assert.equal(JSON.stringify(result), before, "result is not mutated");
  const helper = code("../src/progression/reward-exp-line.js");
  assert.doesNotMatch(helper, /\bimport\b|totalExp|\.level\b|refresh\(/);
  const ui = code("../src/events/zombie-university-2026/event-ui.js");
  assert.doesNotMatch(ui, /progression\.|totalExp|progression-client/);
});

test("13. MCM onReward keeps the progression / wallet / inventory / loadout server re-reads", () => {
  const main = read("../src/main.js");
  const start = main.indexOf("onReward: result => {");
  assert.ok(start > 0);
  const body = main.slice(start, main.indexOf("\n  }\n});", start));
  assert.match(body, /mcmEventUi\.showReward\(result\)/);
  assert.match(body, /result\.status !== "PREVIEW"/);
  for (const client of ["progression", "wallet", "inventory", "loadout"]) {
    assert.match(body, new RegExp(`void ${client}\\.refresh\\("reward"\\)`), client);
  }
  assert.doesNotMatch(body, /totalExp|\.level\b|rewardExpLine/);
});

test("14. LEVEL UP toast still comes only from two READY server snapshots", () => {
  const previous = { level: 1, totalExp: 80 };
  const snapshot = { level: 2, totalExp: 130 };
  assert.equal(levelUpMessage({ state: PROGRESSION_STATE.READY, snapshot, previous }), "LEVEL UP · Lv.2");
  assert.equal(levelUpMessage({ state: PROGRESSION_STATE.READY, snapshot: previous, previous }), null);
  const main = read("../src/main.js");
  assert.match(main, /const message = levelUpMessage\(change\);\s*if \(message\) showWorldStatusAfterReward\(message\);/);
});

test("16. LEVEL UP and the retry hint wait for the reward toast instead of showing underneath it", () => {
  const main = code("../src/main.js");
  assert.match(main, /let rewardToastRemainingMs = \(\) => 0;/);
  assert.match(main, /rewardToastRemainingMs = \(\) => mcmEventUi\.toastRemainingMs\(\);/);
  // P1c0: re-checked right before showing (behaviour and the late-enqueue race: tests/reward-toast-queue.test.mjs).
  assert.match(main, /const showWorldStatusAfterReward = createStatusAfterReward\(\{\s*remainingMs: \(\) => rewardToastRemainingMs\(\),\s*show: showWorldStatus\s*\}\);/);
  assert.match(main, /REWARD_FAILED"\) showWorldStatusAfterReward\("보상 정산을 다시 시도할 수 있어요\."\)/);
  const ui = code("../src/events/zombie-university-2026/event-ui.js");
  assert.match(ui, /function toastRemainingMs\(\)\{return toastQueue\.remainingMs\(\);\}/);
  assert.match(ui, /showReward,toastRemainingMs,/);
  // Display-only toast: never swallows taps meant for the controls under it; full width on phones.
  assert.match(ui, /\.mcm26-toast\{[^}]*width:max-content;[^}]*pointer-events:none\}/);
});
