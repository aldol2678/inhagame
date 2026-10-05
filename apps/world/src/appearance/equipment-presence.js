// INHA WORLD · public equipment snapshot for Realtime Presence (Multiplayer Equipment Projection P0).
// Converts the loadout client's READY snapshot (the server read of get_my_world_appearance_loadout_v1)
// into the sparse, visual-only Presence `equipment` value: slot → { itemId, catalogStatus }.
// equippedAt, empty slots and every unknown field are dropped; modelAssetId, URLs, ownership, wallet
// and account data never enter it. Pure: no Supabase, no PlayCanvas, no DOM, no storage.
//
// Trust: the value is client-declared and visual only. Receivers render it; nothing may use it for
// rewards, achievements, quests, ranking, trade, purchase, access control, stats or ownership proof.

import { sanitizeEquipment } from "../network/protocol.js";

const EMPTY = Object.freeze({});

/**
 * @param {{ slots?: Record<string, { itemId: string, catalogStatus: string } | null> } | null} loadoutSnapshot
 * @returns {Readonly<Record<string, Readonly<{ itemId: string, catalogStatus: string }>>>}
 */
export function toPublicEquipmentSnapshot(loadoutSnapshot) {
  const slots = loadoutSnapshot?.slots;
  if (!slots || typeof slots !== "object") return EMPTY;
  const picked = {};
  for (const [slot, entry] of Object.entries(slots)) {
    if (entry) picked[slot] = { itemId: entry.itemId, catalogStatus: entry.catalogStatus };
  }
  // The wire sanitizer is the single source of the contract (known slots, id and status rules).
  return sanitizeEquipment(picked);
}

/**
 * What the local player should publish for a loadout client change: its READY snapshot for the account
 * the online session belongs to, otherwise nothing (loading, unavailable, signed out, or a different
 * account than the session).
 */
export function publicEquipmentFor({ state, snapshot, accountId } = {}, sessionUserId) {
  if (state !== "READY" || !sessionUserId || accountId !== sessionUserId) return EMPTY;
  return toPublicEquipmentSnapshot(snapshot);
}
