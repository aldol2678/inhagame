// INHA WORLD · Campus NPC Relationship Registry v0.1.
// Product-semantic rules only. Persistent player↔NPC state is server-authoritative.
// Stable npc_id is the only character key: display names never own relationship state.

export const NPC_RELATIONSHIP_DEFINITION_VERSION = 1;

export const NPC_RELATIONSHIP_TIER = Object.freeze({
  STRANGER: 'STRANGER',
  FAMILIAR: 'FAMILIAR',
  FRIENDLY: 'FRIENDLY',
  FRIEND: 'FRIEND',
  TRUSTED: 'TRUSTED'
});

export const NPC_RELATIONSHIP_CLASS = Object.freeze({
  HERO: 'HERO',
  RESIDENT: 'RESIDENT',
  CROWD: 'CROWD'
});

export const NPC_AFFINITY_EVENT = Object.freeze({
  FIRST_MEETING: 'FIRST_MEETING',
  REUNION: 'REUNION',
  MEANINGFUL_DIALOGUE: 'MEANINGFUL_DIALOGUE',
  SHARED_ACTIVITY: 'SHARED_ACTIVITY',
  HELPED_NPC: 'HELPED_NPC',
  PERSONAL_QUEST_STEP: 'PERSONAL_QUEST_STEP',
  PERSONAL_QUEST_COMPLETE: 'PERSONAL_QUEST_COMPLETE',
  MEANINGFUL_CHOICE: 'MEANINGFUL_CHOICE',
  NEGATIVE_CHOICE: 'NEGATIVE_CHOICE',
  REPEAT_DIALOGUE: 'REPEAT_DIALOGUE'
});

export const NPC_AFFINITY_SIGNAL = Object.freeze({
  CAMPUS_DISCOVERY:'CAMPUS_DISCOVERY', SCENIC_OBSERVATION:'SCENIC_OBSERVATION',
  CREATIVE_HELP:'CREATIVE_HELP', TECHNICAL_INVESTIGATION:'TECHNICAL_INVESTIGATION',
  PHOTOGRAPHY:'PHOTOGRAPHY', EVIDENCE_BASED_HELP:'EVIDENCE_BASED_HELP',
  CAMPUS_HISTORY:'CAMPUS_HISTORY', ARCHIVE_FIND:'ARCHIVE_FIND', LISTENED_STORY:'LISTENED_STORY',
  SOCIAL_ACTIVITY:'SOCIAL_ACTIVITY', BACKGATE_MEAL:'BACKGATE_MEAL', CYCLING:'CYCLING',
  HELPED_OTHER_NPC:'HELPED_OTHER_NPC', SHOP_FEEDBACK:'SHOP_FEEDBACK', STOCK_PROBLEM:'STOCK_PROBLEM',
  CUSTOMER_HELP:'CUSTOMER_HELP', PATTERN_OBSERVATION:'PATTERN_OBSERVATION',
  QUIET_OBSERVATION:'QUIET_OBSERVATION', BIRDWATCHING:'BIRDWATCHING',
  ECOLOGY_OBSERVATION:'ECOLOGY_OBSERVATION', FISHING_SHARED:'FISHING_SHARED',
  WILDLIFE_CARE:'WILDLIFE_CARE', CAMPUS_EVENT:'CAMPUS_EVENT', CREATIVE_FEEDBACK:'CREATIVE_FEEDBACK',
  PERFORMANCE:'PERFORMANCE', PHOTO_SPOT:'PHOTO_SPOT', MEDIA_ACTIVITY:'MEDIA_ACTIVITY',
  RESPECTED_CAMERA_BOUNDARY:'RESPECTED_CAMERA_BOUNDARY', MOBILITY_TEST:'MOBILITY_TEST',
  ROUTE_DISCOVERY:'ROUTE_DISCOVERY', MOUNT_USE:'MOUNT_USE', MECHANICAL_HELP:'MECHANICAL_HELP'
});

export const NPC_RELATIONSHIP_THRESHOLDS = Object.freeze([
  Object.freeze({ tier:NPC_RELATIONSHIP_TIER.STRANGER, minAffinity:0, maxAffinity:9 }),
  Object.freeze({ tier:NPC_RELATIONSHIP_TIER.FAMILIAR, minAffinity:10, maxAffinity:24 }),
  Object.freeze({ tier:NPC_RELATIONSHIP_TIER.FRIENDLY, minAffinity:25, maxAffinity:44 }),
  Object.freeze({ tier:NPC_RELATIONSHIP_TIER.FRIEND, minAffinity:45, maxAffinity:69 }),
  Object.freeze({ tier:NPC_RELATIONSHIP_TIER.TRUSTED, minAffinity:70, maxAffinity:100 })
]);

const eventTypes=new Set(Object.values(NPC_AFFINITY_EVENT));
const signals=new Set(Object.values(NPC_AFFINITY_SIGNAL));

export const NPC_AFFINITY_EVENT_RULES=Object.freeze({
  [NPC_AFFINITY_EVENT.FIRST_MEETING]:Object.freeze({base:Object.freeze([2,0]),signalScale:Object.freeze([0,0])}),
  [NPC_AFFINITY_EVENT.REUNION]:Object.freeze({base:Object.freeze([1,0]),signalScale:Object.freeze([0,0])}),
  [NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE]:Object.freeze({base:Object.freeze([1,0]),signalScale:Object.freeze([1,0])}),
  [NPC_AFFINITY_EVENT.SHARED_ACTIVITY]:Object.freeze({base:Object.freeze([2,1,0]),signalScale:Object.freeze([1,.5,0])}),
  [NPC_AFFINITY_EVENT.HELPED_NPC]:Object.freeze({base:Object.freeze([3,1,0]),signalScale:Object.freeze([1,.5,0])}),
  [NPC_AFFINITY_EVENT.PERSONAL_QUEST_STEP]:Object.freeze({base:Object.freeze([4,0]),signalScale:Object.freeze([1,0])}),
  [NPC_AFFINITY_EVENT.PERSONAL_QUEST_COMPLETE]:Object.freeze({base:Object.freeze([8,0]),signalScale:Object.freeze([1,0])}),
  [NPC_AFFINITY_EVENT.MEANINGFUL_CHOICE]:Object.freeze({base:Object.freeze([3,0]),signalScale:Object.freeze([1,0])}),
  [NPC_AFFINITY_EVENT.NEGATIVE_CHOICE]:Object.freeze({base:Object.freeze([-5,0]),signalScale:Object.freeze([0,0])}),
  [NPC_AFFINITY_EVENT.REPEAT_DIALOGUE]:Object.freeze({base:Object.freeze([0]),signalScale:Object.freeze([0])})
});

function freezeSignalWeights(raw={}){
  for(const [signal,delta] of Object.entries(raw)){
    if(!signals.has(signal)) throw new TypeError(`Unknown affinity signal: ${signal}`);
    if(!Number.isInteger(delta)||delta < -5||delta > 5) throw new TypeError(`Invalid signal delta for ${signal}`);
  }
  return Object.freeze({...raw});
}

export function createNpcRelationshipRule(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new TypeError('NPC relationship rule must be an object');
  if(!/^INKYUNG-NPC-[0-9]{3}$/.test(raw.npcId??'')) throw new TypeError('Invalid relationship npcId');
  if(raw.relationshipClass!==NPC_RELATIONSHIP_CLASS.HERO) throw new TypeError(`Unsupported relationship class for ${raw.npcId}`);
  if(!/^hero\.[a-z][a-z0-9_]{2,63}$/.test(raw.profileKey??'')) throw new TypeError(`Invalid profileKey for ${raw.npcId}`);
  return Object.freeze({
    npcId:raw.npcId, relationshipClass:raw.relationshipClass, profileKey:raw.profileKey,
    definitionVersion:NPC_RELATIONSHIP_DEFINITION_VERSION,
    signalWeights:freezeSignalWeights(raw.signalWeights)
  });
}
const hero=(npcId,profileKey,signalWeights)=>createNpcRelationshipRule({
  npcId,relationshipClass:NPC_RELATIONSHIP_CLASS.HERO,profileKey,signalWeights
});

export const HERO_NPC_RELATIONSHIP_RULES=Object.freeze([
  hero('INKYUNG-NPC-001','hero.first_walk_guide',{CAMPUS_DISCOVERY:2,SCENIC_OBSERVATION:2,CREATIVE_HELP:1}),
  hero('INKYUNG-NPC-002','hero.tech_ta',{TECHNICAL_INVESTIGATION:2,PHOTOGRAPHY:1,EVIDENCE_BASED_HELP:2}),
  hero('INKYUNG-NPC-005','hero.campus_historian',{CAMPUS_HISTORY:2,ARCHIVE_FIND:2,LISTENED_STORY:1}),
  hero('INKYUNG-NPC-008','hero.social_cyclist',{SOCIAL_ACTIVITY:1,BACKGATE_MEAL:1,CYCLING:1,HELPED_OTHER_NPC:2}),
  hero('INKYUNG-NPC-012','hero.shop_staff',{SHOP_FEEDBACK:1,STOCK_PROBLEM:2,CUSTOMER_HELP:1}),
  hero('INKYUNG-NPC-016','hero.pattern_observer',{PATTERN_OBSERVATION:2,QUIET_OBSERVATION:1,BIRDWATCHING:1}),
  hero('INKYUNG-NPC-029','hero.ecology_student',{ECOLOGY_OBSERVATION:2,FISHING_SHARED:1,WILDLIFE_CARE:2}),
  hero('INKYUNG-NPC-034','hero.content_planner',{CAMPUS_EVENT:2,CREATIVE_FEEDBACK:2,PERFORMANCE:1}),
  hero('INKYUNG-NPC-042','hero.media_observer',{PHOTO_SPOT:1,MEDIA_ACTIVITY:2,RESPECTED_CAMERA_BOUNDARY:2}),
  hero('INKYUNG-NPC-046','hero.mobility_student',{MOBILITY_TEST:3,ROUTE_DISCOVERY:1,MOUNT_USE:1,MECHANICAL_HELP:2})
]);

export function createNpcRelationshipRegistry({rules=HERO_NPC_RELATIONSHIP_RULES}={}){
  const byId=new Map(),byProfileKey=new Map();
  for(const raw of rules){
    const rule=createNpcRelationshipRule(raw);
    if(byId.has(rule.npcId)) throw new Error(`Duplicate relationship npcId: ${rule.npcId}`);
    if(byProfileKey.has(rule.profileKey)) throw new Error(`Duplicate relationship profileKey: ${rule.profileKey}`);
    byId.set(rule.npcId,rule);byProfileKey.set(rule.profileKey,rule);
  }
  return Object.freeze({
    get:npcId=>byId.get(npcId)??null,getByProfileKey:key=>byProfileKey.get(key)??null,
    has:npcId=>byId.has(npcId),list:()=>Object.freeze([...byId.values()]),get size(){return byId.size;}
  });
}
export const NPC_RELATIONSHIP_REGISTRY=createNpcRelationshipRegistry();

export function relationshipTierFor(affinity){
  if(!Number.isInteger(affinity)||affinity<0||affinity>100) throw new TypeError('Affinity must be an integer from 0 to 100');
  return NPC_RELATIONSHIP_THRESHOLDS.find(row=>affinity>=row.minAffinity&&affinity<=row.maxAffinity).tier;
}
const occurrenceValue=(values,occurrence)=>values[Math.min(occurrence-1,values.length-1)]??0;

export function resolveNpcAffinityDelta(npcId,{eventType,signal=null,occurrence=1}={}){
  const rule=NPC_RELATIONSHIP_REGISTRY.get(npcId);
  if(!rule) return null;
  if(!eventTypes.has(eventType)) throw new TypeError(`Unknown affinity event: ${eventType}`);
  if(signal!==null&&!signals.has(signal)) throw new TypeError(`Unknown affinity signal: ${signal}`);
  if(!Number.isInteger(occurrence)||occurrence<1) throw new TypeError('Affinity occurrence must be a positive integer');
  const policy=NPC_AFFINITY_EVENT_RULES[eventType];
  const raw=occurrenceValue(policy.base,occurrence)+
    Math.trunc((rule.signalWeights[signal]??0)*occurrenceValue(policy.signalScale,occurrence));
  return Math.max(-10,Math.min(10,raw));
}

export function projectNpcRelationshipChange(currentAffinity,delta){
  if(!Number.isInteger(currentAffinity)||currentAffinity<0||currentAffinity>100) throw new TypeError('Affinity must be an integer from 0 to 100');
  if(!Number.isInteger(delta)||delta < -10||delta > 10) throw new TypeError('Affinity delta must be an integer from -10 to 10');
  const affinity=Math.max(0,Math.min(100,currentAffinity+delta));
  const tierBefore=relationshipTierFor(currentAffinity),tierAfter=relationshipTierFor(affinity);
  return Object.freeze({affinityBefore:currentAffinity,affinityAfter:affinity,tierBefore,tierAfter,tierChanged:tierBefore!==tierAfter});
}
