// Authored fictional, room-local shopkeeper. Never joins the shared campus roster/schedule.
export const DORM_SHOP_VENDOR = Object.freeze({
  npcId: 'DORM-SHOP-NPC-001', name: '윤가온', role: '생활관 가구점 점원',
  shopId: 'shop.dorm_furniture', space: 'ROOM_DORM1_LOBBY',
  // Stand left of the monitor so the customer can see the face and upper body.
  position: Object.freeze({ x: -0.75, y: 0, z: 2.7 }), heading: 180,
  bodyRadius: 0.23,
  greeting: '안녕하세요, 생활관 가구점의 윤가온이에요. 내 방에 놓을 가구를 둘러보세요. 구매한 가구는 보유 확인 후 내 방에서 배치할 수 있어요.',
  appearance: Object.freeze({ height: 1, presentation: 'female', skin_tone: 0,
    hair_color: '#3d3029', hair_style: 'bob', outfit_color: '#547f76',
    accent_color: '#e5ca9e', outfit_style: 'cardigan', accessory: 'apron' })
});
