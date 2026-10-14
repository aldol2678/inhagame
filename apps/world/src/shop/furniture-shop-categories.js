// Furniture store presentation groups only. RPC listings remain the sole source of sale authority.
export const FURNITURE_SHOP_CATEGORIES = Object.freeze([
  Object.freeze({ id: "all", label: "전체", icon: "✦" }),
  Object.freeze({ id: "bedding", label: "침구", icon: "🛏️" }),
  Object.freeze({ id: "seating", label: "책상·의자", icon: "🪑" }),
  Object.freeze({ id: "light", label: "조명", icon: "💡" }),
  Object.freeze({ id: "floor", label: "바닥", icon: "▤" }),
  Object.freeze({ id: "decor", label: "소품", icon: "🧸" }),
  Object.freeze({ id: "wall", label: "벽장식", icon: "🖼️" }),
  Object.freeze({ id: "storage", label: "수납", icon: "▦" }),
  Object.freeze({ id: "kitchen", label: "주방", icon: "☕" })
]);

const GROUPS = Object.freeze({
  "furniture.induck_cushion": "bedding",
  "furniture.dorm_single_sofa": "seating",
  "furniture.induck_chair": "seating",
  "furniture.dorm_side_table_low": "seating",
  "furniture.dorm_monitor": "seating",
  "furniture.dorm_desk_lamp": "light",
  "furniture.campus_rug_blue": "floor",
  "furniture.mini_induck": "decor",
  "furniture.mcm_2026_landlord_figure": "decor",
  "furniture.dorm_plant_medium": "decor",
  "furniture.study_books_set": "decor",
  "furniture.campus_map_poster": "wall",
  "furniture.mcm_2026_poster": "wall",
  "furniture.dorm_resident_plate": "wall",
  "furniture.dorm_bookshelf_slim": "storage",
  "furniture.dorm_trophy_shelf": "storage",
  "furniture.cooking_station": "kitchen"
});

export function furnitureShopCategory(itemId) {
  return GROUPS[itemId] ?? "decor";
}

export function furnitureShopTabs(offers = []) {
  const present = new Set(offers.map(offer => furnitureShopCategory(offer.itemId)));
  return FURNITURE_SHOP_CATEGORIES.filter(category => category.id === "all" || present.has(category.id));
}

export function filterFurnitureShopOffers(offers = [], category = "all") {
  if (category === "all") return offers;
  return offers.filter(offer => furnitureShopCategory(offer.itemId) === category);
}
