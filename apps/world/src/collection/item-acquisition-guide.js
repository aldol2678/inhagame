// Read-only acquisition guidance. Catalog hints are not availability or ownership evidence.
import { DEFAULT_ITEM_IDS, getItemDefinition } from './item-catalog.js';
import { SHOP_ROUTES } from '../shop/shop-routes.js';
import { parseShopSnapshot } from '../shop/shop-client.js';

const LEGACY_SHOPS = new Set(['shop.student_center', 'shop.dorm_furniture']);
const REASONS = Object.freeze({
  LEVEL_REQUIRED: '필요 레벨에 도달해야 해요.', ITEM_ALREADY_OWNED: '이미 보유한 상품이에요.',
  PURCHASE_LIMIT_REACHED: '구매 횟수 제한에 도달했어요.', INSUFFICIENT_FUNDS: '구매에 필요한 재화가 부족해요.',
  LISTING_LOCKED: '아직 판매가 열리지 않았어요.', LISTING_NOT_STARTED: '판매 시작 전이에요.',
  LISTING_EXPIRED: '판매 기간이 끝났어요.', LISTING_INACTIVE: '현재 판매하지 않는 상품이에요.',
  SHOP_INACTIVE: '현재 운영하지 않는 상점이에요.', ITEM_UNAVAILABLE: '현재 구매할 수 없는 아이템이에요.'
});
const result = (label, detail, availability = 'UNKNOWN', extra = {}) => Object.freeze({
  label, detail, availability, shopId: null, location: null, ...extra
});
const unknownShop = () => result('상점 · 판매 여부 확인 필요', '현재 계정의 상점 상품을 확인한 뒤 판매처와 구매 조건을 안내해요.');

function locationFor(route, knownPois) {
  // These are existing map registry IDs, not invented vendor positions. Department
  // routes intentionally have no fallback until a real registered POI is supplied.
  const ids = route.region === 'student_center' ? ['poi.student-center', 'poi.student-center-shops']
    : route.region === 'dorm' ? ['poi.dorm-1'] : [];
  const poi = (Array.isArray(knownPois) ? knownPois : []).find(p => p?.visible === true &&
    p.validPosition === true && p.discoveryState === 'DISCOVERED' &&
    ['AVAILABLE', 'NEW'].includes(p.gateState) && typeof p.poiId === 'string' &&
    (p.sourceRef?.shopId === route.shopId || ids.includes(p.poiId)));
  return poi ? Object.freeze({ poiId: poi.poiId, label: poi.title || route.regionLabel }) : null;
}

/**
 * Optional shopSnapshots are account-scoped envelopes of parsed get_world_shop_v1
 * reads: {accountId, accountEpoch, state, snapshot}. The caller increments epoch on
 * EVERY account transition (including A→B→A) and drops snapshots before refresh/error.
 * This resolver never fetches, buys, grants, chooses a guessed shop, or moves a player.
 */
export function resolveItemAcquisition(itemId, context = {}) {
  const definition = context.definition ?? getItemDefinition(itemId);
  if (!definition || definition.itemId !== itemId) return result('획득 방법 미확인', '아이템의 공개된 획득 정보를 확인할 수 없어요.');
  if (definition.status === 'HIDDEN' || context.catalogStatus === 'HIDDEN' ||
      ['UNDISCOVERED', 'UNKNOWN', 'HIDDEN'].includes(context.discoveryState)) {
    return result('획득 정보 비공개', '공개된 획득 정보가 없어요.', 'HIDDEN');
  }
  if (definition.status === 'DISABLED' || context.catalogStatus === 'DISABLED') {
    return result('현재 획득 불가', '현재 새로운 획득이 중지된 아이템이에요.', 'UNAVAILABLE');
  }
  const sources = Array.isArray(definition.acquisition) ? definition.acquisition : [];
  if (sources.some(source => source.source === 'SHOP')) {
    if (!context.accountId || !Number.isSafeInteger(context.accountEpoch) || context.accountEpoch < 0 ||
        context.capabilityChecking || !['legacy', 'split'].includes(context.capabilityMode)) return unknownShop();
    const matches = [];
    for (const envelope of Array.isArray(context.shopSnapshots) ? context.shopSnapshots : []) {
      if (envelope?.accountId !== context.accountId || envelope.accountEpoch !== context.accountEpoch ||
          envelope.state !== 'READY') continue;
      const route = SHOP_ROUTES.find(r => r.shopId && r.shopId === envelope.snapshot?.shopId && r.status === 'READY');
      if (!route || (context.capabilityMode === 'legacy' && !LEGACY_SHOPS.has(route.shopId))) continue;
      const snapshot = parseShopSnapshot(envelope.snapshot, route.shopId);
      if (!snapshot) continue;
      for (const offer of snapshot.offers) {
        if (offer.itemId !== itemId) continue;
        // An internally contradictory response is not safe purchase evidence.
        if (offer.purchasable && (snapshot.status !== 'ACTIVE' || offer.status !== 'ACTIVE' || offer.unavailableReason !== null)) continue;
        matches.push({ route, offer });
      }
    }
    // A confirmed purchasable offer wins over a second shop's refusal. No price,
    // quantity, level or catalog status is used to calculate eligibility here.
    const match = matches.find(m => m.offer.purchasable === true && m.offer.unavailableReason === null) ?? matches[0];
    if (!match) return unknownShop();
    const { route, offer } = match;
    const available = offer.purchasable === true && offer.unavailableReason === null;
    return result(`${route.regionLabel} · ${route.label}`, available
      ? '상점 조회 시 구매 가능해요. 구매할 때 조건을 다시 확인해요.'
      : (REASONS[offer.unavailableReason] ?? '상점 조회 시 구매할 수 없어요. 상점에서 최신 조건을 확인해 주세요.'),
    available ? 'AVAILABLE' : 'UNAVAILABLE', { shopId: route.shopId, location: locationFor(route, context.knownPois) });
  }
  if (DEFAULT_ITEM_IDS.includes(itemId)) return result('기본 지급', '계정의 기본 아이템 지급 대상이에요. 추가 구매 방식은 제공되지 않아요.', 'INFORMATION');
  if (itemId === 'badge.main_gate' && sources.some(s => s.source === 'QUEST' && s.ref === 'quest.first_campus')) {
    return result('첫 캠퍼스 탐방 완료 보상', '첫 캠퍼스 탐방 퀘스트를 완료하면 한 번 지급되는 배지예요.', 'INFORMATION');
  }
  if (definition.status === 'COMING_SOON' || context.catalogStatus === 'COMING_SOON' ||
      definition.status === 'LOCKED' || context.catalogStatus === 'LOCKED') {
    return result('획득 방법 준비 중', '현재 이용할 수 있는 구체적인 획득 경로는 아직 안내되지 않았어요.', 'PLANNED');
  }
  // ACTIVITY/CRAFTING/EVENT metadata and owned sourceType are not proof of a live
  // reward contract. Do not advertise closed proposals or infer discovery locations.
  return result('현재 획득처 미확인', '현재 이용 가능한 획득 경로를 확인한 뒤 안내해요.');
}
