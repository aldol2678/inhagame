import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROGRESSION_STATE } from "../src/progression/progression-client.js";
import { createProgressionHud, formatProgression, levelUpMessage } from "../src/progression/progression-hud.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const FRESH = { totalExp: 0, level: 1, currentLevelStartExp: 0, nextLevelExp: 100, progressExp: 0, progressRequired: 100, maxDefinedLevel: 10, isMaxLevel: false };
const MID = { totalExp: 145, level: 2, currentLevelStartExp: 100, nextLevelExp: 300, progressExp: 45, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false };
const MAX = { totalExp: 5240, level: 10, currentLevelStartExp: 4500, nextLevelExp: null, progressExp: 740, progressRequired: null, maxDefinedLevel: 10, isMaxLevel: true };

function dom() {
  const doc = createFakeDocument();
  const el = (tag = "span") => Object.assign(doc.createElement(tag), { style: {} });
  const parts = {
    pill: el("div"), pillLevel: el("strong"), pillExp: el(), pillBar: el(), pillFill: el("i"),
    badge: el(), badgeLevel: el(), badgeBar: el(), badgeFill: el("i"),
    menuLine: el("p")
  };
  return { parts, hud: createProgressionHud(parts) };
}

test("format: fresh account is Lv.1 0 / 100 EXP with an empty bar", () => {
  assert.deepEqual(formatProgression(FRESH), {
    levelText: "Lv.1", expText: "0 / 100 EXP", fullText: "Lv.1 0 / 100 EXP", ratio: 0, max: false
  });
});

test("format: mid-level shows the server total and next threshold; bar is progressExp / progressRequired", () => {
  const view = formatProgression(MID);
  assert.equal(view.fullText, "Lv.2 145 / 300 EXP");
  assert.equal(view.ratio, 45 / 200);
});

test("format: highest defined Level invents no next threshold", () => {
  assert.deepEqual(formatProgression(MAX), {
    levelText: "Lv.10", expText: "5,240 EXP", fullText: "Lv.10 · 5,240 EXP", ratio: null, max: true
  });
});

test("format: Level is the server value, never recomputed from EXP", () => {
  // A deliberately inconsistent snapshot: the HUD must not re-derive Lv.10 from 5,000 EXP.
  const view = formatProgression({ ...MID, totalExp: 5000 });
  assert.equal(view.levelText, "Lv.2");
  assert.equal(view.expText, "5,000 / 300 EXP");
  assert.equal(view.ratio, 45 / 200, "the bar follows server progress fields, not a client curve");
});

test("render: READY fills pill, badge and menu line; other states hide the HUD", () => {
  const { parts, hud } = dom();
  assert.equal(parts.pill.hidden, true, "hidden until the first server snapshot");
  assert.equal(parts.menuLine.hidden, true);

  hud.render(PROGRESSION_STATE.READY, MID);
  assert.equal(parts.pill.hidden, false);
  assert.equal(parts.pillLevel.textContent, "Lv.2");
  assert.equal(parts.pillExp.textContent, "145 / 300 EXP");
  assert.equal(parts.pillFill.style.width, "22.5%");
  assert.equal(parts.badge.hidden, false);
  assert.equal(parts.badgeLevel.textContent, "Lv.2");
  assert.equal(parts.badgeFill.style.width, "22.5%");
  assert.equal(parts.menuLine.textContent, "진행도 Lv.2 145 / 300 EXP");
  assert.equal(parts.pill.getAttribute("aria-label"), "진행도 Lv.2 145 / 300 EXP");

  hud.render(PROGRESSION_STATE.READY, MAX);
  assert.equal(parts.pillExp.textContent, "5,240 EXP");
  assert.equal(parts.pillBar.hidden, true, "no progress bar at the highest Level");
  assert.equal(parts.badgeBar.hidden, true);
  assert.equal(parts.pill.dataset.max, "true");

  for (const state of [PROGRESSION_STATE.SIGNED_OUT, PROGRESSION_STATE.LOADING]) {
    hud.render(state, null);
    assert.equal(parts.pill.hidden, true, state);
    assert.equal(parts.badge.hidden, true, state);
    assert.equal(parts.menuLine.hidden, true, state);
  }
  hud.render(PROGRESSION_STATE.UNAVAILABLE, null);
  assert.equal(parts.pill.hidden, true);
  assert.equal(parts.menuLine.hidden, false);
  assert.equal(parts.menuLine.textContent, "진행도를 불러오지 못했어요");
});

test("render: a READY state without a snapshot shows nothing", () => {
  const { parts, hud } = dom();
  hud.render(PROGRESSION_STATE.READY, null);
  assert.equal(parts.pill.hidden, true);
});

test("HUD requires its full DOM contract", () => {
  assert.throws(() => createProgressionHud({}), /DOM contract/);
});

test("level-up message needs a same-account READY transition to a higher Level", () => {
  assert.equal(levelUpMessage({ state: "READY", snapshot: MID, previous: FRESH }), "LEVEL UP · Lv.2");
  assert.equal(levelUpMessage({ state: "READY", snapshot: MID, previous: null }), null, "first fetch");
  assert.equal(levelUpMessage({ state: "READY", snapshot: MID, previous: MID }), null, "same Level");
  assert.equal(levelUpMessage({ state: "READY", snapshot: FRESH, previous: MID }), null, "never downward");
  assert.equal(levelUpMessage({ state: "UNAVAILABLE", snapshot: null, previous: MID }), null);
  assert.equal(levelUpMessage(null), null);
});

test("client code holds no threshold table and calls only the progression read RPC", () => {
  for (const file of ["../src/progression/progression-client.js", "../src/progression/progression-hud.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b100\s*,\s*300\b|\b300\s*,\s*600\b|min_?total_?exp|\bthresholds?\s*[=:[]/i,
      `${file} has no Level curve or threshold table`);
    assert.doesNotMatch(source, /world_exp_grant|world_progression_get_v1|world_exp_apply/, `${file} has no write or server-only RPC`);
  }
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /get_my_world_progression_v1/, "main.js goes through the progression client only");
  assert.match(main, /createProgressionClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/,
    "progression reuses the member client from the online layer; no new Supabase client");
});
