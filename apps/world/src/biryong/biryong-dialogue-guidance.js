// Public Stage-1 place suggestions only. No quest, relationship, spawn or reward mutation.
const routes=Object.freeze({
  BR_NPC_001:Object.freeze({work:Object.freeze(['station','market'])}),
  BR_NPC_003:Object.freeze({map:Object.freeze(['station','market','workshop','inn','council','residential','return']),station:Object.freeze(['station','return'])}),
  BR_NPC_006:Object.freeze({craft:Object.freeze(['workshop'])})
});
export function biryongDialogueDestinations(npcId,topicId) {
  return Object.freeze((routes[npcId]?.[topicId]??[]).map(key=>`poi.biryong-realm.${key}`));
}
