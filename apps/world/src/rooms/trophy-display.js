// Owner-only, session-only preview. No saved/public display contract exists yet.
// Current Inventory is the ownership authority; historical Collection discovery is never consulted.
import { getItemDefinition } from "../collection/item-catalog.js";

export const TROPHY_SHELF_ITEM = "furniture.dorm_trophy_shelf";
export const TROPHY_DISPLAY_NOTICE = "내 화면에서만 보이는 임시 전시예요. 방을 나가면 사라지며 저장되거나 방문자에게 공유되지 않아요.";
export const TROPHY_VISITOR_NOTICE = "방문 권한으로 가구는 볼 수 있지만 주인의 보유 기념품은 조회하지 않아요. 공개 전시는 아직 지원하지 않아요.";

export function ownedDisplayItems(items, describe = getItemDefinition) {
  return (items ?? []).flatMap(item => {
    const definition = describe(item.itemId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1
      || !["BADGE", "MEMORABILIA"].includes(definition?.category)) return [];
    return [{ itemId: item.itemId, quantity: item.quantity, name: definition.displayName,
      category: definition.category, description: definition.description, catalogStatus: item.catalogStatus }];
  });
}

export function createTrophyDisplay({ inventory, getContext, onChange = () => {}, describe = getItemDefinition }) {
  let scope = "", generation = 0, checking = false, failed = false;
  const selected = new Map();
  function read() {
    const context = getContext();
    const active = context?.space === "ROOM_PERSONAL_BASIC" && context.ready === true && context.roomId && context.accountId;
    const nextScope = active ? `${context.roomId}:${context.accountId}:${context.ownerUserId}:${context.role}` : "";
    if (scope !== nextScope) { scope = nextScope; generation++; selected.clear(); checking = false; failed = false; }
    const owner = active && context.role === "owner" && context.ownerUserId === context.accountId
      && inventory.accountId === context.accountId;
    const visitor = active && context.role === "visitor";
    const status = !owner ? visitor ? "VISITOR" : "UNAVAILABLE"
      : checking ? "LOADING" : failed || inventory.state !== "READY" ? inventory.state === "LOADING" ? "LOADING" : "UNAVAILABLE" : "READY";
    // Do not even read the caller's snapshot while visiting. It is not the owner's inventory.
    const items = status === "READY" ? ownedDisplayItems(inventory.snapshot?.items, describe) : [];
    const shelves = active ? (context.objects ?? []).filter(item => item.itemId === TROPHY_SHELF_ITEM) : [];
    for (const [objectId, itemId] of selected) {
      if (!shelves.some(item => item.id === objectId) || (status !== "LOADING" && !items.some(item => item.itemId === itemId))) selected.delete(objectId);
    }
    return { status, accountId: active ? context.accountId : null, roomId: active ? context.roomId : null, role: visitor ? "visitor" : owner ? "owner" : null,
      editing: context?.editing === true, items, shelves, selections: [...selected].map(([objectId, itemId]) => ({ objectId, itemId })),
      displays: status !== "READY" ? [] : [...selected].map(([objectId, itemId]) => ({ objectId, ...items.find(item => item.itemId === itemId) })) };
  }
  const emit = () => { const state = read(); onChange(state); return state; };
  return {
    state: read,
    update: emit,
    reset() { scope = ""; generation++; selected.clear(); checking = false; failed = false; return emit(); },
    select(objectId, itemId) {
      const state = read();
      if (state.status !== "READY" || state.editing || !state.shelves.some(item => item.id === objectId)) return false;
      if (itemId !== null && !state.items.some(item => item.itemId === itemId)) return false;
      if (itemId === null) selected.delete(objectId); else selected.set(objectId, itemId);
      emit(); return true;
    },
    async refresh() {
      const state = read();
      if (state.role !== "owner" || checking) return false;
      const gen = generation, expectedScope = scope;
      checking = true; failed = false; emit();
      let ok = false;
      try { ok = await inventory.refresh("trophy-display"); } catch { /* Show the bounded retry state. */ }
      read();
      if (gen !== generation || scope !== expectedScope) return false;
      checking = false; failed = !ok; emit(); return ok;
    }
  };
}
