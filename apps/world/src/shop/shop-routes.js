// Routing/presentation only. Product identity, prices and availability remain server-owned.
// Fishing/photo have no approved listings yet and must never create a purchase client.
export const SHOP_ROUTES = Object.freeze([
  Object.freeze({ id: 'student_souvenirs', region: 'student_center', regionLabel: '학생회관', label: '기념품', shopId: 'shop.student_center', status: 'READY' }),
  Object.freeze({ id: 'student_fashion', region: 'student_center', regionLabel: '학생회관', label: '패션', shopId: 'shop.student_center_fashion', status: 'READY' }),
  Object.freeze({ id: 'dorm_furniture', region: 'dorm', regionLabel: '생활관', label: '가구', shopId: 'shop.dorm_furniture', status: 'READY' }),
  Object.freeze({ id: 'inkyung_fishing', region: 'inkyung', regionLabel: '인경호', label: '낚시용품 · 준비 중', shopId: null, status: 'PLANNED' }),
  Object.freeze({ id: 'library_photo', region: 'library', regionLabel: '정석권역', label: '사진용품 · 준비 중', shopId: null, status: 'PLANNED' }),
  Object.freeze({ id: 'department_mcm', region: 'department_mcm', regionLabel: '문콘경 학과 거점', label: '학과 굿즈', shopId: 'shop.department_mcm', status: 'READY' })
]);
export const SHOP_ROUTE_IDS = Object.freeze(SHOP_ROUTES.filter(route => route.shopId).map(route => route.shopId));

// Explicit caller-supplied NPC→vendor→shop bindings only. A generic shop_worker role
// never grants trade access. No NPC IDs, names or coordinates are invented here.
export function routesForNpc(npcId, bindings = []) {
  if (typeof npcId !== 'string' || !npcId) return [];
  return SHOP_ROUTES.filter(route => route.status === 'READY' && bindings.some(binding =>
    binding.npcId === npcId && typeof binding.vendorId === 'string' && binding.vendorId.length > 0 &&
    binding.shopId === route.shopId));
}
export function relatedShopRoutes(shopId) {
  const current = SHOP_ROUTES.find(route => route.shopId === shopId);
  // Only Student Center has approved internal departments. Never turn this into
  // remote instant purchase across all five regions (phone Delivery is separate).
  return current?.region === 'student_center'
    ? SHOP_ROUTES.filter(route => route.region === current.region && route.status === 'READY') : [];
}
