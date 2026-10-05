import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BIRYONG_DIALOGUE_PROFILES,
  authoredBiryongDialogueLine,
  biryongDialogueTopics,
  buildBiryongGeminiGroundedPacket,
  compileBiryongClientKnowledge
} from "../src/biryong/biryong-village-dialogue-contract.js";
import { BIRYONG_VILLAGE_NPC_ROSTER } from "../src/biryong/biryong-village-npc-contract.js";
import { JEV_DIALOGUE_PILOT_IDS, validateNpcJevRouterInput } from "../npc-factory/npc-jev-router.mjs";

test("Biryong dialogue profiles cover exactly the eight P0 village NPCs", () => {
  assert.deepEqual(Object.keys(BIRYONG_DIALOGUE_PROFILES), BIRYONG_VILLAGE_NPC_ROSTER.map(npc => npc.id));
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    const topics = biryongDialogueTopics(npc.id, 1);
    assert.ok(topics.length >= 3, npc.name);
    assert.equal(topics.every(topic => topic.minStage === 1), true);
    assert.equal(typeof authoredBiryongDialogueLine(npc.id, { mode: "GREETING" }), "string");
    assert.equal(typeof authoredBiryongDialogueLine(npc.id, { mode: "STATUS" }), "string");
  }
});

test("client knowledge boundary never ships Stage-2/3 secret text, even if a caller asks for Stage 3", () => {
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    const stage1 = compileBiryongClientKnowledge(npc.id, 1);
    const stage3 = compileBiryongClientKnowledge(npc.id, 3);
    assert.equal(stage1.secretTextShipped, false);
    assert.equal(stage3.secretTextShipped, false);
    assert.equal(stage3.relationshipStage, 3);
    assert.deepEqual(stage3.facts, stage1.facts, `${npc.name}: browser facts stay public-only`);
    assert.deepEqual(stage3.topicIds, stage1.topicIds);
    assert.ok(stage3.lockedFactCount >= 2);
    assert.equal(BIRYONG_DIALOGUE_PROFILES[npc.id].locked.every(id => /^S[23]_[A-Z]$/u.test(id)), true);
  }
});

test("Gemini grounded packet contains only the selected public topic facts and no world authority", () => {
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) {
    const topic = biryongDialogueTopics(npc.id, 3)[0];
    const packet = buildBiryongGeminiGroundedPacket(npc.id, {
      relationshipStage: 3,
      topicId: topic.id,
      current: { period: "lunch", destination: "MARKET_CENTER", activity: "MEAL", placeZoneId: "BR_MARKET" },
      world: { weather: "CLEAR", environmentTime: "DAY", placeZoneId: "BR_MARKET" }
    });
    assert.equal(packet.schemaVersion, "biryong-grounded-dialogue-p0");
    assert.equal(packet.secretTextShipped, false);
    assert.deepEqual(packet.allowedFacts, topic.facts);
    assert.ok(packet.constraints.some(line => line.includes("allowedFacts")));
    assert.ok(packet.constraints.some(line => line.includes("보상")));
    const serialized = JSON.stringify(packet);
    assert.doesNotMatch(serialized, /wallet|inventory|rewardId|accessToken|authorization|studentNumber/u);
  }
});

test("locked or unknown Biryong dialogue topics cannot produce authored or Gemini output", () => {
  assert.throws(() => authoredBiryongDialogueLine("BR_NPC_001", {
    relationshipStage: 1, topicId: "S2_A", mode: "TOPIC"
  }), /locked or unknown/u);
  assert.throws(() => buildBiryongGeminiGroundedPacket("BR_NPC_001", {
    relationshipStage: 3, topicId: "S3_A"
  }), /not generation-safe/u);
});

test("Jev accepts Biryong P0 ids but receives a compact public-only dialogue context", () => {
  for (const npc of BIRYONG_VILLAGE_NPC_ROSTER) assert.ok(JEV_DIALOGUE_PILOT_IDS.includes(npc.id));
  const knowledge = compileBiryongClientKnowledge("BR_NPC_001", 1);
  const context = {
    schemaVersion: "dialogue-context-p1",
    identity: {
      npcId: "BR_NPC_001", name: "강소라", archetype: "운송·화물 담당", department: "맥상회",
      yearLevel: null, residence: "BIRYONG_REALM", interests: knowledge.topicIds, traits: ["빠름"]
    },
    current: { period: "lunch", location: "MARKET_CENTER", activity: "MEAL", socialMode: "SOLO", moving: false },
    world: { weather: "CLEAR", environmentTime: "DAY", placeZoneId: "BR_MARKET", eventId: null, eventPhase: null },
    memory: { familiarity: "FIRST", lastPeriod: null, lastTopic: null },
    social: { group: null, closeTies: [] },
    quest: { enabled: false, signedIn: false, available: false, complete: false, stage: null,
      objective: null, npcActionAvailable: false, sideEventAvailable: false },
    turn: { state: "HOME", topic: null, followUp: false },
    generationAllowed: false
  };
  const validated = validateNpcJevRouterInput({ npcId: "BR_NPC_001", context });
  assert.equal(validated.npcId, "BR_NPC_001");
  assert.ok(validated.candidates.responseSources.includes("AUTHORED"));
  assert.equal(JSON.stringify(context).includes("S2_A"), false);
});

test("runtime wiring keeps Gemini non-live while exposing Biryong talk through the shared F slot", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../src/biryong/biryong-village-dialogue-runtime.js", import.meta.url), "utf8");
  assert.match(main, /createBiryongVillageDialogueRuntime/);
  assert.match(main, /contextActions\.set\("biryong-npc"/);
  assert.match(main, /npcDialogueInput\.acquire\(\)/);
  assert.match(main, /probeFeatureFlag\("\/api\/npc-dialogue-route"\)/);
  assert.match(runtime, /id: "biryong-npc-talk"/);
  assert.match(runtime, /buildBiryongGeminiGroundedPacket/);
  assert.match(runtime, /live: false/);
  assert.doesNotMatch(runtime, /\/api\/npc-ai/);
});
