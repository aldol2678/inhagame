import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_SKILL_BOOK_RPC,
  LIFE_SKILL_BOOK_STATE,
  createLifeSkillBookClient,
  lifeSkillBookErrorCode,
  parseLifeSkillList,
  parseLifeSkillTree
} from "../src/life-skills/life-skill-book-client.js";
import { LIFE_SKILL_BOOK_TEXT, createLifeSkillBookPanel, lockText, nodeName, xpLine } from "../src/life-skills/life-skill-book-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const REQ = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"];

const skill = (extra = {}) => ({
  skillId: "life.fishing", level: 5, totalXp: 1000, currentLevelStartXp: 1000, nextLevelXp: 1500,
  maxDefinedLevel: 20, isMaxLevel: false, sp: { earned: 5, spent: 0, available: 5, nextLevelEarned: 6 }, ...extra
});
const list = (...skills) => ({ lifeLevel: { level: 1, totalSkillXp: 1000 }, skills });
const node = (key, extra = {}) => ({
  nodeId: `life.node.fishing.${key}`, rank: 0, maxRank: 3, nextRankCost: 1, requiredSkillLevel: 2,
  prerequisites: [], canUnlock: true, lockReason: null, ...extra
});
const tree = (nodes, reset = {}, skillExtra = {}) => ({
  skill: skill(skillExtra),
  reset: { cost: 0, cooldownSeconds: 86400, lastResetAt: null, nextResetAt: null, canReset: false, resetBlockedBy: "EMPTY", ...reset },
  nodes
});

function fakeClient() {
  const calls = [];
  const queue = new Map();
  return {
    calls,
    respond(fn, value) { if (!queue.has(fn)) queue.set(fn, []); queue.get(fn).push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.get(fn)?.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      return next instanceof Promise ? next : Promise.resolve(next);
    },
    count: (fn) => calls.filter((c) => c.fn === fn).length
  };
}
function harness() {
  const client = fakeClient();
  let i = 0;
  const book = createLifeSkillBookClient({ getClient: () => client, requestIdFactory: () => REQ[i++] });
  return { client, book };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

test("parsers accept the documented server views and refuse anything else", () => {
  assert.equal(parseLifeSkillList(list(skill())).skills[0].sp.available, 5);
  assert.equal(parseLifeSkillList(list(skill({ sp: { earned: 5, spent: 1, available: 5, nextLevelEarned: 6 } }))), null,
    "available must equal earned - spent");
  assert.equal(parseLifeSkillList(list(skill(), skill())), null, "duplicate skills are refused");
  assert.equal(parseLifeSkillList(list(skill({ isMaxLevel: true }))), null, "max level must match nextLevelXp");
  assert.ok(parseLifeSkillTree(tree([node("steady_hands")])));
  assert.equal(parseLifeSkillTree(tree([node("a", { canUnlock: true, lockReason: "SP" })])), null);
  assert.equal(parseLifeSkillTree(tree([node("a", { canUnlock: false, lockReason: "BECAUSE" })])), null);
  assert.equal(parseLifeSkillTree(tree([node("a", { rank: 3, nextRankCost: 1 })])), null, "a maxed node has no next cost");
  assert.equal(parseLifeSkillTree(tree([], { cost: 5 })), null, "a reset is free");
  assert.equal(parseLifeSkillTree(tree([], { canReset: true, resetBlockedBy: "EMPTY" })), null);
  assert.equal(lifeSkillBookErrorCode({ message: "LIFE_SP_INSUFFICIENT" }), "LIFE_SP_INSUFFICIENT");
  assert.equal(lifeSkillBookErrorCode({ message: "fetch failed" }), null);
});

test("an account with no visible skill has an empty book (the menu entry stays hidden)", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(), error: null });
  await book.setAccount(A);
  assert.equal(book.state, LIFE_SKILL_BOOK_STATE.READY);
  assert.equal(book.hasVisibleSkills, false);
  assert.equal(await book.selectSkill("life.fishing"), false, "an unlisted skill cannot be opened");
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.TREE), 0);
});

test("unlock sends only node id + request id and renders the server's returned tree", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  await book.setAccount(A);
  assert.equal(book.hasVisibleSkills, true);
  await book.selectSkill("life.fishing");
  client.respond(LIFE_SKILL_BOOK_RPC.UNLOCK, { data: { status: "SUCCESS", nodeId: "life.node.fishing.steady_hands",
    skillId: "life.fishing", rankAfter: 1,
    tree: tree([node("steady_hands", { rank: 1 })], {}, { sp: { earned: 5, spent: 1, available: 4, nextLevelEarned: 6 } }) }, error: null });
  const result = await book.unlockNode("life.node.fishing.steady_hands");
  assert.equal(result.outcome, "DONE");
  assert.deepEqual(client.calls.at(-1), { fn: LIFE_SKILL_BOOK_RPC.UNLOCK,
    args: { p_node_id: "life.node.fishing.steady_hands", p_request_id: REQ[0] } });
  assert.equal(book.tree.nodes[0].rank, 1);
  assert.equal(book.book.skills[0].sp.available, 4, "the list reflects the server's SP after the action");
});

test("a transport failure keeps the request id so the retry replays instead of spending twice", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  await book.setAccount(A);
  await book.selectSkill("life.fishing");
  client.respond(LIFE_SKILL_BOOK_RPC.UNLOCK, { data: null, error: { message: "network down" } });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  assert.equal((await book.unlockNode("life.node.fishing.steady_hands")).outcome, "FAILED");
  await flush();
  client.respond(LIFE_SKILL_BOOK_RPC.UNLOCK, { data: { status: "ALREADY_PROCESSED", tree: tree([node("steady_hands", { rank: 1 })]) }, error: null });
  assert.equal((await book.unlockNode("life.node.fishing.steady_hands")).outcome, "REPLAYED");
  const unlocks = client.calls.filter((c) => c.fn === LIFE_SKILL_BOOK_RPC.UNLOCK);
  assert.equal(unlocks[0].args.p_request_id, unlocks[1].args.p_request_id);
  client.respond(LIFE_SKILL_BOOK_RPC.UNLOCK, { data: null, error: { message: "LIFE_SP_INSUFFICIENT" } });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  const refused = await book.unlockNode("life.node.fishing.steady_hands");
  assert.deepEqual([refused.outcome, refused.code], ["REFUSED", "LIFE_SP_INSUFFICIENT"]);
  assert.notEqual(client.calls.filter((c) => c.fn === LIFE_SKILL_BOOK_RPC.UNLOCK).at(-1).args.p_request_id, unlocks[0].args.p_request_id,
    "a settled action gets a fresh request id");
});

test("reset sends only skill id + request id; an account switch drops the old views", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands", { rank: 1 })], { canReset: true, resetBlockedBy: null }), error: null });
  await book.setAccount(A);
  await book.selectSkill("life.fishing");
  client.respond(LIFE_SKILL_BOOK_RPC.RESET, { data: { status: "SUCCESS", refundedSp: 1, tree: tree([node("steady_hands")]) }, error: null });
  assert.equal((await book.resetTree("life.fishing")).outcome, "DONE");
  assert.deepEqual(client.calls.at(-1).args, { p_skill_id: "life.fishing", p_request_id: REQ[0] });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(), error: null });
  await book.setAccount(B);
  assert.equal(book.tree, null);
  assert.equal(book.selectedSkillId, null);
  assert.equal(book.hasVisibleSkills, false);
});

test("panel renders server decisions and enables buttons only where the server allowed", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const { client, book } = harness();
  const ui = createLifeSkillBookPanel({ panel, book, doc });
  const nodes = [
    node("steady_hands", { rank: 1, canUnlock: true }),
    node("fish_sense", { requiredSkillLevel: 3, canUnlock: false, lockReason: "PREREQUISITE",
      prerequisites: [{ nodeId: "life.node.fishing.steady_hands", requiredRank: 2, visible: true, met: false }] }),
    node("rare_fish_sense", { maxRank: 2, nextRankCost: 2, requiredSkillLevel: 8, canUnlock: false, lockReason: "SKILL_LEVEL",
      prerequisites: [{ nodeId: "life.node.fishing.secret", requiredRank: 1, visible: false, met: true }] })
  ];
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  await book.setAccount(A);
  ui.setOpen(true);
  await flush();
  const all = (root, out = []) => { out.push(root); for (const c of root.children ?? []) all(c, out); return out; };
  const text = () => all(panel).map((n) => n.textContent).join(" ");
  assert.match(text(), /낚시 · Lv 5 ›/);
  assert.match(text(), /XP 1000 \/ 1500/);
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree(nodes, { canReset: false, resetBlockedBy: "COOLDOWN",
    nextResetAt: "2026-10-05T12:00:00Z", lastResetAt: "2026-10-04T12:00:00Z" }), error: null });
  all(panel).find((n) => (n.className ?? "").includes("life-skill-open")).click();
  await flush();
  const unlockButtons = all(panel).filter((n) => (n.className ?? "").includes("life-node-unlock"));
  assert.deepEqual(unlockButtons.map((b) => b.disabled), [false, true, true], "only the server-approved node is clickable");
  assert.deepEqual(unlockButtons.map((b) => b.textContent), [LIFE_SKILL_BOOK_TEXT.rankUp, LIFE_SKILL_BOOK_TEXT.unlock, LIFE_SKILL_BOOK_TEXT.unlock]);
  assert.match(text(), /✗ 안정된 손놀림 랭크 2/);
  assert.match(text(), new RegExp(`✓ ${LIFE_SKILL_BOOK_TEXT.hiddenPrerequisite} 랭크 1`));
  assert.match(text(), /스킬 Lv 8 필요/);
  assert.match(text(), /다음 초기화 가능:/);
  const reset = all(panel).find((n) => (n.className ?? "").includes("life-tree-reset-button"));
  assert.equal(reset.disabled, true, "the reset follows the server cooldown");
  assert.equal(nodeName("life.node.fishing.unknown"), "life.node.fishing.unknown");
  assert.equal(lockText(nodes[2]), "스킬 Lv 8 필요");
  assert.equal(xpLine(skill({ isMaxLevel: true, nextLevelXp: null, totalXp: 20000, currentLevelStartXp: 19000 })), "최고 레벨 · XP 20000");
});
