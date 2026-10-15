// Shop metadata is presentation only. Ownership comes from a fresh Inventory read, and editing
// requires the current room's server-owned layout. This helper never buys or places an item.
import { furnitureVisualForItem } from '../rooms/furniture-visual-assets.js';
import { FURNITURE_BY_ID, SURFACE_NAMES } from "../rooms/furniture-layout.js";

const WALLS = new Set(["north", "east", "south", "west"]);
// Presentation only: this does not create an offer, choose a price or unlock an item.
const STARTER_USE = Object.freeze({
  "furniture.study_books_set": "꾸미기에서 책상 위에 놓고 저장해요. 책 다섯 권과 노트가 한 세트로 배치돼요.",
  "furniture.dorm_single_sofa": "꾸미기에서 바닥에 놓고 저장해요. 꾸미기를 닫고 소파 앞에서 ‘앉기’를 누르면 쉴 수 있어요."
});

export function furnitureOfferDetails(itemId) {
  const item = FURNITURE_BY_ID.get(itemId);
  if (!item) return null;
  const surfaces = [...new Set(item.surfaces.map(surface => WALLS.has(surface) ? "벽" : SURFACE_NAMES[surface]))];
  const visual=furnitureVisualForItem(itemId);
  const character=visual?.geometryPolicy==='character-r1';
  const visualSize=character?visual.max.map((value,i)=>Number((value-visual.min[i]).toFixed(3))):null;
  return {
    sizeText: character ? `새 외형 (월드 단위): 가로 ${visualSize[0]} × 높이 ${visualSize[1]} × 깊이 ${visualSize[2]}. 주변과 겹치면 기존 외형을 유지해요.` : `크기 (월드 단위): 가로 ${item.width} × 높이 ${item.height} × 깊이 ${item.depth}`,
    surfaceText: `놓을 곳: ${surfaces.join(" · ")}`,
    useText: STARTER_USE[itemId] ?? null
  };
}

export function ownsShopFurniture(inventory, accountId, itemId) {
  return Boolean(accountId && inventory?.accountId === accountId && inventory.state === "READY"
    && FURNITURE_BY_ID.has(itemId)
    && inventory.snapshot?.items.some(item => item.itemId === itemId && Number.isSafeInteger(item.quantity) && item.quantity > 0));
}

export function createShopFurnitureHandoff({ inventory, getAccountId, getContext, openEditor,
  guideToDorm, onStatus = () => {} }) {
  function action(itemId) {
    if (!ownsShopFurniture(inventory, getAccountId(), itemId)) return null;
    const context = getContext();
    if (!context?.available || context.busy) return null;
    if (context.space === "ROOM_PERSONAL_BASIC") {
      const { metadata, furniture, session } = context;
      const account = getAccountId();
      if (metadata?.visitRole !== "owner" || metadata.ownerUserId !== account
        || !metadata.personalRoomId || furniture?.roomId !== metadata.personalRoomId.toLowerCase()
        || furniture.role !== "owner" || !furniture.ready || furniture.reading || furniture.pending || furniture.error
        || !session?.active || session.role !== "owner" || session.ownerUserId !== account
        || session.roomId !== furniture.roomId) return null;
      return { label: "내 방 꾸미기", mode: "edit", text: `보유 확인 완료 · ${STARTER_USE[itemId] ?? "꾸미기에서 가구를 선택해 배치해요."}` };
    }
    if (context.space === "campus") return {
      label: "내 방 가는 길", mode: "guide", text: "제1생활관 → 내 방 → 꾸미기에서 배치해요."
    };
    if (context.space === "ROOM_DORM1_LOBBY") return {
      label: "내 방 위치 안내", mode: "lobby", text: "로비의 내 방 문으로 들어간 뒤 ‘꾸미기’를 눌러요."
    };
    return null;
  }

  function open(itemId) {
    // Recheck at activation: the displayed action may outlive a room/account/ownership change.
    const next = action(itemId);
    if (!next) return false;
    if (next.mode === "edit") return openEditor() === true;
    if (next.mode === "guide" && guideToDorm() !== true) return false;
    onStatus(next.text);
    return true;
  }
  return { action, open };
}
