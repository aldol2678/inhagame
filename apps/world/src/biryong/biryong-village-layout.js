// Biryong Village P0 blockout and region-local Place Zone contract.
// Coordinates are local to BIRYONG_REALM (+X east, +Z north, 1 WU ~= 2 m).
// Lore names follow the 2026-10-04 village candidate; this file owns only the P0 runtime geometry.

const freezePoint = (x, z) => Object.freeze({ x, z });
const rect = (x, z, width, depth) => Object.freeze([
  freezePoint(x - width / 2, z - depth / 2),
  freezePoint(x + width / 2, z - depth / 2),
  freezePoint(x + width / 2, z + depth / 2),
  freezePoint(x - width / 2, z + depth / 2)
]);

export const BIRYONG_REALM_P0_BOUNDS = Object.freeze({
  minX: -70, maxX: 70,
  minZ: -32, maxZ: 138
});

export const BIRYONG_VILLAGE_ANCHORS = Object.freeze({
  stationNorth: freezePoint(0, 34),
  villageGate: freezePoint(0, 48),
  villageCenter: freezePoint(0, 75),
  market: freezePoint(-14, 74),
  inn: freezePoint(-24, 58),
  workshop: freezePoint(24, 66),
  council: freezePoint(18, 104),
  residential: freezePoint(-20, 112),
  northFuture: freezePoint(0, 132)
});

export const BIRYONG_VILLAGE_ROADS = Object.freeze([
  Object.freeze({
    id: "br_station_village_road",
    width: 6,
    points: Object.freeze([
      freezePoint(0, 34),
      freezePoint(0, 75)
    ])
  }),
  Object.freeze({
    id: "br_market_workshop_lane",
    width: 5,
    points: Object.freeze([
      freezePoint(-34, 75),
      freezePoint(34, 75)
    ])
  }),
  Object.freeze({
    id: "br_council_lane",
    width: 4,
    points: Object.freeze([
      freezePoint(0, 75),
      freezePoint(0, 112)
    ])
  }),
  Object.freeze({
    id: "br_residential_lane",
    width: 4,
    points: Object.freeze([
      freezePoint(-30, 103),
      freezePoint(28, 103)
    ])
  })
]);

export const BIRYONG_VILLAGE_WATER_CHANNELS = Object.freeze([
  Object.freeze({
    id: "br_village_channel_main",
    width: 1.5,
    points: Object.freeze([
      freezePoint(12, 50),
      freezePoint(12, 91),
      freezePoint(8, 119),
      freezePoint(8, 132)
    ])
  })
]);

const building = (id, zoneId, label, x, z, width, depth, height, style) => Object.freeze({
  id, zoneId, label, x, z, width, depth, height, style,
  polygon: rect(x, z, width, depth)
});

export const BIRYONG_VILLAGE_BUILDINGS = Object.freeze([
  building("br_inn", "BR_INN", "이담 여관", -24, 58, 13, 10, 5.2, "inn"),
  building("br_market_hall", "BR_MARKET", "중앙시장", -18, 77, 15, 10, 4.5, "market"),
  building("br_market_warehouse", "BR_MARKET", "창고", -31, 68, 10, 8, 4.0, "warehouse"),
  building("br_workshop_main", "BR_WORKSHOP", "신맥공방", 25, 65, 15, 11, 5.0, "workshop"),
  building("br_workshop_shed", "BR_WORKSHOP", "공방 창고", 36, 78, 9, 8, 3.8, "workshop"),
  building("br_council", "BR_COUNCIL", "비룡마을 평의회", 18, 104, 16, 12, 5.5, "council"),
  building("br_house_w1", "BR_RESIDENTIAL", "주거지", -28, 100, 10, 8, 4.2, "house"),
  building("br_house_w2", "BR_RESIDENTIAL", "주거지", -31, 116, 11, 9, 4.4, "house"),
  building("br_house_e1", "BR_RESIDENTIAL", "주거지", 28, 116, 10, 8, 4.0, "house")
]);

export const BIRYONG_REALM_P0_OBSTACLES = Object.freeze(
  BIRYONG_VILLAGE_BUILDINGS.map(item => Object.freeze({
    id: item.id,
    polygon: item.polygon,
    minY: 0,
    maxY: item.height
  }))
);

const zone = (id, displayName, minX, maxX, minZ, maxZ, priority) => Object.freeze({
  id, displayName, minX, maxX, minZ, maxZ, priority
});

// These are region-local runtime zones. They do not join Campus Realtime Place Zone presence yet.
export const BIRYONG_REALM_PLACE_ZONES = Object.freeze([
  zone("BR_STATION", "비룡역", -38, 38, -32, 46, 100),
  zone("BR_INN", "이담 여관", -36, -12, 48, 68, 95),
  zone("BR_WORKSHOP", "신맥공방 거리", 12, 43, 48, 86, 90),
  zone("BR_MARKET", "중앙시장 · 창고거리", -38, 10, 60, 90, 85),
  zone("BR_COUNCIL", "비룡마을 평의회", 8, 30, 92, 116, 80),
  zone("BR_RESIDENTIAL", "비룡마을 주거 골목", -45, 42, 91, 132, 20)
].sort((a, b) => b.priority - a.priority));

export function getBiryongRealmPlaceZone(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  return BIRYONG_REALM_PLACE_ZONES.find(zone =>
    position.x >= zone.minX && position.x <= zone.maxX &&
    position.z >= zone.minZ && position.z <= zone.maxZ
  ) ?? null;
}
