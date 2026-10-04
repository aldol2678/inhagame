import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATURE_CORE_RPC,
  CREATURE_PARTY_SET_RPC,
  createCreatureManagerClient,
  nextPartyWithActive,
  parseCreatureCoreSnapshot
} from "../src/creature/creature-manager-client.js";
import {
  creatureMemories,
  partySlotViews
} from "../src/creature/creature-panel.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

function creature(id, species = "creature.species.duck", form = "creature.form.duck.base") {
  return {
    creatureId: id, speciesId: species, currentFormId: form, formRevision: 1,
    totalXp: 0, bondEntitled: true, version: 1,
    acquiredAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z"
  };
}

function snapshot({ active=A, reserves=[], creatures=[creature(A)], memories=[] } = {}) {
  return {
    party: { revision: 1, activeCreatureId: active, reserveCreatureIds: reserves },
    creatures, memories
  };
}

test("Creature snapshot parser validates ownership-backed party and memory rows", () => {
  const raw = snapshot({
    memories: [{
      creatureId:A, memoryTag:"memory.combat.victory", memoryCount:2,
      firstRememberedAt:"2026-10-04T00:00:00Z", lastRememberedAt:"2026-10-04T01:00:00Z", version:1
    }]
  });
  const parsed = parseCreatureCoreSnapshot(raw);
  assert.equal(parsed.party.activeCreatureId, A);
  assert.equal(parsed.creatures.length, 1);
  assert.equal(parsed.memories[0].memoryCount, 2);
  assert.equal(parseCreatureCoreSnapshot({ ...raw, party:{...raw.party, activeCreatureId:B} }), null);
});

test("activating a reserve swaps old ACTIVE into the same reserve slot", () => {
  const raw = parseCreatureCoreSnapshot(snapshot({
    active:A, reserves:[B], creatures:[creature(A),creature(B)]
  }));
  assert.deepEqual(nextPartyWithActive(raw, B), {
    ok:true, activeCreatureId:B, reserveCreatureIds:[A]
  });
});

test("activating an unassigned owned Creature uses a free reserve for old ACTIVE", () => {
  const raw = parseCreatureCoreSnapshot(snapshot({
    active:A, reserves:[], creatures:[creature(A),creature(B)]
  }));
  assert.deepEqual(nextPartyWithActive(raw, B), {
    ok:true, activeCreatureId:B, reserveCreatureIds:[A]
  });
});

test("full party refuses an unassigned Creature instead of replacing a slot silently", () => {
  const raw = parseCreatureCoreSnapshot(snapshot({
    active:A, reserves:[B,C], creatures:[creature(A),creature(B),creature(C),creature(D)]
  }));
  assert.deepEqual(nextPartyWithActive(raw, D), { ok:false, reason:"PARTY_FULL" });
});

test("Creature manager uses self-scoped read and revisioned party RPC", async () => {
  const calls=[];
  let current=snapshot({ active:A, reserves:[B], creatures:[creature(A),creature(B)] });
  const client={
    rpc: async (name,args) => {
      calls.push({name,args});
      if(name===CREATURE_CORE_RPC) return {data:current,error:null};
      if(name===CREATURE_PARTY_SET_RPC) {
        current={...current,party:{
          revision:2,
          activeCreatureId:args.p_active_creature_id,
          reserveCreatureIds:[args.p_reserve1_creature_id,args.p_reserve2_creature_id].filter(Boolean)
        }};
        return {data:{status:"SUCCESS",party:current.party},error:null};
      }
      throw new Error("unexpected rpc");
    }
  };
  const manager=createCreatureManagerClient({
    getClient:()=>client,
    mutationKeyFactory:()=>"test-key"
  });
  await manager.setAccount("account");
  const result=await manager.setActive(B);
  assert.equal(result.outcome,"CHANGED");
  const mutation=calls.find(call=>call.name===CREATURE_PARTY_SET_RPC);
  assert.deepEqual(mutation.args,{
    p_active_creature_id:B,
    p_reserve1_creature_id:A,
    p_reserve2_creature_id:null,
    p_expected_revision:1,
    p_mutation_key:"creature-party:test-key"
  });
});

test("Creature panel projections preserve three slots and Creature memory", () => {
  const raw=parseCreatureCoreSnapshot(snapshot({
    active:A,reserves:[B],
    creatures:[creature(A),creature(B)],
    memories:[{
      creatureId:A,memoryTag:"memory.combat.victory",memoryCount:3,
      firstRememberedAt:"2026-10-04T00:00:00Z",lastRememberedAt:"2026-10-04T01:00:00Z",version:1
    }]
  }));
  assert.deepEqual(partySlotViews(raw).map(slot=>slot.creatureId),[A,B,null]);
  assert.deepEqual(creatureMemories(raw,A).map(memory=>[memory.label,memory.count]),[["전투 승리",3]]);
});
