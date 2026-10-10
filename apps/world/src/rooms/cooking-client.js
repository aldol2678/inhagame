import { FURNITURE_UUID } from "./furniture-layout.js";

// Candidate only. Activation needs a separately reviewed server recipe + acquisition + UI rollout.
export const COOKING_AVAILABLE = false;
export const CARP_RECIPE = Object.freeze({ recipeId: "recipe.carp_grill", inputItemId: "material.fish_carp",
  outputItemId: "consumable.grilled_carp", inputQuantity: 1, outputQuantity: 1, foodUseAvailable: false });
export const COOKING_ERRORS = Object.freeze({
  RECIPE_UNAVAILABLE: "요리 기능은 아직 준비 중이에요.",
  COOKING_STATION_REQUIRED: "내 방에 보유한 조리대를 배치하고 저장해 주세요.",
  INSUFFICIENT_QUANTITY: "붕어가 부족해요.", MAX_STACK_EXCEEDED: "붕어구이 보관 한도는 20개예요.",
  ACCOUNT_UNAVAILABLE: "계정을 확인하지 못했어요.", PERMANENT_ACCOUNT_REQUIRED: "정식 계정으로 로그인해 주세요.",
  IDEMPOTENCY_CONFLICT: "요청을 확인하지 못했어요. 새로고침 후 다시 확인해 주세요.",
  UNAVAILABLE: "결과를 확인하지 못했어요. 다시 확인하면 같은 요청으로 안전하게 조회해요."
});

export function canUseCookingStation(state, accountId) {
  return !!state && FURNITURE_UUID.test(accountId ?? "") && FURNITURE_UUID.test(state.roomId ?? "") &&
    state.accountId === accountId && state.ownerUserId === accountId && state.role === "owner" &&
    state.space === "ROOM_PERSONAL_BASIC" && state.ready === true && !state.editing && !state.busy &&
    Array.isArray(state.objects) && state.objects.some(o => o.itemId === "furniture.cooking_station" && o.surface === "floor");
}

export function parseCookingReceipt(raw, { accountId, roomId, requestId, recipeId }) {
  if (!raw || raw.status !== "SUCCESS" || raw.userId !== accountId || raw.roomId !== roomId ||
      raw.requestId !== requestId || raw.recipeId !== recipeId || !Number.isSafeInteger(raw.definitionVersion) ||
      raw.definitionVersion < 1 || !Number.isSafeInteger(raw.layoutRevision) || raw.layoutRevision < 0) return null;
  const inventory = raw.inventory;
  if (!inventory || !["SUCCESS", "ALREADY_PROCESSED"].includes(inventory.status) ||
      inventory.userId !== accountId || inventory.mutationType !== "COOK" || inventory.sourceType !== "CRAFTING" ||
      inventory.sourceRef !== recipeId || !FURNITURE_UUID.test(inventory.mutationId ?? "") ||
      inventory.idempotencyKey !== `recipe:${accountId}:${requestId}` || !Array.isArray(inventory.entries) || inventory.entries.length !== 2) return null;
  const expected = [["CONSUME", CARP_RECIPE.inputItemId, -1], ["GRANT", CARP_RECIPE.outputItemId, 1]];
  if (inventory.entries.some((entry, index) => !entry || entry.direction !== expected[index][0] || entry.itemId !== expected[index][1] ||
      entry.quantity !== 1 || !Number.isSafeInteger(entry.quantityBefore) || !Number.isSafeInteger(entry.quantityAfter) ||
      entry.quantityBefore < 0 || entry.quantityAfter < 0 || entry.quantityAfter !== entry.quantityBefore + expected[index][2])) return null;
  // Receipts describe this historical exchange. Never overwrite current Inventory with their totals.
  return structuredClone(raw);
}

export function createCookingClient({ getClient, getUserId, getRoomState, isAvailable = () => COOKING_AVAILABLE,
  requestId = () => globalThis.crypto.randomUUID(), onChange = () => {}, onReceipt = () => false }) {
  let inventoryStatus = "IDLE", inventoryReading = false;
  let generation = 0, boundAccount = null, boundRoom = null, pending = false, error = null, receipt = null, retryId = null;
  const state = () => ({ accountId: boundAccount, roomId: boundRoom, pending, error, inventoryStatus, inventoryReading, receipt: receipt ? structuredClone(receipt) : null, retryId });
  const emit = () => onChange(state());
  const eligible = () => isAvailable() === true && canUseCookingStation(getRoomState(), getUserId());
  function reset() {
    generation++; boundAccount = null; boundRoom = null; pending = false; error = null; receipt = null; retryId = null; inventoryStatus = "IDLE"; inventoryReading = false; emit();
  }
  function sync() {
    const account = getUserId(), room = getRoomState()?.roomId;
    if (account !== boundAccount || room !== boundRoom) {
      generation++; boundAccount = account; boundRoom = room; pending = false; error = null; receipt = null; retryId = null; inventoryStatus = "IDLE"; inventoryReading = false; emit();
    }
  }
  async function readReceiptInventory() {
    if (!receipt || inventoryReading) return false;
    const gen = generation, account = boundAccount, room = boundRoom, operation = receipt.requestId;
    const current = () => gen === generation && account === getUserId() && room === getRoomState()?.roomId &&
      receipt?.requestId === operation;
    inventoryReading = true; inventoryStatus = "CHECKING"; emit();
    let confirmed = false;
    try {
      // Canonical Inventory.refresh returns true only for an accepted, current-account READY read.
      confirmed = await onReceipt(structuredClone(receipt)) === true;
      return current() && confirmed;
    } catch { return false; }
    finally {
      if (current()) { inventoryReading = false; inventoryStatus = confirmed ? "READY" : "UNAVAILABLE"; emit(); }
      else sync();
    }
  }
  return { state, reset, sync, available: eligible,
    async retryInventory() {
      sync();
      if (pending || !receipt || inventoryReading) return false;
      // Read-only retry: no recipe RPC and no request-id allocation.
      return readReceiptInventory();
    },
    async cook(recipeId = CARP_RECIPE.recipeId) {
      sync();
      if (!eligible() || pending || inventoryReading || (receipt && inventoryStatus !== "READY") || recipeId !== CARP_RECIPE.recipeId) return false;
      const gen = generation, accountId = boundAccount, roomId = boundRoom;
      const current = () => gen === generation && accountId === getUserId() && roomId === getRoomState()?.roomId &&
        getRoomState()?.accountId === accountId && getRoomState()?.role === "owner";
      retryId ??= requestId();
      if (!FURNITURE_UUID.test(retryId ?? "")) { error = "UNAVAILABLE"; emit(); return false; }
      const id = retryId;
      pending = true; error = null; receipt = null; inventoryStatus = "IDLE"; emit();
      try {
        const client = getClient(); if (!client?.rpc) throw Error("UNAVAILABLE");
        const result = await client.rpc("cook_my_world_recipe_v1", { p_recipe_id: recipeId, p_request_id: id });
        if (result.error) throw result.error;
        const parsed = parseCookingReceipt(result.data, { accountId, roomId, requestId: id, recipeId });
        if (!parsed) throw Error("UNAVAILABLE");
        if (!current()) return false;
        receipt = parsed; retryId = null;
        // Preserve SUCCESS independently from current inventory readback. No new recipe request
        // is allowed until that read succeeds; retryInventory only re-reads the canonical inventory.
        await readReceiptInventory();
        return current();
      } catch (cause) {
        if (current()) error = Object.hasOwn(COOKING_ERRORS, cause?.message) ? cause.message : "UNAVAILABLE";
        return false;
      } finally {
        if (current()) { pending = false; emit(); }
        else {
          sync();
          // Same actor/room but access changed while pending. Keep this operation identity so
          // regaining access retries the committed/unknown result instead of starting a new cook.
          if (generation === gen) {
            generation++; pending = false; inventoryReading = false;
            if (receipt) { retryId = null; error = null; if (inventoryStatus === "CHECKING") inventoryStatus = "UNAVAILABLE"; }
            else { retryId = id; error = "UNAVAILABLE"; }
            emit();
          }
        }
      }
    }
  };
}
