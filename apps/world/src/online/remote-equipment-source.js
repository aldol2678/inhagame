// INHA WORLD · in-memory equipment source for one remote avatar (Multiplayer Equipment Projection P0).
// Presents the surface the existing Equipment Projection reads from the local loadout client
// (state / snapshot / accountId / onChange), fed by the remote player's sanitized Presence equipment.
// The projection therefore applies the same rules to remote players as to the local one: catalog
// lookup, projectable statuses, modelAssetId → registry, stale-load tokens, replace / remove.
//
// accountId is scoped to the remote *session* ("remote:<sessionId>"): a reload, second tab or
// superseded session is a different avatar with its own source, so a late model load of an old
// session can never attach to a new one. Visual only: nothing here is ever game authority.

import { EQUIPMENT_WIRE_SLOTS, equipmentKey, sanitizeEquipment } from "../network/protocol.js";

export function createRemoteEquipmentSource({ sessionId }) {
  const accountId = `remote:${sessionId}`;
  const listeners = new Set();
  let key = null;
  let snapshot = null;

  const toSnapshot = (equipment) => Object.freeze({
    slots: Object.freeze(Object.fromEntries(EQUIPMENT_WIRE_SLOTS.map((slot) => [slot, equipment[slot] ?? null])))
  });

  function publish() {
    const change = { state: "READY", snapshot, accountId, reason: "presence", pending: new Set() };
    for (const listener of listeners) {
      try { listener(change); } catch { /* one broken listener never blocks the others */ }
    }
  }

  return {
    get state() { return snapshot ? "READY" : "SIGNED_OUT"; },
    get snapshot() { return snapshot; },
    accountId,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Applies a Presence equipment value; returns true only when it changed what is shown. */
    set(equipment) {
      const clean = sanitizeEquipment(equipment);
      const next = equipmentKey(clean);
      if (next === key) return false;
      key = next;
      snapshot = toSnapshot(clean);
      publish();
      return true;
    },
    get key() { return key; },
    dispose() { listeners.clear(); }
  };
}
