import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createQuestClient } from "../npc-factory/quest-client.mjs";
import { createSupabaseQuestStore } from "../npc-factory/quest-store.mjs";
import { QUEST_ID } from "../npc-factory/quest-contract.mjs";
import { rewardToastMessage } from "../src/events/zombie-university-2026/event-ui.js";

// P1c: the server Reward result for First Campus, exactly as advance_world_quest_v1 returns it.
const serverReward = Object.freeze({
  rewardId: "reward.quest.first_campus", rewardVersion: 2, rewardTransactionId: "tx-1",
  status: "SUCCESS", replayed: false, completedAt: "2026-09-29T00:00:00Z",
  entries: [
    { grantType: "ITEM", targetId: "badge.main_gate", requested: 1, granted: 1, status: "GRANTED", reason: null },
    { grantType: "EXP", targetId: "exp.campus", requested: 100, granted: 100, status: "GRANTED", reason: null }
  ]
});
const MAIN = "INKYUNG-NPC-001";

function harness({ respond, onReward }) {
  const hudObjective = { textContent: "" };
  const calls = [];
  const client = createQuestClient({
    enabled: true, endpoint: "/api/world-quest", getSession: async () => "token",
    getNpcPosition: () => ({ x: 1, z: -98 }),
    hud: { hidden: true, querySelector: () => hudObjective }, tour: { hidden: false },
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return { ok: true, json: async () => respond(body) };
    },
    onReward
  });
  return { client, calls };
}

test("1. completing call passes the server Reward result to onReward once, unchanged", async () => {
  const rewards = [];
  let stage = 4;
  const { client, calls } = harness({
    respond: ({ event }) => event === "talk_001" && stage === 4
      ? (stage = 5, { quest_id: QUEST_ID, stage, reward: serverReward })
      : { quest_id: QUEST_ID, stage },
    onReward: reward => rewards.push(reward)
  });
  await client.setSignedIn(true);
  const result = await client.advanceNpc(MAIN);
  assert.equal(result.stage, 5);
  assert.equal(rewards.length, 1);
  assert.deepEqual(rewards[0], serverReward, "no amount recomputed, no field rewritten");
  for (const body of calls) assert.deepEqual(Object.keys(body).sort(), ["event"],
    "the browser sends only the event: no user, reward id, item or amount");
});

test("2. status, replay and non-completing events never call onReward", async () => {
  const rewards = [];
  const { client } = harness({ respond: () => ({ quest_id: QUEST_ID, stage: 5 }), onReward: r => rewards.push(r) });
  await client.setSignedIn(true);
  await client.setSignedIn(false);
  await client.setSignedIn(true);
  assert.equal(client.stage, 5);
  assert.equal(rewards.length, 0);
});

test("3. a malformed reward is rejected and does not reach onReward", async () => {
  for (const reward of [
    { ...serverReward, status: "FAILED" },
    { ...serverReward, entries: [] },
    { ...serverReward, entries: [{ ...serverReward.entries[1], granted: "100" }] },
    { ...serverReward, replayed: "no" },
    []
  ]) {
    const rewards = [];
    const { client } = harness({
      respond: ({ event }) => event === "talk_001" ? { quest_id: QUEST_ID, stage: 5, reward } : { quest_id: QUEST_ID, stage: 4 },
      onReward: r => rewards.push(r)
    });
    await client.setSignedIn(true);
    await assert.rejects(client.advanceNpc(MAIN), /QUEST_UNAVAILABLE/);
    assert.equal(rewards.length, 0);
    assert.equal(client.stage, 4, "a rejected completion leaves the local stage untouched");
  }
});

test("4. no late onReward after sign-out or account switch", async () => {
  const rewards = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { client } = harness({
    respond: ({ event }) => event === "talk_001" ? gate.then(() => ({ quest_id: QUEST_ID, stage: 5, reward: serverReward }))
      : { quest_id: QUEST_ID, stage: 4 },
    onReward: r => rewards.push(r)
  });
  await client.setSignedIn(true);
  const pending = client.advanceNpc(MAIN);
  await client.setSignedIn(false);
  release();
  assert.equal(await pending, null);
  assert.equal(rewards.length, 0, "the old account's reward never shows for the next session");
});

test("5. Supabase store passes the reward through only on a Main 1 stage 5 result", async () => {
  const body = { quest_id: QUEST_ID, stage: 5, reward: serverReward };
  const store = createSupabaseQuestStore({ serviceRoleKey: "k", supabaseUrl: "http://127.0.0.1:54321",
    fetcher: async url => { assert.equal(url, "http://127.0.0.1:54321/rest/v1/rpc/advance_world_quest_v1");
      return { ok: true, json: async () => body }; } });
  assert.deepEqual((await store("user", "talk_001")).reward, serverReward);
  const bad = createSupabaseQuestStore({ serviceRoleKey: "k",
    fetcher: async () => ({ ok: true, json: async () => ({ quest_id: QUEST_ID, stage: 4, reward: serverReward }) }) });
  await assert.rejects(bad("user", "talk_001"), /QUEST_STORE_UNAVAILABLE/);
});

test("6. reward toast reads badge label and server EXP, never raw ids", () => {
  const message = rewardToastMessage({ status: "CLAIMED", rewardResult: { status: "SUCCESS", entries: serverReward.entries } });
  assert.equal(message.text, "🎁 보상 획득\n정문 첫걸음 배지 획득\n+100 EXP");
  assert.doesNotMatch(message.text, /badge\.main_gate|exp\.campus|좀비|MCM/);
  const partial = rewardToastMessage({ status: "CLAIMED", rewardResult: { status: "PARTIAL_SUCCESS", entries: [
    { ...serverReward.entries[0], granted: 0, status: "SKIPPED", reason: "ALREADY_OWNED" }, serverReward.entries[1]] } });
  assert.equal(partial.text, "🎁 보상 획득\n정문 첫걸음 배지 · 이미 보유\n+100 EXP");
});

test("7. main.js wires onQuestReward to the existing toast lane and re-reads authorities only", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../npc-factory/dev-runtime.mjs", import.meta.url), "utf8");
  assert.match(runtime, /onReward: onQuestReward/);
  const block = main.slice(main.indexOf("onQuestReward:"), main.indexOf("getAiSession:", main.indexOf("onQuestReward:")));
  assert.match(block, /mcmEventUi\.showReward\(/);
  assert.match(block, /progression\.refresh\(receipt \? "core15-first-campus-reward" : "reward"\)/);
  // P1d: each authority is re-read only when a server entry touched it (First Campus has no CURRENCY).
  assert.match(block, /grantType === "ITEM"\)\) void inventory\.refresh\("reward"\)/);
  assert.match(block, /grantType === "CURRENCY"\)\) void wallet\.refresh\("reward"\)/);
  assert.match(block, /firstCampusCompletion\.accept\(reward\)/);
  assert.match(block, /firstCampusCompletion\.trackToast\(receipt, toast\)/,
    "validated receipt is paired with its actual visible toast handle");
  assert.match(block, /freshFirstCampusReward[\s\S]*?core15Funnel\?\.coreLoopComplete\(\)/,
    "legacy core_loop_complete remains tied to fresh reward settlement");
  assert.doesNotMatch(block, /core15Funnel\?\.core15Complete\(/,
    "gameplay never directly asserts Product CORE-15 completion");
  assert.doesNotMatch(block, /offerFirstCampusReward/,
    "reward presentation does not own the persistent next-action HUD");
  assert.match(main, /firstCampusCompletion\.observe\(\{[\s\S]*?nextDiscovery\?\.status\(\)\?\.id === "main2_back_gate_guide"[\s\S]*?isElementVisible/,
    "authoritative next activity must also be visible before it counts");
  assert.match(main, /campusNavigation\?\.poiTarget\(\{[\s\S]*?poiId: "core15\.main2-guide"[\s\S]*?x: MAIN2_GUIDE_NPC\.position\.x,[\s\S]*?z: MAIN2_GUIDE_NPC\.position\.z[\s\S]*?\}, CAMPUS_NAV_SPACE\)/,
    "next discovery derives its route from the existing Main 2 guide and Campus Navigation authorities");
  assert.doesNotMatch(block, /rpc\(|world_reward_grant|\+ *1[08]0|level|balance/i,
    "no direct Reward RPC, no client coin, EXP or Level math");
});

