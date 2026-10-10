// Housing B1: presentation/interaction metadata only. Ownership and placement stay server-owned.
// Seat execution uses the existing seat slot; a kind is offered here only when its handler exists.
import { selectContextAction } from "../context-action.js";

const entry = (kind, label, icon, radius, priority = 170) => Object.freeze({ kind, label, icon, radius, priority });
export const FURNITURE_FUNCTION_BY_ITEM = new Map([
  ["furniture.induck_chair", entry("seat", "앉기", "🪑", 1.15, 260)],
  ["furniture.dorm_single_sofa", entry("seat", "앉기", "🪑", 1.3, 260)],
  ["furniture.dorm_trophy_shelf", entry("display", "기념품 전시 확인", "🏅", 1.5)],
  ["furniture.cooking_station", Object.freeze({ ...entry("cook", "요리하기", "🍳", 1.8), status: "COMING_SOON", ownerOnly: true })]
]);
export const getFurnitureFunction = itemId => FURNITURE_FUNCTION_BY_ITEM.get(itemId) ?? null;

export function canUseRoomFurniture(state) {
  return state?.space === "ROOM_PERSONAL_BASIC" && Boolean(state.roomId && state.accountId)
    && state.ready === true && ["owner", "visitor"].includes(state.role)
    && !state.editing && !state.busy && !state.blocked && !state.mounted && !state.seated
    && state.grounded !== false;
}

export function createFurnitureFunctionProvider({ getState, getPosition, handlers = {}, isAvailable = () => false }) {
  function candidates() {
    const state = getState(), position = getPosition();
    if (!canUseRoomFurniture(state) || !position || ![position.x, position.z].every(Number.isFinite)) return [];
    return (state.objects ?? []).flatMap(target => {
      const feature = getFurnitureFunction(target.itemId);
      if (!feature || typeof handlers[feature.kind] !== "function" || ![target.x, target.z].every(Number.isFinite)) return [];
      if (feature.ownerOnly && (state.role !== "owner" || state.ownerUserId !== state.accountId)) return [];
      if (feature.status === "COMING_SOON" && isAvailable(feature, target, state) !== true) return [];
      const distance = Math.hypot(position.x - target.x, position.z - target.z);
      if (distance > feature.radius) return [];
      return [{ id: `room-furniture:${feature.kind}:${target.id}`, icon: feature.icon, label: feature.label,
        priority: feature.priority, distance, pressed: false, target, state, kind: feature.kind }];
    });
  }
  return {
    contextAction() {
      const candidate = selectContextAction(candidates());
      if (!candidate) return null;
      const { target, state, kind, ...action } = candidate;
      const { roomId, accountId, role, ownerUserId } = state;
      return { ...action, trigger: () => {
        // A retained mobile/F callback must never act in another room, after a move, or through a panel.
        const current = candidates().find(next => next.id === candidate.id
          && next.state.roomId === roomId && next.state.accountId === accountId
          && next.state.role === role && next.state.ownerUserId === ownerUserId);
        if (!current) return false;
        return handlers[current.kind](current.target, current.state) !== false;
      } };
    }
  };
}
