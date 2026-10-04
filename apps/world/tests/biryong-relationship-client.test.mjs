import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BIRYONG_RELATIONSHIP_CLIENT_STATE,
  BIRYONG_RELATIONSHIPS_RPC,
  createBiryongRelationshipClient,
  parseBiryongRelationshipList,
  parseBiryongRelationshipSnapshot
} from "../src/biryong/biryong-village-relationship-client.js";

const userA = "a9700000-0000-4000-8000-0000000000a9";
const userB = "b9700000-0000-4000-8000-0000000000b9";

const stage1 = npcId => ({
  npcId, stage: 1, stageState: "ACQUAINTED", nextStage: 2, revision: 0,
  stage2UnlockedAt: null, stage3UnlockedAt: null, updatedAt: null, unlockedFacts: []
});
const fact2 = {
  factId: "biryong.relationship.br_npc_001.s2.test_secret",
  npcId: "BR_NPC_001",
  unlockStage: 2,
  topicId: "trust_test",
  topicLabel: "신뢰 테스트",
  factText: "Stage 2 테스트 사실",
  dialogueLine: "Stage 2 테스트 대사",
  generativeSafe: false,
  definitionVersion: 1
};
const relationshipList = (first = stage1("BR_NPC_001")) => ({
  relationships: [
    first,
    ...Array.from({ length: 7 }, (_, i) => stage1(`BR_NPC_00${i + 2}`))
  ]
});

test("relationship parser accepts authoritative Stage snapshots and rejects premature facts", () => {
  const stage2 = {
    npcId: "BR_NPC_001", stage: 2, stageState: "TRUSTED", nextStage: 3, revision: 1,
    stage2UnlockedAt: "2026-10-04T03:00:00Z", stage3UnlockedAt: null,
    updatedAt: "2026-10-04T03:00:00Z", unlockedFacts: [fact2]
  };
  assert.equal(parseBiryongRelationshipSnapshot(stage2)?.stage, 2);
  assert.equal(parseBiryongRelationshipSnapshot(stage2)?.unlockedFacts.length, 1);
  assert.equal(parseBiryongRelationshipSnapshot({
    ...stage1("BR_NPC_001"), unlockedFacts: [fact2]
  }), null, "Stage 1 cannot accept Stage 2 payload");
  assert.equal(parseBiryongRelationshipSnapshot({
    ...stage2, stageState: "ACQUAINTED"
  }), null, "client rejects a server stage/state mismatch");
  assert.equal(parseBiryongRelationshipSnapshot({
    ...stage2, revision: 0
  }), null, "persisted Stage 2 cannot have revision 0");
});

test("relationship list requires exactly the eight P0 NPC identities", () => {
  assert.equal(parseBiryongRelationshipList(relationshipList())?.size, 8);
  const seven = relationshipList();
  seven.relationships.pop();
  assert.equal(parseBiryongRelationshipList(seven), null);
});

test("relationship client is read-only, account scoped, and drops stale account responses", async () => {
  let userId = userA;
  let resolveFirst;
  const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
  let call = 0;
  const client = {
    rpc(name) {
      assert.equal(name, BIRYONG_RELATIONSHIPS_RPC);
      call += 1;
      if (call === 1) return firstResponse;
      return Promise.resolve({ data: relationshipList(), error: null });
    }
  };
  const relationship = createBiryongRelationshipClient({
    getClient: () => client,
    getUserId: () => userId
  });
  const first = relationship.setAccount(userA);
  userId = userB;
  const second = relationship.setAccount(userB);
  resolveFirst({ data: relationshipList({
    npcId: "BR_NPC_001", stage: 2, stageState: "TRUSTED", nextStage: 3, revision: 1,
    stage2UnlockedAt: "2026-10-04T03:00:00Z", stage3UnlockedAt: null,
    updatedAt: "2026-10-04T03:00:00Z", unlockedFacts: [fact2]
  }), error: null });
  await Promise.all([first, second]);
  assert.equal(relationship.status().state, BIRYONG_RELATIONSHIP_CLIENT_STATE.READY);
  assert.equal(relationship.stage("BR_NPC_001"), 1, "stale account A response is discarded");
  assert.equal(relationship.facts("BR_NPC_001").length, 0);
  assert.equal(typeof relationship.advance, "undefined", "browser adapter exposes no stage mutation method");
});

test("main uses server relationship projection for dialogue and identity boundaries", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const dialogue = readFileSync(new URL("../src/biryong/biryong-village-dialogue-runtime.js", import.meta.url), "utf8");
  assert.match(main, /createBiryongRelationshipClient/);
  assert.match(main, /getRelationshipStage: npcId => biryongRelationships\.stage\(npcId\)/);
  assert.match(main, /getUnlockedFacts: npcId => biryongRelationships\.facts\(npcId\)/);
  assert.match(main, /biryongRelationships\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  assert.match(main, /biryongRelationships\.refresh\("region-enter"\)/);
  assert.match(dialogue, /getUnlockedFacts = \(\) => \[\]/);
  assert.match(dialogue, /fact\.dialogueLine/);
  assert.doesNotMatch(dialogue, /world_biryong_npc_relationship_advance_v1/);
});
