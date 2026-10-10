import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fishingEffectLines, createLifeSkillBookPanel, LIFE_SKILL_BOOK_TEXT } from "../src/life-skills/life-skill-book-panel.js";
import { LIFE_SKILL_BOOK_STATE as STATE } from "../src/life-skills/life-skill-book-client.js";
import { LIFE_SKILL_TREE_REGISTRY } from "../src/life-skills/life-progression-registry.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const node = (key, rank = 0, extra = {}) => ({ nodeId: `life.node.fishing.${key}`, rank, maxRank: 3,
  nextRankCost: rank < 3 ? 1 : null, requiredSkillLevel: key === "steady_hands" ? 2 : 3, prerequisites: [],
  canUnlock: rank < 3, lockReason: rank < 3 ? null : "MAX_RANK", ...extra });
const elements = root => [root, ...(root.children ?? []).flatMap(elements)];
const text = root => elements(root).map(el => el.textContent).join(" ");
const classes = (root, name) => elements(root).filter(el => el.className.split(" ").includes(name));

for (const [key, sign, name] of [["steady_hands", "+", "반응"], ["fish_sense", "-", "입질 대기"]]) {
  for (const rank of [0, 1, 2, 3]) {
    test(`${key} rank ${rank}: per-rank, owned, next and max are exact P1 modifiers`, () => {
      const lines = fishingEffectLines(node(key, rank));
      assert.match(lines[0], /랭크당/);
      assert.ok(lines[0].includes(`${sign}250ms`));
      assert.ok(lines[1].includes(`현재 · 랭크 ${rank}/3`));
      assert.ok(lines[1].includes(rank ? `${name} 시간 ${sign}${rank * 250}ms` : "미보유 (효과 없음)"));
      assert.ok(lines[2].includes(rank === 3 ? "최대 단계에 도달했어요" : `다음 · 랭크 ${rank + 1}/3 · ${name} 시간 ${sign}${(rank + 1) * 250}ms`));
      assert.ok(lines[3].includes(`최대 · 랭크 3/3 · ${name} 시간 ${sign}750ms`));
      assert.doesNotMatch(lines.join(" "), /1000ms|NaN|undefined|희귀|성공률|보상/);
      if (key === "fish_sense") assert.match(lines[4], /최솟값·최댓값.*1ms 미만으로 줄어들지/);
    });
  }
}

test("unimplemented, unknown and incompatible node contracts never claim an effect", () => {
  for (const key of ["baitcraft", "rare_fish_sense", "boat_fishing", "deep_sea_fishing", "unknown"])
    assert.deepEqual(fishingEffectLines(node(key)), []);
  for (const invalid of [null, {}, { nodeId: "__proto__" }, node("steady_hands", -1), node("steady_hands", 4),
    node("steady_hands", 1.5), node("steady_hands", "1"), node("steady_hands", 1, { maxRank: 4 })])
    assert.deepEqual(fishingEffectLines(invalid), []);
});

test("display values match the server SQL and Registry contract (static, no DB calls)", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20261005185000_world_fishing_skill_effects_p1.sql", import.meta.url), "utf8");
  assert.match(sql, /'responseWindowBonusMs',v_steady \* 250/);
  assert.match(sql, /'waitReductionMs',v_sense \* 250/);
  assert.match(sql, /v_steady not between 0 and 3 or v_sense not between 0 and 3/);
  assert.match(sql, /v_min := greatest\(1::bigint,\(p_policy->>'minWaitMs'\)::bigint-v_wait_reduction\)/);
  assert.match(sql, /v_max := greatest\(v_min,\(p_policy->>'maxWaitMs'\)::bigint-v_wait_reduction\)/);
  assert.match(sql, /v_effects := private.world_fishing_skill_effects_v1\(p_user\)/);
  for (const key of ["steady_hands", "fish_sense"]) {
    const definition = LIFE_SKILL_TREE_REGISTRY.get(node(key).nodeId);
    assert.equal(definition.status, "ACTIVE");
    assert.equal(definition.maxRank, 3);
  }
});

function harness() {
  const doc = createFakeDocument(), panel = doc.createElement("section");
  const skill = { skillId: "life.fishing", level: 5, totalXp: 1000, nextLevelXp: 1500,
    sp: { earned: 5, spent: 0, available: 5 } };
  const book = { state: STATE.READY, book: { lifeLevel: { level: 1 }, skills: [skill] },
    selectedSkillId: "life.fishing", treeState: STATE.READY, pending: false,
    tree: { skill, nodes: [node("steady_hands"), node("fish_sense")],
      reset: { canReset: false, resetBlockedBy: "EMPTY" } },
    onChange() {}, clearSelection() { this.selectedSkillId = null; },
    unlockNode() { throw new Error("Rendering must never unlock a node"); },
    resetTree() { throw new Error("Rendering must never reset a tree"); } };
  const ui = createLifeSkillBookPanel({ panel, doc, book });
  ui.setOpen(true);
  return { panel, book, ui };
}

test("the read-only panel shows effects without changing server-owned locks, cost or actions", () => {
  const { panel, book, ui } = harness();
  book.tree.nodes[1] = node("fish_sense", 0, { canUnlock: false, lockReason: "SP", nextRankCost: 2 });
  const before = JSON.stringify(book.tree);
  ui.render();
  assert.match(text(panel), /다음 랭크 SP 2.*SP 2 필요/);
  assert.deepEqual(classes(panel, "life-node-unlock").map(el => el.disabled), [false, true]);
  assert.equal(classes(panel, "life-tree-effect-timing").length, 1);
  assert.match(text(panel), /다음 낚시 시작부터 적용돼요.*진행 중인 낚시는 바뀌지/);
  assert.equal(JSON.stringify(book.tree), before);
  book.tree.nodes = [node("steady_hands", 3), node("fish_sense", 2)];
  ui.render();
  assert.match(text(panel), /현재 · 랭크 3\/3 · 반응 시간 \+750ms/);
  assert.match(text(panel), /현재 · 랭크 2\/3 · 입질 대기 시간 -500ms/);
  assert.deepEqual(classes(panel, "life-node-unlock").map(el => el.disabled), [true, false]);
  book.tree.nodes = [node("steady_hands"), node("fish_sense")];
  ui.render();
  assert.equal(classes(panel, "life-node-effect").filter(el => el.textContent.includes("미보유")).length, 2,
    "a server reset view immediately returns owned modifiers to zero");
});

test("errors, initial loading, signed-out and empty views never show guessed effect copy", () => {
  for (const [state, treeState, expected] of [
    [STATE.LOADING, null, LIFE_SKILL_BOOK_TEXT.loading],
    [STATE.UNAVAILABLE, null, LIFE_SKILL_BOOK_TEXT.unavailable],
    [STATE.SIGNED_OUT, null, LIFE_SKILL_BOOK_TEXT.signedOut],
    [STATE.READY, STATE.LOADING, LIFE_SKILL_BOOK_TEXT.treeLoading],
    [STATE.READY, STATE.UNAVAILABLE, LIFE_SKILL_BOOK_TEXT.treeUnavailable]
  ]) {
    const { panel, book, ui } = harness();
    Object.assign(book, { state, treeState, tree: null });
    ui.render();
    assert.ok(text(panel).includes(expected));
    assert.equal(classes(panel, "life-node-effect").length, 0);
    assert.equal(classes(panel, "life-tree-effect-timing").length, 0);
  }
  const { panel, book, ui } = harness();
  book.selectedSkillId = null;
  book.book.skills = [];
  ui.render();
  assert.ok(text(panel).includes(LIFE_SKILL_BOOK_TEXT.empty));
  assert.equal(classes(panel, "life-node-effect").length, 0);
  book.selectedSkillId = "life.fishing";
  book.tree.nodes = [node("rare_fish_sense")];
  ui.render();
  assert.equal(classes(panel, "life-node-effect").length, 0);
  assert.equal(classes(panel, "life-tree-effect-timing").length, 0);
});
