// INHA WORLD · Local Equipment Projection P0.
// Projects the local player's equipped loadout onto the local character's slot anchors. The loadout
// client's snapshot is the ONLY equipped authority (it is itself a read-model of the server loadout);
// the local catalog only binds an item to a model asset (`modelAssetId`). Flow:
//   Wardrobe → equip/unequip RPC → loadout client re-read → loadout.onChange → this projection.
// This module never talks to Supabase, the Wardrobe, the Inventory or any renderer API directly.
//
// Render eligibility (all required): a non-null slot entry, a local catalog definition, category
// WEARABLE, definition.equipSlot === slot, a modelAssetId, and a server catalogStatus of ACTIVE,
// COMING_SOON or LOCKED. DISABLED / HIDDEN / UNKNOWN_ITEM keep the loadout (the server's truth) and only
// hide the 3D entity. A missing modelAssetId is the normal P0 state (the catalog ships no assets yet):
// no loader call, no warning, no fallback mesh.
//
// Lifecycle: every slot owns a token. Any change of a slot's desired asset bumps the token, so a late
// async load for an older desire (replace, unequip, account switch, logout, destroy) is discarded and
// its entity destroyed. A replacement keeps the old entity until the new one is ready (no flicker).
// Updates happen only on loadout changes; nothing runs per frame and nothing polls.

import { getItemDefinition } from "../collection/item-catalog.js";
import { EQUIPMENT_SLOTS } from "./equipment-anchors.js";

export const PROJECTABLE_CATALOG_STATUSES = Object.freeze(["ACTIVE", "COMING_SOON", "LOCKED"]);
const PROJECTABLE = new Set(PROJECTABLE_CATALOG_STATUSES);

export const SLOT_PROJECTION = Object.freeze({
  EMPTY: "EMPTY", // nothing equipped (or no READY loadout)
  NO_ASSET: "NO_ASSET", // equipped, eligible, but the catalog binds no model yet (P0 normal state)
  HIDDEN: "HIDDEN", // equipped, but not renderable (status / unknown item / wrong category or slot)
  PENDING: "PENDING", // model load in flight
  ATTACHED: "ATTACHED", // model entity attached to the slot anchor
  FAILED: "FAILED" // model load failed (no entity)
});

/**
 * Pure desired-state resolution for one slot. Returns { kind, itemId, modelAssetId }.
 * @param {string} slot
 * @param {{ itemId: string, catalogStatus: string } | null} entry
 * @param {(itemId: string) => object | null} describe
 */
export function resolveSlotProjection(slot, entry, describe = getItemDefinition) {
  if (!entry || typeof entry.itemId !== "string") return { kind: SLOT_PROJECTION.EMPTY, itemId: null, modelAssetId: null };
  const itemId = entry.itemId;
  const hidden = { kind: SLOT_PROJECTION.HIDDEN, itemId, modelAssetId: null };
  if (!PROJECTABLE.has(entry.catalogStatus)) return hidden;
  const def = describe(itemId);
  if (!def || def.category !== "WEARABLE" || def.equipSlot !== slot) return hidden;
  if (typeof def.modelAssetId !== "string" || !def.modelAssetId) return { kind: SLOT_PROJECTION.NO_ASSET, itemId, modelAssetId: null };
  return { kind: SLOT_PROJECTION.PENDING, itemId, modelAssetId: def.modelAssetId };
}

function destroyEntity(entity) {
  try {
    entity?.parent?.removeChild?.(entity);
    entity?.destroy?.();
  } catch (error) {
    console.warn("Equipment entity cleanup failed:", error);
  }
}

/**
 * @param {{
 *   loadout: { state: string, snapshot: object | null, accountId: string | null, onChange: Function },
 *   getAnchor: (slot: string) => object | null,
 *   describe?: (itemId: string) => object | null,
 *   loadModel?: ((modelAssetId: string, context: { slot: string, itemId: string }) => Promise<object | null>) | null
 * }} options
 *   loadModel resolves to an entity (any object with addChild-compatible parent semantics and destroy()).
 *   Production passes the asset loader; tests inject fake models. With no loader, bound assets are FAILED.
 */
export function createEquipmentProjection({ loadout, getAnchor, describe = getItemDefinition, loadModel = null } = {}) {
  if (!loadout?.onChange || typeof getAnchor !== "function") throw new Error("Equipment projection needs loadout and getAnchor");

  const slots = new Map(EQUIPMENT_SLOTS.map((slot) => [slot, {
    token: 0, key: "", kind: SLOT_PROJECTION.EMPTY, itemId: null, modelAssetId: null, entity: null, entityItemId: null
  }]));
  let destroyed = false;
  let loads = 0;

  function clearEntity(record) {
    if (record.entity) destroyEntity(record.entity);
    record.entity = null;
    record.entityItemId = null;
  }

  function apply(slot, desired, accountId) {
    const record = slots.get(slot);
    const key = `${accountId ?? ""}|${desired.kind}|${desired.itemId ?? ""}|${desired.modelAssetId ?? ""}`;
    if (key === record.key) return; // unchanged desire: nothing to do (no rebuild, no reload)
    record.key = key;
    const token = ++record.token;
    record.itemId = desired.itemId;
    record.modelAssetId = desired.modelAssetId;
    if (desired.kind !== SLOT_PROJECTION.PENDING) {
      clearEntity(record);
      record.kind = desired.kind;
      return;
    }
    const anchor = getAnchor(slot);
    if (!anchor || typeof loadModel !== "function") {
      clearEntity(record);
      record.kind = SLOT_PROJECTION.FAILED;
      return;
    }
    // Replace policy: the previous entity stays visible until the new model is ready.
    record.kind = SLOT_PROJECTION.PENDING;
    loads += 1;
    let request;
    try {
      request = Promise.resolve(loadModel(desired.modelAssetId, { slot, itemId: desired.itemId }));
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then((entity) => {
      if (destroyed || record.token !== token) { destroyEntity(entity); return; } // stale: discard
      if (!entity) throw new Error("EMPTY_MODEL");
      const target = getAnchor(slot);
      if (!target) { destroyEntity(entity); throw new Error("ANCHOR_UNAVAILABLE"); }
      clearEntity(record);
      target.addChild(entity);
      record.entity = entity;
      record.entityItemId = desired.itemId;
      record.kind = SLOT_PROJECTION.ATTACHED;
    }).catch((error) => {
      if (destroyed || record.token !== token) return;
      clearEntity(record);
      record.kind = SLOT_PROJECTION.FAILED;
      console.warn(`Equipment model unavailable (${slot}):`, error?.message ?? error);
    });
  }

  function sync({ state, snapshot, accountId } = loadout) {
    if (destroyed) return;
    const ready = state === "READY" && snapshot?.slots;
    for (const slot of EQUIPMENT_SLOTS) {
      const entry = ready ? snapshot.slots[slot] ?? null : null;
      apply(slot, resolveSlotProjection(slot, entry, describe), ready ? accountId : null);
    }
  }

  const unsubscribe = loadout.onChange((change) => sync(change));
  sync({ state: loadout.state, snapshot: loadout.snapshot, accountId: loadout.accountId });

  return Object.freeze({
    /** Debug surface: slot names and counts only, never entities. */
    status() {
      const bySlot = (kind) => EQUIPMENT_SLOTS.filter((slot) => slots.get(slot).kind === kind);
      return {
        destroyed,
        active: bySlot(SLOT_PROJECTION.ATTACHED),
        pending: bySlot(SLOT_PROJECTION.PENDING),
        failed: bySlot(SLOT_PROJECTION.FAILED),
        hidden: bySlot(SLOT_PROJECTION.HIDDEN),
        noAsset: bySlot(SLOT_PROJECTION.NO_ASSET),
        loads
      };
    },
    slotState: (slot) => slots.get(slot)?.kind ?? null,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      for (const record of slots.values()) {
        record.token += 1;
        clearEntity(record);
        record.kind = SLOT_PROJECTION.EMPTY;
        record.key = "";
      }
    }
  });
}
