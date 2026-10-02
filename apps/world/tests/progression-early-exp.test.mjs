// INHA WORLD Progression Content P1b · the first production EXP reaches the existing P1a feedback.
// The claim results below have the exact shape the MCM player claim RPCs return after the P1b
// migration (verified against the disposable database in
// supabase/tests/integration/mcm-completion.integration.test.mjs). No new UI and no client EXP math.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rewardToastMessage } from "../src/events/zombie-university-2026/event-ui.js";
import { levelUpMessage } from "../src/progression/progression-hud.js";
import { PROGRESSION_STATE } from "../src/progression/progression-client.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const entry = (grantType, targetId, amount, status = "GRANTED") =>
  ({ grantType, targetId, requested: amount, granted: status === "GRANTED" ? amount : 0, status, reason: null });
const claim = (claimType, entries, status = "CLAIMED") => ({
  claimType, status, replayed: status === "ALREADY_CLAIMED", rewardStatus: "SUCCESS",
  rewardResult: { status: "SUCCESS", entries }
});
const LANDLORD = claim("LANDLORD_FIRST_CLEAR", [entry("ITEM", "badge.mcm_2026_landlord", 1), entry("EXP", "exp.campus", 50)]);
const MAIN = claim("MAIN_CLEAR", [
  entry("CURRENCY", "currency.induck_coin", 80), entry("ITEM", "top.mcm_2026_survivor", 1),
  entry("ITEM", "furniture.mcm_2026_poster", 1), entry("EXP", "exp.campus", 150)
]);

test("landlord first clear: badge line then +50 EXP", () => {
  assert.equal(rewardToastMessage(LANDLORD).text, "🎁 보상 획득\n건물주 챌린지 배지 획득\n+50 EXP");
});

test("MCM main clear: unchanged coin / item lines then +150 EXP", () => {
  assert.equal(rewardToastMessage(MAIN).text,
    "🎁 보상 획득\n+80 인덕코인\n좀비대학교 생존자 상의 획득\n2026 일일호프 포스터 획득\n+150 EXP");
});

test("replayed claims keep the settled heading", () => {
  assert.equal(rewardToastMessage({ ...MAIN, status: "ALREADY_CLAIMED", replayed: true }).text.split("\n")[0], "이미 정산된 보상입니다");
});

test("LEVEL UP stays server-derived: 150 → 300 EXP is Lv.2 → Lv.3 only because the server snapshot says so", () => {
  const previous = { totalExp: 150, level: 2 };
  assert.equal(levelUpMessage({ state: PROGRESSION_STATE.READY, previous, snapshot: { totalExp: 300, level: 3 } }), "LEVEL UP · Lv.3");
  assert.equal(levelUpMessage({ state: PROGRESSION_STATE.READY, previous, snapshot: { totalExp: 300, level: 2 } }), null,
    "a server Level that did not rise shows nothing, whatever the EXP");
});

test("reward wiring is unchanged: one progression re-read per claim, wallet / inventory / loadout re-reads kept", () => {
  const main = read("../src/main.js");
  const body = main.slice(main.indexOf("onReward: result => {"), main.indexOf("\n  }\n});", main.indexOf("onReward: result => {")));
  assert.equal(body.match(/progression\.refresh\("reward"\)/g)?.length, 1);
  for (const client of ["wallet", "inventory", "loadout"]) assert.match(body, new RegExp(`void ${client}\\.refresh\\("reward"\\)`));
});

test("the client holds no production EXP amount or reward table", () => {
  for (const path of ["../src/progression/reward-exp-line.js", "../src/events/zombie-university-2026/event-ui.js",
    "../src/progression/progression-client.js", "../src/progression/progression-hud.js"]) {
    const code = read(path);
    assert.doesNotMatch(code, /exp\.campus|reward\.(quest|minigame|event)\.|\b(100|150)\b.*EXP/, path);
  }
});
