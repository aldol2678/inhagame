// INHA WORLD Collection C0 · Item Catalog (code canon).
// The catalog defines items only: never owners, quantities, prices, shops or reward amounts.
// Ownership lives in the server DB (C1, private.world_player_items). The DB keeps a minimal
// grant-authority mirror (private.world_item_catalog: id / category / ownership policy / max stack /
// status) that must equal this file; supabase/tests/integration/inventory.integration.test.mjs
// checks the two stay identical.

export const ITEM_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

export const ITEM_CATEGORIES = Object.freeze(['WEARABLE', 'BADGE', 'EMOTE', 'FURNITURE', 'MOUNT', 'MOUNT_COSMETIC', 'MEMORABILIA', 'MATERIAL', 'ROOM_FINISH']);
export const APPEARANCE_SLOTS = Object.freeze(['BODY', 'FACE', 'HAIR', 'HEAD', 'TOP', 'BOTTOM', 'SHOES', 'BACK', 'ACCESSORY']);
// BADGE is a Profile Decoration slot, not a Character Appearance slot.
export const PROFILE_SLOTS = Object.freeze(['BADGE']);
export const ROOM_FINISH_SLOTS = Object.freeze(['wall', 'floor']);
export const FURNITURE_SUBTYPES = Object.freeze(['WALL_DECOR', 'FLOOR_DECOR', 'CHAIR', 'LIGHT', 'DECOR']);
export const RARITIES = Object.freeze(['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL']);
export const ITEM_STATUSES = Object.freeze(['ACTIVE', 'LOCKED', 'COMING_SOON', 'DISABLED', 'HIDDEN']);
// Statuses that refuse new grants. Existing ownership is never removed for any status.
export const GRANT_BLOCKED_STATUSES = Object.freeze(['DISABLED', 'HIDDEN']);
export const OWNERSHIP_POLICIES = Object.freeze(['UNIQUE', 'STACKABLE']);
export const TRADE_POLICIES = Object.freeze(['ACCOUNT_BOUND']);
export const ACQUISITION_SOURCES = Object.freeze([
  'DEFAULT', 'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'SHOP', 'INHAGAME_REWARD',
  'ACTIVITY', 'CRAFTING', 'EQUIPMENT', 'RESEARCH', 'SYSTEM', 'ADMIN'
]);

// ID prefix -> category (and the slot a wearable prefix implies).
const PREFIX_CATEGORY = Object.freeze({
  body: 'WEARABLE', face: 'WEARABLE', hair: 'WEARABLE', head: 'WEARABLE', top: 'WEARABLE',
  bottom: 'WEARABLE', shoes: 'WEARABLE', back: 'WEARABLE', accessory: 'WEARABLE',
  badge: 'BADGE', emote: 'EMOTE', furniture: 'FURNITURE', mount: 'MOUNT',
  mount_cosmetic: 'MOUNT_COSMETIC', memorabilia: 'MEMORABILIA', material: 'MATERIAL', finish: 'ROOM_FINISH'
});

const MCM_2026 = 'event.mcm_2026';

function item(itemId, displayName, description, { category, rarity, equipSlot = null, subtype = null,
  status = 'COMING_SOON', acquisition, tags = [], eventId = null, introducedVersion, modelAssetId = null, iconAssetId = null,
  cosmeticOnly = true, ownershipPolicy = 'UNIQUE', stackable = false, maxStack = null }) {
  return Object.freeze({
    itemId, displayName, description, category, rarity, equipSlot, subtype,
    cosmeticOnly, ownershipPolicy, tradePolicy: 'ACCOUNT_BOUND', stackable, maxStack,
    iconAssetId, modelAssetId,
    tags: Object.freeze([...tags]), status, eventId,
    acquisition: Object.freeze(acquisition.map(a => Object.freeze({ ...a }))),
    introducedVersion
  });
}
const wear = (slot, extra) => ({ category: 'WEARABLE', equipSlot: slot, ...extra });
const badge = extra => ({ category: 'BADGE', equipSlot: 'BADGE', ...extra });
const furniture = (subtype, extra) => ({ category: 'FURNITURE', subtype, ...extra });
const memorabilia = extra => ({ category: 'MEMORABILIA', ...extra });
const finish = (slot, extra) => ({ category: 'ROOM_FINISH', ...extra,
  tags: ['housing', 'room_finish', slot, ...(extra.tags ?? [])] });
const material = extra => ({ category: 'MATERIAL', cosmeticOnly: false, ownershipPolicy: 'STACKABLE', stackable: true,
  maxStack: 99, ...extra });

export const ITEM_CATALOG = Object.freeze([
  // ---- Collection VS01 pilot 6 (C0 §1.6): foundation fixtures, kept unchanged ----
  item('head.inha_cap', '인하 모자', '인하대학교 로고가 들어간 기본 모자.',
    wear('HEAD', { rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.head.inha_cap.v1', acquisition: [{ source: 'DEFAULT' }], tags: ['starter'], introducedVersion: 'c0.v1' })),
  item('head.inkyung_duck', '인경호 오리모자', '인경호 오리를 닮은 모자.',
    wear('HEAD', { rarity: 'UNCOMMON', acquisition: [{ source: 'EXPLORATION' }], introducedVersion: 'c0.v1' })),
  item('top.inha_basic', '인하 기본 티셔츠', '캠퍼스 생활의 시작을 함께하는 기본 티셔츠.',
    wear('TOP', { rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.top.inha_basic.v1', acquisition: [{ source: 'DEFAULT' }], tags: ['starter'], introducedVersion: 'c0.v1' })),
  item('back.freshman_bag', '새내기 가방', '새 학기의 설렘을 담은 가방.',
    wear('BACK', { rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.back.freshman_bag.v1', acquisition: [{ source: 'DEFAULT' }], tags: ['starter'], introducedVersion: 'c0.v1' })),
  item('badge.main_gate', '정문 첫걸음 배지', '정문에서 캠퍼스 탐방을 시작한 기록.',
    badge({ rarity: 'UNCOMMON', status: 'ACTIVE', iconAssetId: 'icon.badge.main_gate.v1', acquisition: [{ source: 'QUEST', ref: 'quest.first_campus' }], introducedVersion: 'c0.v1' })),
  item('emote.wave_plus', '씩씩한 인사', '평소보다 힘찬 인사 감정표현.',
    { category: 'EMOTE', rarity: 'UNCOMMON', acquisition: [{ source: 'QUEST' }], introducedVersion: 'c0.v1' }),

  // ---- Starter Catalog 20 (C0–C2 §11) · campus / shop 12 ----
  item('top.induck_hoodie', '인덕 기본 후드', '인덕이 로고가 들어간 편안한 후드.',
    wear('TOP', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['campus', 'vs_economy'], introducedVersion: 'c0.v2',
      modelAssetId: 'equipment.top.induck_hoodie.v1' })),
  item('head.induck_cap', '인덕 캠퍼스 캡', '캠퍼스 산책에 어울리는 인덕이 캡.',
    wear('HEAD', { rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.head.induck_cap.v1', acquisition: [{ source: 'SHOP' }], tags: ['campus', 'vs_economy'], introducedVersion: 'c0.v2',
      modelAssetId: 'equipment.head.induck_cap.v1' })),
  item('back.induck_backpack', '인덕 백팩', '수업 자료를 넉넉히 담는 인덕이 백팩.',
    wear('BACK', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['campus'], introducedVersion: 'c0.v2',
      modelAssetId: 'equipment.back.induck_backpack.v1' })),
  item('shoes.campus_sneakers', '캠퍼스 스니커즈', '캠퍼스 어디든 걷기 좋은 스니커즈.',
    wear('SHOES', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['campus'], introducedVersion: 'c0.v2' })),
  item('top.mcm_jacket', '문콘경 과잠', '문화콘텐츠문화경영학과 과잠.',
    wear('TOP', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['department'], introducedVersion: 'c0.v2' })),
  item('memorabilia.campus_mug', '인하 캠퍼스 머그', '캠퍼스 풍경이 그려진 머그컵.',
    memorabilia({ rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['campus'], introducedVersion: 'c0.v2' })),
  item('furniture.campus_map_poster', '캠퍼스 지도 포스터', '인하대 캠퍼스 지도를 담은 벽 포스터.',
    furniture('WALL_DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['campus', 'vs_economy'], introducedVersion: 'c0.v2' })),
  item('furniture.induck_cushion', '인덕 쿠션', '인덕이 얼굴이 수놓인 푹신한 쿠션.',
    furniture('DECOR', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'vs_economy'], introducedVersion: 'c0.v2' })),
  item('furniture.dorm_desk_lamp', '생활관 스탠드', '밤샘 공부를 밝혀주는 생활관 스탠드.',
    furniture('LIGHT', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm'], introducedVersion: 'c0.v2' })),
  item('furniture.induck_chair', '인덕 책상 의자', '오래 앉아도 편한 인덕이 책상 의자.',
    furniture('CHAIR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm'], introducedVersion: 'c0.v2' })),
  item('furniture.mini_induck', '미니 인덕 피규어', '책상 위에 올려두는 작은 인덕이 피규어.',
    furniture('DECOR', { rarity: 'RARE', acquisition: [{ source: 'SHOP' }], tags: ['dorm'], introducedVersion: 'c0.v2' })),
  item('furniture.campus_rug_blue', '파란 캠퍼스 러그', '인하 블루 색의 바닥 러그.',
    furniture('FLOOR_DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm'], introducedVersion: 'c0.v2' })),


  // ---- Starter Catalog 20 · quest / collection 3 ----
  item('badge.campus_first_step', '캠퍼스 첫걸음 배지', '캠퍼스에서 첫걸음을 내디딘 기록.',
    badge({ rarity: 'COMMON', acquisition: [{ source: 'QUEST' }], tags: ['vs_economy'], introducedVersion: 'c0.v2' })),
  item('badge.campus_explorer', '탐험가 배지', '캠퍼스 곳곳을 탐험한 기록.',
    badge({ rarity: 'RARE', acquisition: [{ source: 'EXPLORATION' }], introducedVersion: 'c0.v2' })),
  item('furniture.dorm_resident_plate', '생활관 주민 명패', '생활관 주민임을 알리는 문패.',
    furniture('WALL_DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'QUEST' }], tags: ['dorm'], introducedVersion: 'c0.v2' })),

  // ---- Starter Catalog 20 · 2026 문콘경 event 5 (a record of taking part, not power) ----
  item('badge.mcm_2026_landlord', '건물주 챌린지 배지', '2026 문콘경 건물주 미니게임 첫 클리어 기록.',
    badge({ rarity: 'RARE', eventId: MCM_2026, acquisition: [{ source: 'EVENT', ref: MCM_2026 }], tags: ['event', 'mcm_2026', 'vs_economy'], introducedVersion: 'c0.v2' })),
  item('memorabilia.mcm_2026_wristband', '일일호프 기념 팔찌', '2026 문콘경 일일호프 참여 기념 팔찌.',
    memorabilia({ rarity: 'UNCOMMON', eventId: MCM_2026, acquisition: [{ source: 'EVENT', ref: MCM_2026 }], tags: ['event', 'mcm_2026'], introducedVersion: 'c0.v2' })),
  item('top.mcm_2026_survivor', '좀비대학교 생존자 상의', '2026 문콘경 핵심 이벤트 퀘스트 완주 기록.',
    wear('TOP', { rarity: 'RARE', eventId: MCM_2026, acquisition: [{ source: 'EVENT', ref: MCM_2026 }], tags: ['event', 'mcm_2026', 'vs_economy'], introducedVersion: 'c0.v2',
      modelAssetId: 'equipment.top.mcm_2026_survivor.v1' })),
  item('furniture.mcm_2026_landlord_figure', '건물주 미니어처', '2026 문콘경 건물주 챌린지 추가 성취 기념 미니어처.',
    furniture('DECOR', { rarity: 'SPECIAL', eventId: MCM_2026, acquisition: [{ source: 'EVENT', ref: MCM_2026 }], tags: ['event', 'mcm_2026'], introducedVersion: 'c0.v2' })),
  item('furniture.mcm_2026_poster', '2026 일일호프 포스터', '2026 문콘경 일일호프 전체 완주 기념 포스터.',
    furniture('WALL_DECOR', { rarity: 'SPECIAL', eventId: MCM_2026, acquisition: [{ source: 'EVENT', ref: MCM_2026 }], tags: ['event', 'mcm_2026', 'vs_economy'], introducedVersion: 'c0.v2' })),

  // ---- Housing F0 · Personal Room Starter 7 (placement-ready, acquisition not activated here) ----
  item('furniture.dorm_single_sofa', '생활관 1인 소파', '작은 방에서도 휴식 공간을 만드는 1인 소파.',
    furniture('CHAIR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'seating'], introducedVersion: 'housing.f0' })),
  item('furniture.dorm_side_table_low', '낮은 사이드테이블', '소파와 러그 곁에 두기 좋은 낮은 테이블.',
    furniture('DECOR', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'table'], introducedVersion: 'housing.f0' })),
  item('furniture.dorm_bookshelf_slim', '슬림 책장', '중앙 동선을 덜 차지하도록 깊이를 줄인 생활관 책장.',
    furniture('DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'storage'], introducedVersion: 'housing.f0' })),
  item('furniture.dorm_plant_medium', '중형 화분', '방에 자연스러운 실루엣을 더하는 중형 화분.',
    furniture('DECOR', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'plant'], introducedVersion: 'housing.f0' })),
  item('furniture.dorm_monitor', '탁상 모니터', '책상 위 Study 구성을 위한 모니터. 별도 Device 기능은 포함하지 않는다.',
    furniture('DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'electronics'], introducedVersion: 'housing.f0' })),
  item('furniture.dorm_trophy_shelf', '트로피 선반', '대학생활의 기념품과 성취를 보여주기 위한 전시 선반.',
    furniture('DECOR', { rarity: 'UNCOMMON', acquisition: [{ source: 'QUEST' }], tags: ['dorm', 'f0', 'display'], introducedVersion: 'housing.f0' })),
  item('furniture.study_books_set', 'Study Books Set', '책 다섯 권과 노트를 하나의 배치로 묶은 공부 소품 세트.',
    furniture('DECOR', { rarity: 'COMMON', acquisition: [{ source: 'SHOP' }], tags: ['dorm', 'f0', 'study', 'decor_set'], introducedVersion: 'housing.f0' })),


  // ---- HOUSING-FINISH-01 · identity only; shop listings stay LOCKED until finish slots launch ----
  item('finish.wall_basic', '기본 아이보리 벽지', '개인방의 기본 아이보리 벽 마감재.',
    finish('wall', { rarity: 'COMMON', acquisition: [{ source: 'DEFAULT' }], tags: ['starter'],
      introducedVersion: 'housing.finish.p0' })),
  item('finish.wall_white_plaster_02', '따뜻한 아이보리 석고 벽지', 'White Plaster 02의 따뜻한 아이보리 D안.',
    finish('wall', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['plaster', 'poly_haven'],
      introducedVersion: 'housing.finish.p0' })),
  item('finish.floor_basic', '기본 단색 바닥재', '개인방의 기존 단색 바닥 마감재.',
    finish('floor', { rarity: 'COMMON', acquisition: [{ source: 'DEFAULT' }], tags: ['starter'],
      introducedVersion: 'housing.finish.p0' })),
  item('finish.floor_wood_051', '내추럴 우드 바닥재', 'Wood Floor 051 목재 바닥 마감재.',
    finish('floor', { rarity: 'UNCOMMON', acquisition: [{ source: 'SHOP' }], tags: ['wood', 'ambientcg'],
      introducedVersion: 'housing.finish.p0' })),

  // ---- Life M1 · first persistent stackable materials ----
  item('material.campus_leaf', '캠퍼스 낙엽', '캠퍼스 생활 채집에서 얻는 기본 자연 재료.',
    material({ rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.material.campus_leaf.v1', acquisition: [{ source: 'ACTIVITY', ref: 'activity.gathering.campus' }],
      tags: ['life', 'gathering', 'material'], introducedVersion: 'life.m1' })),
  item('material.fish_carp', '붕어', '인경호 낚시 활동에서 얻는 기본 어류 재료.',
    material({ rarity: 'COMMON', status: 'ACTIVE', iconAssetId: 'icon.material.fish_carp.v1', acquisition: [{ source: 'ACTIVITY', ref: 'activity.fishing.inkyung' }],
      tags: ['life', 'fishing', 'material'], introducedVersion: 'life.m1' })),
  item('material.artifact_fragment_01', '캠퍼스 유물 조각', '캠퍼스 역사 조사와 발굴에서 얻는 첫 유물 조각.',
    material({ rarity: 'UNCOMMON', status: 'ACTIVE', iconAssetId: 'icon.material.artifact_fragment_01.v1', acquisition: [{ source: 'ACTIVITY', ref: 'activity.archaeology.campus_history' }],
      tags: ['life', 'archaeology', 'material'], introducedVersion: 'life.m1' }))
]);

export const PILOT_ITEM_IDS = Object.freeze(['head.inha_cap', 'head.inkyung_duck', 'top.inha_basic', 'back.freshman_bag', 'badge.main_gate', 'emote.wave_plus']);
// C1 §2.3 DEFAULT grant set (ensureDefaultItems). The Human Avatar starter set is a separate, reserved contract.
export const DEFAULT_ITEM_IDS = Object.freeze(['head.inha_cap', 'top.inha_basic', 'back.freshman_bag']);
export const VS_ECONOMY_ITEM_IDS = Object.freeze([
  'top.induck_hoodie', 'head.induck_cap', 'furniture.induck_cushion', 'furniture.campus_map_poster',
  'badge.campus_first_step', 'badge.mcm_2026_landlord', 'top.mcm_2026_survivor', 'furniture.mcm_2026_poster'
]);
export const F0_FURNITURE_IDS = Object.freeze([
  'furniture.campus_map_poster', 'furniture.induck_cushion', 'furniture.dorm_desk_lamp',
  'furniture.induck_chair', 'furniture.mini_induck', 'furniture.campus_rug_blue',
  'furniture.dorm_resident_plate', 'furniture.mcm_2026_landlord_figure', 'furniture.mcm_2026_poster',
  'furniture.dorm_single_sofa', 'furniture.dorm_side_table_low', 'furniture.dorm_bookshelf_slim',
  'furniture.dorm_plant_medium', 'furniture.dorm_monitor', 'furniture.dorm_trophy_shelf',
  'furniture.study_books_set'
]);
export const ROOM_FINISH_IDS = Object.freeze([
  'finish.wall_basic', 'finish.wall_white_plaster_02',
  'finish.floor_basic', 'finish.floor_wood_051'
]);
export const LIFE_M1_MATERIAL_IDS = Object.freeze([
  'material.campus_leaf', 'material.fish_carp', 'material.artifact_fragment_01'
]);

const BY_ID = new Map(ITEM_CATALOG.map(definition => [definition.itemId, definition]));

export function getItemDefinition(itemId) {
  return BY_ID.get(itemId) ?? null;
}

/** Fields the DB mirror (private.world_item_catalog) must hold for every item. */
export function catalogAuthorityRow(definition) {
  return {
    item_id: definition.itemId, category: definition.category, ownership_policy: definition.ownershipPolicy,
    max_stack: definition.maxStack, status: definition.status
  };
}

/** Every C0 rule violation in `items`, as readable strings; an empty array means valid. */
export function validateCatalog(items) {
  const errors = [];
  const seen = new Set();
  for (const d of items) {
    const id = d?.itemId;
    const at = typeof id === 'string' ? id : '<missing itemId>';
    if (typeof id !== 'string' || !ITEM_ID_PATTERN.test(id)) errors.push(`${at}: itemId must be lowercase <category>.<name>`);
    if (seen.has(id)) errors.push(`${at}: duplicate itemId`);
    seen.add(id);
    if (!ITEM_CATEGORIES.includes(d.category)) errors.push(`${at}: unknown category ${d.category}`);
    const prefix = typeof id === 'string' ? id.split('.')[0] : '';
    if (PREFIX_CATEGORY[prefix] !== d.category) errors.push(`${at}: prefix ${prefix} does not match category ${d.category}`);
    if (d.category === 'WEARABLE') {
      if (!APPEARANCE_SLOTS.includes(d.equipSlot)) errors.push(`${at}: WEARABLE needs an appearance equipSlot`);
      else if (d.equipSlot.toLowerCase() !== prefix) errors.push(`${at}: equipSlot ${d.equipSlot} does not match prefix ${prefix}`);
    } else if (d.category === 'BADGE') {
      if (d.equipSlot !== 'BADGE') errors.push(`${at}: BADGE uses the BADGE profile slot`);
    } else if (d.equipSlot !== null) {
      errors.push(`${at}: ${d.category} has no equipSlot`);
    }
    if (d.category === 'FURNITURE' ? !FURNITURE_SUBTYPES.includes(d.subtype) : d.subtype !== null) {
      errors.push(`${at}: subtype ${d.subtype} is not valid for ${d.category}`);
    }
    if (d.category === 'ROOM_FINISH') {
      const slots = Array.isArray(d.tags) ? d.tags.filter(tag => ROOM_FINISH_SLOTS.includes(tag)) : [];
      if (slots.length !== 1 || !d.tags.includes('room_finish')) errors.push(`${at}: ROOM_FINISH needs one wall/floor finish tag`);
      if (d.ownershipPolicy !== 'UNIQUE') errors.push(`${at}: ROOM_FINISH must use UNIQUE ownership`);
    }
    if (!RARITIES.includes(d.rarity)) errors.push(`${at}: unknown rarity ${d.rarity}`);
    if (!ITEM_STATUSES.includes(d.status)) errors.push(`${at}: unknown status ${d.status}`);
    if (d.category === 'MATERIAL') {
      if (d.cosmeticOnly !== false) errors.push(`${at}: MATERIAL must set cosmeticOnly = false`);
      if (d.ownershipPolicy !== 'STACKABLE') errors.push(`${at}: MATERIAL must use STACKABLE ownership`);
    } else if (d.cosmeticOnly !== true) {
      errors.push(`${at}: non-MATERIAL items must remain cosmeticOnly (Cosmetic ≠ Power)`);
    }
    if (!OWNERSHIP_POLICIES.includes(d.ownershipPolicy)) errors.push(`${at}: unknown ownershipPolicy ${d.ownershipPolicy}`);
    if (!TRADE_POLICIES.includes(d.tradePolicy)) errors.push(`${at}: unknown tradePolicy ${d.tradePolicy}`);
    if (d.ownershipPolicy === 'UNIQUE' && (d.stackable !== false || d.maxStack !== null)) {
      errors.push(`${at}: UNIQUE items are not stackable and have no maxStack`);
    }
    if (d.ownershipPolicy === 'STACKABLE' && (d.stackable !== true || !Number.isInteger(d.maxStack) || d.maxStack < 2)) {
      errors.push(`${at}: STACKABLE items need stackable = true and an integer maxStack >= 2`);
    }
    if ('price' in d || 'cost' in d) errors.push(`${at}: prices belong to Shop Listings, not the catalog`);
    if (typeof d.displayName !== 'string' || !d.displayName.trim()) errors.push(`${at}: displayName required`);
    if (typeof d.description !== 'string' || !d.description.trim()) errors.push(`${at}: description required`);
    if (!Array.isArray(d.tags)) errors.push(`${at}: tags must be an array`);
    if (!Array.isArray(d.acquisition) || d.acquisition.length === 0 ||
        d.acquisition.some(a => !ACQUISITION_SOURCES.includes(a?.source))) {
      errors.push(`${at}: acquisition hints need known sources`);
    }
    if (d.eventId !== null && !ITEM_ID_PATTERN.test(d.eventId ?? '')) errors.push(`${at}: eventId must be <category>.<name>`);
  }
  return errors;
}

/**
 * Inventory-safe view of one owned row: the catalog definition when known, otherwise an
 * UNKNOWN_ITEM placeholder. Ownership is never dropped because the catalog cannot describe it.
 */
export function describeOwnedItem(owned) {
  const definition = getItemDefinition(owned.itemId);
  if (!definition) {
    return { ...owned, known: false, displayName: '알 수 없는 아이템', category: null, rarity: null, catalogStatus: 'UNKNOWN_ITEM' };
  }
  return { ...owned, known: true, displayName: definition.displayName, category: definition.category,
    rarity: definition.rarity, catalogStatus: definition.status };
}
