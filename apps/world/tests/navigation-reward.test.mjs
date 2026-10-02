import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMain2QuestClient } from "../npc-factory/main2-quest-client.mjs";
import { MAIN2_QUEST_ID } from "../npc-factory/main2-quest-contract.mjs";
import { createSupabaseQuestStore } from "../npc-factory/quest-store.mjs";
import { BACK_GATE_SPAWN } from "../src/campus-spawn.js";
import { DEFAULT_EVENT_DEFINITIONS, EVENT_ID, EVENT_REWARD_MODE } from "../src/events/event-registry.js";
import { rewardToastMessage } from "../src/events/zombie-university-2026/event-ui.js";

// P1d: the server Reward result for Main2, exactly as advance_world_navigation_quest_v1 returns it.
const serverReward = Object.freeze({
  rewardId: "reward.quest.navigation_intro", rewardVersion: 1, rewardTransactionId: "tx-nav",
  status: "SUCCESS", replayed: false, completedAt: "2026-09-29T00:00:00Z",
  entries: [
    { grantType: "CURRENCY", targetId: "currency.induck_coin", requested: 180, granted: 180, status: "GRANTED", reason: null },
    { grantType: "EXP", targetId: "exp.campus", requested: 100, granted: 100, status: "GRANTED", reason: null }
  ]
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

// A server stand-in with the ordered Main2 rules; `finalReward` is what the 8 → 9 call returns.
function harness({ stage: start = 8, available = true, finalReward = serverReward, delay = null } = {}) {
  let stage = start;
  const rewards = [], calls = [];
  const order = { set_building5_destination: 1, start_auto_building5: 2, pause_auto_building5: 3,
    resume_auto_building5: 4, visit_building5: 5, set_back_gate_destination: 6, start_auto_back_gate: 7, visit_back_gate: 8 };
  const client = createMain2QuestClient({
    enabled: true, endpoint: "/api/world-quest", getSession: async () => "token", hud: null,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (delay) await delay;
      let reward;
      if (available && order[body.event] === stage) {
        stage += 1;
        if (stage === 9) reward = finalReward;
      }
      return { ok: true, json: async () => ({ quest_id: MAIN2_QUEST_ID, stage, available, ...(reward ? { reward } : {}) }) };
    },
    onReward: reward => rewards.push(reward)
  });
  return { client, rewards, calls, get serverStage() { return stage; } };
}

test("1. responses without a reward never call onReward", async () => {
  const h = harness({ stage: 6 });
  await h.client.setSignedIn(true);
  h.client.observeNavigation({ active: true, destination: { poiId: "poi.back-gate" } });
  await settle();
  assert.equal(h.client.stage, 7);
  assert.equal(h.rewards.length, 0);
});

test("2. the completing visit passes the server Reward result to onReward exactly once, unchanged", async () => {
  const h = harness();
  await h.client.setSignedIn(true);
  assert.equal(h.client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z }), true);
  await settle();
  assert.equal(h.client.stage, 9);
  assert.equal(h.client.status().complete, true);
  assert.equal(h.rewards.length, 1);
  assert.deepEqual(h.rewards[0], serverReward, "no amount recomputed, no field rewritten");
  for (const body of h.calls) assert.deepEqual(Object.keys(body).sort(), ["event", "quest_id"],
    "the browser sends only the quest and event: no user, reward id, currency or amount");
});

test("3-4. a repeated final visit and status at stage 9 never call onReward", async () => {
  const h = harness({ stage: 9 });
  await h.client.setSignedIn(true);
  assert.equal(h.client.stage, 9);
  assert.equal(h.client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z }), false,
    "stage 9 sends no visit");
  await h.client.refresh();
  await h.client.setSignedIn(false);
  await h.client.setSignedIn(true);
  assert.equal(h.rewards.length, 0);
  assert.equal(h.client.mapTarget(), null, "Main2 objective is over");
});

test("5. a malformed reward is rejected and does not reach onReward", async () => {
  for (const finalReward of [
    { ...serverReward, status: "FAILED" },
    { ...serverReward, entries: [] },
    { ...serverReward, entries: [{ ...serverReward.entries[0], granted: "180" }] },
    { ...serverReward, replayed: 1 },
    "reward"
  ]) {
    const h = harness({ finalReward });
    await h.client.setSignedIn(true);
    h.client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z });
    await settle();
    assert.equal(h.rewards.length, 0, JSON.stringify(finalReward));
    assert.equal(h.client.stage, 8, "a rejected completion leaves the local stage untouched");
  }
});

test("6. no late onReward after sign-out or account switch", async () => {
  let releaseFinal;
  const gate = new Promise(resolve => { releaseFinal = resolve; });
  const rewards = [];
  let stage = 8;
  const client = createMain2QuestClient({
    enabled: true, endpoint: "/api/world-quest", getSession: async () => "token", hud: null,
    fetcher: async (_url, options) => {
      const { event } = JSON.parse(options.body);
      if (event === "visit_back_gate") {
        await gate;
        stage = 9;
        return { ok: true, json: async () => ({ quest_id: MAIN2_QUEST_ID, stage, available: true, reward: serverReward }) };
      }
      return { ok: true, json: async () => ({ quest_id: MAIN2_QUEST_ID, stage, available: true }) };
    },
    onReward: reward => rewards.push(reward)
  });
  await client.setSignedIn(true);
  assert.equal(client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z }), true);
  await client.setSignedIn(false);
  releaseFinal();
  await settle();
  assert.equal(rewards.length, 0, "the old account's reward never shows for the next session");
  assert.equal(client.stage, 0);
});

test("7. deferred Auto Move still sends start_auto_back_gate after the destination is stored", async () => {
  const h = harness({ stage: 6 });
  await h.client.setSignedIn(true);
  assert.equal(h.client.observeAutoMove({ destinationId: "poi:poi.back-gate", active: true }, "ready"), true, "deferred at stage 6");
  h.client.observeNavigation({ active: true, destination: { poiId: "poi.back-gate" } });
  await settle();
  assert.equal(h.client.stage, 8, "set destination, then the deferred auto-move start");
  assert.deepEqual(h.calls.map(c => c.event), ["status", "set_back_gate_destination", "start_auto_back_gate"]);
  h.client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z });
  await settle();
  assert.equal(h.rewards.length, 1);
});

test("8. Main2 still depends on Main 1 (available=false: no start, no objective, no reward)", async () => {
  const h = harness({ stage: 0, available: false });
  await h.client.setSignedIn(true);
  assert.equal(await h.client.startFromGuide(), null);
  assert.equal(h.client.mapTarget(), null);
  assert.equal(h.client.observePlace("AREA_BACK_GATE", { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z }), false);
  assert.equal(h.rewards.length, 0);
});

test("store passes a Main2 reward through only on a stage 9 result", async () => {
  const store = (body) => createSupabaseQuestStore({ serviceRoleKey: "k", supabaseUrl: "http://127.0.0.1:54321",
    fetcher: async url => { assert.equal(url, "http://127.0.0.1:54321/rest/v1/rpc/advance_world_navigation_quest_v1");
      return { ok: true, json: async () => body }; } });
  const ok = await store({ quest_id: MAIN2_QUEST_ID, stage: 9, available: true, reward: serverReward })("u", "visit_back_gate", MAIN2_QUEST_ID);
  assert.deepEqual(ok.reward, serverReward);
  await assert.rejects(store({ quest_id: MAIN2_QUEST_ID, stage: 8, available: true, reward: serverReward })("u", "visit_back_gate", MAIN2_QUEST_ID),
    /QUEST_STORE_UNAVAILABLE/);
  await assert.rejects(store({ quest_id: MAIN2_QUEST_ID, stage: 9, available: true, reward: { ...serverReward, entries: [] } })("u", "visit_back_gate", MAIN2_QUEST_ID),
    /QUEST_STORE_UNAVAILABLE/);
});

test("toast reads the server coin and EXP lines", () => {
  const message = rewardToastMessage({ status: "CLAIMED", rewardResult: { status: "SUCCESS", entries: serverReward.entries } });
  assert.equal(message.text, "🎁 보상 획득\n+180 인덕코인\n+100 EXP");
  assert.doesNotMatch(message.text, /currency\.|exp\.campus|좀비|MCM/);
});

test("dev-runtime wires Main2 to the shared onQuestReward; BG01 stays rewardMode NONE", async () => {
  const runtime = await readFile(new URL("../npc-factory/dev-runtime.mjs", import.meta.url), "utf8");
  const main2Block = runtime.slice(runtime.indexOf("createMain2QuestClient({"), runtime.indexOf("});", runtime.indexOf("createMain2QuestClient({")));
  assert.match(main2Block, /onReward: onQuestReward/);
  assert.equal(DEFAULT_EVENT_DEFINITIONS[EVENT_ID.BACK_GATE_BG01].rewardMode, EVENT_REWARD_MODE.NONE,
    "the navigation reward is a Main2 quest reward, not a BG01 event reward");
});
