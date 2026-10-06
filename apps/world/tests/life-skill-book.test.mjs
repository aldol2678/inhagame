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
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const elements = (root) => [root, ...(root.children ?? []).flatMap(elements)];
const panelText = (panel) => elements(panel).map(n => n.textContent).join(" ");
const byClass = (panel, name) => elements(panel).find(n => (n.className ?? "").split(" ").includes(name));

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

for (const failure of [
  { name: "RPC error", result: { data: null, error: { message: "network down" } } },
  { name: "malformed data", result: { data: {}, error: null } },
  { name: "another skill", result: { data: tree([], {}, { skillId: "life.woodcutting" }), error: null } }
]) {
  test(`a tree ${failure.name} becomes unavailable and a retry reads only that tree`, async () => {
    const { client, book } = harness();
    client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
    await book.setAccount(A);
    const first = deferred();
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, first.promise);
    const selecting = book.selectSkill("life.fishing");
    assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.LOADING);
    first.resolve(failure.result);
    assert.equal(await selecting, false);
    assert.equal(book.state, LIFE_SKILL_BOOK_STATE.READY, "the list remains usable");
    assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.UNAVAILABLE);
    assert.equal(book.tree, null);
    assert.equal(book.selectedSkillId, "life.fishing");
    const retry = deferred();
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, retry.promise);
    const retrying = book.selectSkill(book.selectedSkillId);
    const repeated = book.selectSkill(book.selectedSkillId);
    assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.LOADING);
    assert.equal(client.count(LIFE_SKILL_BOOK_RPC.TREE), 2, "duplicate read clicks coalesce");
    retry.resolve({ data: tree([node("steady_hands")]), error: null });
    assert.equal(await retrying, true);
    assert.equal(await repeated, true);
    assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.READY);
    assert.equal(book.tree.nodes[0].nodeId, "life.node.fishing.steady_hands");
    assert.deepEqual(client.calls.map(c => c.fn), [LIFE_SKILL_BOOK_RPC.LIST, LIFE_SKILL_BOOK_RPC.TREE, LIFE_SKILL_BOOK_RPC.TREE]);
    assert.deepEqual(client.calls.at(-1).args, { p_skill_id: "life.fishing" });
  });
}

test("a rejected tree request becomes unavailable instead of remaining loading", async () => {
  const book = createLifeSkillBookClient({ getClient: () => ({
    rpc: (rpc) => rpc === LIFE_SKILL_BOOK_RPC.LIST
      ? Promise.resolve({ data: list(skill()), error: null }) : Promise.reject(new Error("offline"))
  }) });
  await book.setAccount(A);
  assert.equal(await book.selectSkill("life.fishing"), false);
  assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.UNAVAILABLE);
});

test("a selected-tree refresh failure drops stale actions and remains retryable", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  await book.setAccount(A);
  await book.selectSkill("life.fishing");
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: null, error: { message: "offline" } });
  await book.refresh();
  assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.UNAVAILABLE);
  assert.equal(book.tree, null);
  assert.equal(book.state, LIFE_SKILL_BOOK_STATE.READY);
});

test("post-action recovery supersedes a tree read begun before the action settled", async () => {
  const { client, book } = harness();
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  await book.setAccount(A);
  await book.selectSkill("life.fishing");
  const action = deferred();
  client.respond(LIFE_SKILL_BOOK_RPC.UNLOCK, action.promise);
  const unlocking = book.unlockNode("life.node.fishing.steady_hands");
  book.clearSelection();
  const old = deferred();
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, old.promise);
  const oldRead = book.selectSkill("life.fishing");
  const after = { sp: { earned: 5, spent: 1, available: 4, nextLevelEarned: 6 } };
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill(after)), error: null });
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands", { rank: 1 })], {}, after), error: null });
  action.resolve({ data: null, error: { message: "response lost after commit" } });
  assert.equal((await unlocking).outcome, "FAILED");
  await flush();
  old.resolve({ data: tree([node("steady_hands")]), error: null });
  await oldRead;
  await flush();
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.TREE), 3, "recovery needs a fresh post-action tree read");
  assert.equal(book.tree.nodes[0].rank, 1);
  assert.equal(book.tree.skill.sp.spent, book.book.skills[0].sp.spent);
  assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.READY);
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.UNLOCK), 1, "recovery never repeats the write");
});

test("switching away and back rejects an older same-skill success or failure", async () => {
  for (const stale of [{ data: tree([node("steady_hands", { rank: 2 })]), error: null },
    { data: null, error: { message: "late failure" } }]) {
    const { client, book } = harness();
    client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill(), skill({ skillId: "life.woodcutting" })), error: null });
    await book.setAccount(A);
    const first = deferred();
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, first.promise);
    const oldRead = book.selectSkill("life.fishing");
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([], {}, { skillId: "life.woodcutting" }), error: null });
    await book.selectSkill("life.woodcutting");
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands", { rank: 1 })]), error: null });
    await book.selectSkill("life.fishing");
    first.resolve(stale);
    assert.equal(await oldRead, false);
    assert.equal(book.treeState, LIFE_SKILL_BOOK_STATE.READY);
    assert.equal(book.tree.nodes[0].rank, 1);
  }
});

test("account changes and Back invalidate pending tree reads", async () => {
  for (const boundary of ["account", "signout", "back"]) {
    const { client, book } = harness();
    client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
    await book.setAccount(A);
    const pending = deferred();
    client.respond(LIFE_SKILL_BOOK_RPC.TREE, pending.promise);
    const read = book.selectSkill("life.fishing");
    if (boundary === "account") {
      client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
      await book.setAccount(B);
    } else if (boundary === "signout") await book.setAccount(null);
    else book.clearSelection();
    pending.resolve({ data: tree([node("steady_hands")]), error: null });
    assert.equal(await read, false);
    assert.equal(book.tree, null);
    assert.equal(book.treeState, null);
    assert.equal(book.selectedSkillId, null);
  }
});

test("panel replaces tree loading with an error and a tree-only retry, including repeated failures", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  const { client, book } = harness();
  const ui = createLifeSkillBookPanel({ panel, book, doc });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  await book.setAccount(A);
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  ui.setOpen(true);
  await flush();
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: null, error: { message: "offline" } });
  byClass(panel, "life-skill-open").click();
  await flush();
  assert.ok(panelText(panel).includes(LIFE_SKILL_BOOK_TEXT.treeUnavailable));
  assert.ok(!panelText(panel).includes(LIFE_SKILL_BOOK_TEXT.treeLoading));
  assert.ok(byClass(panel, "life-skill-back"));
  assert.equal(byClass(panel, "life-node-unlock"), undefined);
  const retry = deferred();
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, retry.promise);
  const retryButton = byClass(panel, "life-tree-retry");
  retryButton.click();
  retryButton.click();
  assert.ok(panelText(panel).includes(LIFE_SKILL_BOOK_TEXT.treeLoading));
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.TREE), 2);
  retry.resolve({ data: null, error: { message: "still offline" } });
  await flush();
  assert.ok(panelText(panel).includes(LIFE_SKILL_BOOK_TEXT.treeUnavailable));
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, { data: tree([node("steady_hands")]), error: null });
  byClass(panel, "life-tree-retry").click();
  await flush();
  assert.ok(byClass(panel, "life-node-unlock"));
  assert.equal(byClass(panel, "life-tree-retry"), undefined);
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.LIST), 2, "tree retry does not reload the list");
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.UNLOCK), 0);
  assert.equal(client.count(LIFE_SKILL_BOOK_RPC.RESET), 0);
});

test("closing a loading panel drops the selection and cannot be undone by its delayed read", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  const { client, book } = harness();
  const ui = createLifeSkillBookPanel({ panel, book, doc });
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  await book.setAccount(A);
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  ui.setOpen(true);
  await flush();
  const pending = deferred();
  client.respond(LIFE_SKILL_BOOK_RPC.TREE, pending.promise);
  byClass(panel, "life-skill-open").click();
  byClass(panel, "profile-close").click();
  pending.resolve({ data: tree([node("steady_hands")]), error: null });
  await flush();
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
  assert.equal(book.selectedSkillId, null);
  assert.equal(book.treeState, null);
  client.respond(LIFE_SKILL_BOOK_RPC.LIST, { data: list(skill()), error: null });
  ui.setOpen(true);
  await flush();
  assert.ok(byClass(panel, "life-skill-open"));
  assert.equal(byClass(panel, "life-node-unlock"), undefined);
});
