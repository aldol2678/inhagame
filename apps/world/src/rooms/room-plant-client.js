import { FURNITURE_UUID } from "./furniture-layout.js";

// Candidate only. No URL/storage/debug toggle can activate the production consumer.
export const ROOM_PLANT_AVAILABLE = false;
export const ROOM_PLANT_ITEM = "furniture.indoor_planter";
export const ROOM_PLANT_ID = "plant.room_flower";
export const ROOM_PLANT_STAGES = Object.freeze(["SPROUT", "BUD", "BLOOM"]);
export const ROOM_PLANT_ERRORS = Object.freeze({
  PLANT_UNAVAILABLE: "화분 키우기는 아직 준비 중이에요.",
  PLANT_ACCESS_DENIED: "지금은 이 방의 화분을 확인할 수 없어요.",
  PLANTER_REQUIRED: "내가 보유한 재배용 화분을 내 방에 배치하고 저장해 주세요.",
  PLANT_ALREADY_PLANTED: "이미 심은 꽃이 있어요. 현재 모습을 다시 확인해 주세요.",
  PLANT_REQUIRED: "먼저 화분에 꽃을 심어 주세요.",
  PLANT_CONFLICT: "다른 곳에서 화분을 돌봤어요. 현재 상태를 다시 확인해 주세요.",
  PLANT_NOT_READY: "아직 자라는 중이에요. 다음에 천천히 돌아와도 괜찮아요.",
  ACCOUNT_UNAVAILABLE: "계정을 확인하지 못했어요.",
  IDEMPOTENCY_CONFLICT: "요청이 일치하지 않아요. 현재 상태를 다시 확인해 주세요.",
  UNAVAILABLE: "결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.",
  READBACK_REQUIRED: "처리는 완료됐어요. 현재 화분과 보유 상태만 다시 확인해 주세요."
});
const uuid = value => typeof value === "string" && FURNITURE_UUID.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const time = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const clone = value => value == null ? value : structuredClone(value);
const silhouette = value => value && uuid(value.objectId) && value.plantId === ROOM_PLANT_ID && ROOM_PLANT_STAGES.includes(value.stage);

// Strict projection: never retain unknown fields from a visitor response.
export function parseRoomPlantSnapshot(raw, context) {
  if (!raw || raw.roomId !== context.roomId || raw.role !== context.role || !integer(raw.layoutRevision)
    || !["CLOSED", "ACTIVE"].includes(raw.featureStatus)) return null;
  const base = { roomId: raw.roomId, role: raw.role, layoutRevision: raw.layoutRevision, featureStatus: raw.featureStatus };
  if (raw.role === "visitor") {
    if (!Array.isArray(raw.plants) || raw.plants.length > 1 || raw.plants.some(p => !silhouette(p))) return null;
    return { ...base, plants: raw.plants.map(p => ({ objectId: p.objectId, plantId: p.plantId, stage: p.stage })) };
  }
  if (raw.role !== "owner" || !time(raw.serverNow) || typeof raw.planterOwned !== "boolean") return null;
  let plant = null;
  if (raw.plant !== null) {
    const p = raw.plant;
    if (!p || (p.objectId !== null && !uuid(p.objectId)) || p.plantId !== ROOM_PLANT_ID || !ROOM_PLANT_STAGES.includes(p.stage)
      || ![1, 2, 3].includes(p.revision) || typeof p.canCare !== "boolean" || (p.nextStageAt !== null && !time(p.nextStageAt))) return null;
    if (!raw.planterOwned || (p.canCare && (p.objectId === null || p.nextStageAt !== null || p.stage === "BLOOM"))
      || (p.stage === "BLOOM" && (p.revision !== 3 || p.nextStageAt !== null))
      || (p.revision === 1 && p.stage !== "SPROUT") || (p.revision === 3 && p.stage === "SPROUT")
      || (p.nextStageAt !== null && Date.parse(p.nextStageAt) <= Date.parse(raw.serverNow))) return null;
    plant = { objectId: p.objectId, plantId: p.plantId, stage: p.stage, revision: p.revision, canCare: p.canCare, nextStageAt: p.nextStageAt };
  }
  if (raw.featureStatus === "CLOSED" && (raw.planterOwned || plant)) return null;
  return { ...base, serverNow: raw.serverNow, planterOwned: raw.planterOwned, plant };
}

export function createRoomPlantClient({ getClient, getUserId, getRoomState, isAvailable = () => ROOM_PLANT_AVAILABLE,
  onChange = () => {}, refreshInventory = async () => false, requestId = () => globalThis.crypto.randomUUID() }) {
  let observedInventoryOwned = null;
  let generation = 0, scope = "", accountId = null, roomId = null, snapshot = null;
  let reading = false, pending = false, error = null, operation = null, confirmed = null, inventoryConfirmed = true, needsReadback = false;
  function context() {
    if (isAvailable() !== true) return null;
    const s = getRoomState(), actor = getUserId();
    if (!s || !uuid(actor) || s.accountId !== actor || !uuid(s.roomId) || !uuid(s.ownerUserId)
      || s.space !== "ROOM_PERSONAL_BASIC" || s.ready !== true || s.sessionActive !== true || s.busy || s.editing
      || s.layoutError || s.layoutPending || !["owner", "visitor"].includes(s.role) || (s.role === "owner" && s.ownerUserId !== actor)) return null;
    return s;
  }
  const keyOf = s => s ? `${s.accountId}:${s.roomId}:${s.ownerUserId}:${s.role}:${s.sessionVersion ?? 0}` : "";
  const available = () => !!context();
  function reset() {
    observedInventoryOwned = null; generation++; scope = ""; accountId = null; roomId = null; snapshot = null; reading = false; pending = false;
    error = null; operation = null; confirmed = null; inventoryConfirmed = true; needsReadback = false; emit();
  }
  function sync() {
    const s = context(), key = keyOf(s);
    if (scope !== key) {
      observedInventoryOwned = null; generation++; scope = key; accountId = s?.accountId ?? null; roomId = s?.roomId ?? null;
      snapshot = null; reading = false; pending = false; error = null; operation = null; confirmed = null; inventoryConfirmed = true; needsReadback = false;
      emit();
    }
    if (snapshot && snapshot.layoutRevision !== s?.revision) { snapshot = null; emit(); }
  }
  const current = (gen, key) => gen === generation && key === scope && key === keyOf(context());
  function state() {
    const s = context(), valid = !!s && keyOf(s) === scope;
    return { accountId, roomId, generation, role: s?.role ?? null, pending, reading, error, needsReadback,
      inventoryConfirmed, retry: operation ? { action: operation.action, requestId: operation.requestId ?? null } : null,
      confirmed: clone(confirmed), ready: valid && !!snapshot && snapshot.layoutRevision === s.revision && !needsReadback && !error,
      snapshot: valid ? clone(snapshot) : null };
  }
  function emit() { onChange(state()); }
  async function refresh() {
    sync(); const s = context();
    if (!s || reading || pending) return false;
    const gen = generation, key = scope, actor = accountId, room = roomId;
    reading = true; error = null; emit();
    try {
      if (!inventoryConfirmed) {
        const ok = await refreshInventory(actor);
        if (!current(gen, key)) return false;
        if (ok !== true) throw Error("READBACK_REQUIRED");
        inventoryConfirmed = true;
      }
      const client = getClient(); if (!client?.rpc) throw Error("UNAVAILABLE");
      const result = await client.rpc("get_world_room_plants_v1", { p_room: room });
      if (!current(gen, key)) return false;
      if (result.error) throw result.error;
      const parsed = parseRoomPlantSnapshot(result.data, s);
      if (!parsed || parsed.layoutRevision !== context()?.revision) throw Error("UNAVAILABLE");
      snapshot = parsed; needsReadback = false;
      if (parsed.role === "owner" && parsed.planterOwned && observedInventoryOwned === false) observedInventoryOwned = null;
      return true;
    } catch (cause) {
      if (current(gen, key)) {
        snapshot = null;
        error = needsReadback ? "READBACK_REQUIRED" : Object.hasOwn(ROOM_PLANT_ERRORS, cause?.message) ? cause.message : "UNAVAILABLE";
      }
      return false;
    } finally { if (current(gen, key)) { reading = false; emit(); } else sync(); }
  }
  const target = objectId => context()?.objects?.find(o => o.id === objectId && o.itemId === ROOM_PLANT_ITEM && o.surface === "floor");
  const ownerReady = () => state().ready && context()?.role === "owner" && snapshot.featureStatus === "ACTIVE" && !pending && !reading && !operation;
  async function send(op) {
    const s = context(); if (!s || s.role !== "owner" || pending || reading) return false;
    const gen = generation, key = scope;
    pending = true; error = null; operation = op; confirmed = null; emit();
    let success = false;
    try {
      const client = getClient(); if (!client?.rpc) throw Error("UNAVAILABLE");
      const response = await client.rpc(op.name, clone(op.args));
      if (!current(gen, key)) return false;
      if (response.error) throw response.error;
      const r = response.data;
      if (!r || r.status !== "SUCCESS" || r.userId !== accountId || r.roomId !== roomId) throw Error("UNAVAILABLE");
      if (op.action === "CLAIM") {
        if (r.itemId !== ROOM_PLANT_ITEM || !r.inventory || r.inventory.userId !== accountId || r.inventory.itemId !== ROOM_PLANT_ITEM
          || !["GRANTED", "ALREADY_PROCESSED", "ALREADY_OWNED"].includes(r.inventory.status)) throw Error("UNAVAILABLE");
        inventoryConfirmed = false;
      } else if (r.requestId !== op.requestId || r.objectId !== op.args.p_object || r.action !== op.action
        || r.definitionVersion !== 1 || r.plantRevision !== op.expectedRevision + 1) throw Error("UNAVAILABLE");
      confirmed = { action: op.action }; operation = null; needsReadback = true; snapshot = null; success = true;
    } catch (cause) {
      if (current(gen, key)) {
        const code = cause?.message;
        error = Object.hasOwn(ROOM_PLANT_ERRORS, code) ? code : "UNAVAILABLE";
        // Deterministic refusals wrote nothing; an unknown/network outcome keeps the frozen request.
        if (error !== "UNAVAILABLE") { operation = null; snapshot = null; }
      }
    } finally { if (current(gen, key)) { pending = false; emit(); } else sync(); }
    if (success && current(gen, key)) await refresh();
    return success && current(gen, key);
  }
  return { state, reset, sync, available, refresh,
    visuals() {
      const s = state(); if (!s.ready || s.snapshot.featureStatus !== "ACTIVE") return [];
      const rows = s.role === "visitor" ? s.snapshot.plants : s.snapshot.plant?.objectId ? [s.snapshot.plant] : [];
      return rows.filter(p => target(p.objectId)).map(p => ({ objectId: p.objectId, plantId: p.plantId, stage: p.stage }));
    },
    async claim() {
      sync(); if (!ownerReady() || snapshot.planterOwned) return false;
      return send({ action: "CLAIM", name: "claim_my_room_planter_v1", args: { p_room: roomId } });
    },
    async plant(objectId) {
      sync(); if (!ownerReady() || !snapshot.planterOwned || snapshot.plant || !target(objectId)) return false;
      const id = requestId(); if (!uuid(id)) return false;
      return send({ action: "PLANT", expectedRevision: 0, requestId: id, name: "plant_my_room_plant_v1",
        args: { p_room: roomId, p_object: objectId, p_request_id: id } });
    },
    async care(objectId) {
      sync(); const p = snapshot?.plant;
      if (!ownerReady() || !snapshot.planterOwned || !p?.canCare || p.objectId !== objectId || !target(objectId)) return false;
      const id = requestId(); if (!uuid(id)) return false;
      return send({ action: "CARE", expectedRevision: p.revision, requestId: id, name: "care_my_room_plant_v1",
        args: { p_room: roomId, p_object: objectId, p_revision: p.revision, p_request_id: id } });
    },
    async retry() { sync(); return operation && !pending && !reading ? send(operation) : false; },
    inventoryChanged({ accountId: actor, state: status, snapshot: owned }) {
      sync();
      if (context()?.role !== "owner" || actor !== accountId || status !== "READY") return;
      const ownedNow = owned?.items?.some(i => i.itemId === ROOM_PLANT_ITEM && i.quantity === 1) === true;
      const changed = observedInventoryOwned !== ownedNow; observedInventoryOwned = ownedNow;
      if (!ownedNow && changed && (snapshot?.planterOwned || reading || pending)) {
        // Invalidate in-flight snapshots too: an old owned read must not resurrect a revoked plant.
        generation++; snapshot = null; reading = false; pending = false; confirmed = null;
        error = "PLANTER_REQUIRED"; emit();
      }
    }
  };
}
