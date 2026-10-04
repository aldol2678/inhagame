// Biryong Village NPC P0 runtime contract.
// Lore/personality comes from the 2026-10-04 village candidate. This file owns only
// runtime ids, low-cost appearances and the five shared World Clock slots used by P0.
import { NPC_WORLD_PERIODS } from "../../npc-factory/npc-world-time-contract.mjs";

export const BIRYONG_VILLAGE_NPC_PERIODS = NPC_WORLD_PERIODS;

export const BIRYONG_VILLAGE_NPC_DESTINATIONS = Object.freeze({
  STATION_WEST: Object.freeze({ id: "STATION_WEST", zoneId: "BR_STATION", label: "비룡역 서쪽 승강장", position: Object.freeze({ x: -8, z: 10 }) }),
  STATION_EAST: Object.freeze({ id: "STATION_EAST", zoneId: "BR_STATION", label: "비룡역 동쪽 승강장", position: Object.freeze({ x: 8, z: 10 }) }),
  STATION_NORTH: Object.freeze({ id: "STATION_NORTH", zoneId: "BR_STATION", label: "비룡역 광장", position: Object.freeze({ x: 0, z: 36 }) }),
  MARKET_CENTER: Object.freeze({ id: "MARKET_CENTER", zoneId: "BR_MARKET", label: "중앙시장", position: Object.freeze({ x: -8, z: 76 }) }),
  MARKET_SOUTH: Object.freeze({ id: "MARKET_SOUTH", zoneId: "BR_MARKET", label: "시장 남쪽", position: Object.freeze({ x: -10, z: 66 }) }),
  WORKSHOP_FRONT: Object.freeze({ id: "WORKSHOP_FRONT", zoneId: "BR_WORKSHOP", label: "신맥공방 앞", position: Object.freeze({ x: 14, z: 72 }) }),
  INN_FRONT: Object.freeze({ id: "INN_FRONT", zoneId: "BR_INN", label: "이담 여관 앞", position: Object.freeze({ x: -14, z: 58 }) }),
  COUNCIL_FRONT: Object.freeze({ id: "COUNCIL_FRONT", zoneId: "BR_COUNCIL", label: "평의회 앞", position: Object.freeze({ x: 8, z: 104 }) }),
  RESIDENTIAL_WEST: Object.freeze({ id: "RESIDENTIAL_WEST", zoneId: "BR_RESIDENTIAL", label: "주거 골목", position: Object.freeze({ x: -10, z: 112 }) }),

  // P0 outer destinations intentionally have no runtime Zone. NPCs enter these points and
  // become hidden through sink=true until a later period brings them back into implemented space.
  CHEONGWON_SINK: Object.freeze({ id: "CHEONGWON_SINK", zoneId: null, label: "청우원 방향", position: Object.freeze({ x: 52, z: 124 }) }),
  FIELDS_SINK: Object.freeze({ id: "FIELDS_SINK", zoneId: null, label: "비룡들판 방향", position: Object.freeze({ x: -56, z: 104 }) }),
  FOREST_SINK: Object.freeze({ id: "FOREST_SINK", zoneId: null, label: "청림 방향", position: Object.freeze({ x: 0, z: 132 }) }),
  LAB_SINK: Object.freeze({ id: "LAB_SINK", zoneId: null, label: "폐 맥로 연구소 방향", position: Object.freeze({ x: 54, z: 84 }) })
});

const slot = (destination, activity, { sink = false, need = "WORK", goal = "ROUTINE" } = {}) =>
  Object.freeze({ destination, activity, sink, need, goal, duration: 30 });

const appearance = (presentation, skin_tone, hair_style, hair_color, outfit_style, outfit_color, accent_color, accessory, height = 1) =>
  Object.freeze({ presentation, skin_tone, hair_style, hair_color, outfit_style, outfit_color, accent_color, accessory, height });

const npc = (id, name, publicRole, faction, appearanceData, schedule) => Object.freeze({
  id, name, publicRole, faction, appearance: appearanceData,
  schedule: Object.freeze(schedule)
});

export const BIRYONG_VILLAGE_NPC_ROSTER = Object.freeze([
  npc("BR_NPC_001", "강소라", "운송·화물 담당", "맥상회",
    appearance("female", 1, "ponytail", "#2f2623", "jacket", "#b65c43", "#f0c35a", "messenger", 1.00),
    [
      slot("STATION_WEST", "CARGO_CHECK", { need: "WORK", goal: "CHECK_CARGO" }),
      slot("MARKET_SOUTH", "DELIVERY", { need: "WORK", goal: "DELIVER_MARKET" }),
      slot("MARKET_CENTER", "MEAL", { need: "HUNGER", goal: "EAT" }),
      slot("WORKSHOP_FRONT", "DELIVERY", { need: "WORK", goal: "DELIVER_WORKSHOP" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_002", "한여울", "비룡역 정비사", "신맥공방",
    appearance("male", 1, "short", "#252b31", "jacket", "#48687c", "#e6b84d", "badge", 1.02),
    [
      slot("STATION_EAST", "MAINTENANCE", { need: "WORK", goal: "CHECK_STATION" }),
      slot("STATION_NORTH", "MAINTENANCE", { need: "WORK", goal: "REPAIR_STATION" }),
      slot("MARKET_CENTER", "MEAL", { need: "HUNGER", goal: "EAT" }),
      slot("WORKSHOP_FRONT", "REPAIR", { need: "WORK", goal: "WORKSHOP_REPAIR" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_003", "남이솔", "찻집 일·지도 제작", "무소속",
    appearance("female", 0, "bob", "#43352e", "cardigan", "#6f8b78", "#e7c86d", "book", 0.96),
    [
      slot("STATION_NORTH", "MAP_SKETCH", { need: "EXPLORE", goal: "SKETCH_STATION" }),
      slot("STATION_WEST", "TEA_SHOP", { need: "WORK", goal: "WORK_TEA_SHOP" }),
      slot("MARKET_CENTER", "SOCIAL", { need: "SOCIAL", goal: "MEET_MARKET" }),
      slot("FIELDS_SINK", "SKETCH_OUTER", { sink: true, need: "EXPLORE", goal: "SKETCH_OUTER" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_004", "윤하린", "수로기록관 견습", "청우원",
    appearance("female", 1, "long", "#2e2728", "cardigan", "#547d88", "#86c7c7", "book", 0.98),
    [
      slot("CHEONGWON_SINK", "RECORD_WATER", { sink: true, need: "WORK", goal: "WATER_RECORDS" }),
      slot("MARKET_SOUTH", "ERRAND", { need: "WORK", goal: "MARKET_ERRAND" }),
      slot("MARKET_CENTER", "SOCIAL", { need: "SOCIAL", goal: "MEET_FRIENDS" }),
      slot("STATION_NORTH", "SOCIAL", { need: "SOCIAL", goal: "MEET_STATION" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_005", "오미래", "비룡들판 농부", "주민대표",
    appearance("female", 2, "bun", "#332a23", "shirt", "#8a704c", "#b8d06b", "apron", 1.01),
    [
      slot("FIELDS_SINK", "FARM", { sink: true, need: "WORK", goal: "FARM_FIELDS" }),
      slot("FIELDS_SINK", "FARM", { sink: true, need: "WORK", goal: "FARM_FIELDS" }),
      slot("MARKET_SOUTH", "SELL_PRODUCE", { need: "WORK", goal: "MARKET_PRODUCE" }),
      slot("COUNCIL_FRONT", "RESIDENT_AFFAIRS", { need: "CIVIC", goal: "RESIDENT_COUNCIL" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_006", "한세온", "신맥공방 공방장", "신맥공방",
    appearance("female", 0, "sidepart", "#2d313a", "coat", "#3e5d62", "#66c7b0", "glasses", 1.03),
    [
      slot("LAB_SINK", "RESEARCH", { sink: true, need: "RESEARCH", goal: "PRIVATE_EXPERIMENT" }),
      slot("WORKSHOP_FRONT", "CRAFT", { need: "WORK", goal: "WORKSHOP_CRAFT" }),
      slot("INN_FRONT", "MEAL", { need: "HUNGER", goal: "EAT" }),
      slot("WORKSHOP_FRONT", "MENTOR", { need: "WORK", goal: "MENTOR_WORKSHOP" }),
      slot("LAB_SINK", "RESEARCH", { sink: true, need: "RESEARCH", goal: "NIGHT_RESEARCH" })
    ]),
  npc("BR_NPC_007", "류가람", "청림회 숲지기 대표", "청림회",
    appearance("male", 2, "short", "#29251f", "coat", "#4c6b4a", "#93bb65", "scarf", 1.05),
    [
      slot("FOREST_SINK", "PATROL", { sink: true, need: "WORK", goal: "FOREST_PATROL" }),
      slot("FOREST_SINK", "SURVEY", { sink: true, need: "WORK", goal: "FOREST_SURVEY" }),
      slot("FOREST_SINK", "FIELD_MEAL", { sink: true, need: "HUNGER", goal: "FIELD_MEAL" }),
      slot("COUNCIL_FRONT", "REPORT", { need: "CIVIC", goal: "REPORT_COUNCIL" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ]),
  npc("BR_NPC_008", "이담", "여관·식당 주인", "무소속",
    appearance("male", 2, "medium", "#4d4035", "sweater", "#7b5a42", "#d9b472", "apron", 1.00),
    [
      slot("MARKET_CENTER", "SHOPPING", { need: "WORK", goal: "BUY_INGREDIENTS" }),
      slot("INN_FRONT", "PREPARE_INN", { need: "WORK", goal: "PREPARE_INN" }),
      slot("INN_FRONT", "SERVE_MEAL", { need: "WORK", goal: "LUNCH_SERVICE" }),
      slot("INN_FRONT", "SOCIAL", { need: "SOCIAL", goal: "EVENING_SERVICE" }),
      slot("RESIDENTIAL_WEST", "HOME", { sink: true, need: "REST", goal: "GO_HOME" })
    ])
]);

export const BIRYONG_VILLAGE_NPC_BY_ID = new Map(BIRYONG_VILLAGE_NPC_ROSTER.map(item => [item.id, item]));

export function validateBiryongVillageNpcRoster() {
  if (BIRYONG_VILLAGE_NPC_ROSTER.length !== 8) throw new Error("Expected 8 Biryong Village P0 NPCs");
  const ids = new Set();
  for (const item of BIRYONG_VILLAGE_NPC_ROSTER) {
    if (ids.has(item.id)) throw new Error(`Duplicate Biryong NPC id: ${item.id}`);
    ids.add(item.id);
    if (item.schedule.length !== BIRYONG_VILLAGE_NPC_PERIODS.length) throw new Error(`Schedule length mismatch: ${item.id}`);
    for (const entry of item.schedule) {
      if (!BIRYONG_VILLAGE_NPC_DESTINATIONS[entry.destination]) throw new Error(`Unknown Biryong NPC destination: ${entry.destination}`);
    }
  }
  return true;
}

validateBiryongVillageNpcRoster();
