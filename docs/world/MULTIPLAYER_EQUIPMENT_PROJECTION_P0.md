# INHA WORLD · Multiplayer Equipment Projection P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Equipment Loadout Authority | **IMPLEMENTED** (`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`) |
| Wardrobe UI | **IMPLEMENTED** (`docs/world/WARDROBE_UI_P0.md`) |
| Local Equipment Projection | **IMPLEMENTED** (`docs/world/LOCAL_EQUIPMENT_PROJECTION_P0.md`) |
| Equipment Asset Binding P0 | **IMPLEMENTED** (`docs/world/EQUIPMENT_ASSET_BINDING_P0.md`) |
| Multiplayer Equipment Projection P0 | **IMPLEMENTED** (this document) |
| Additional Equipment Assets | FOLLOW-UP |
| Skin System | SEPARATE FOLLOW-UP |

Other players in the same Place Zone now see the equipment you wear (today: 인덕 캠퍼스 캡 on HEAD,
인덕 백팩 on BACK). Equip, replace and unequip in the Wardrobe reach them without a reload. This is
**equipment**, not a skin: the base character never changes. Axes: Base Character / Skin → Equipment
Loadout → Local Equipment Projection → Multiplayer Equipment Projection.

No migration, no new RPC, no new table, no new Realtime channel or Broadcast event, no protocol bump.
`supabase/**` is unchanged.

## Wire: an optional Presence field (protocol v1)

```
presence = { v: 1, sessionId, userId, displayName, placeZoneId, joinedAt,
             equipment: { HEAD: { itemId: "head.induck_cap",      catalogStatus: "COMING_SOON" },
                          BACK: { itemId: "back.induck_backpack", catalogStatus: "COMING_SOON" } } }
```

- Sparse: only equipped slots; an empty loadout sends **no** `equipment` field.
- Slots: BODY FACE HAIR HEAD TOP BOTTOM SHOES BACK ACCESSORY (`EQUIPMENT_WIRE_SLOTS`). No BADGE.
- Statuses accepted on the wire: ACTIVE, COMING_SOON, LOCKED, DISABLED, HIDDEN, UNKNOWN_ITEM. The
  projection decides what renders (the local rules: ACTIVE / COMING_SOON / LOCKED render).
- Never on the wire: `equippedAt`, `modelAssetId`, model URLs, item names, rarity, quantities,
  ownership / source data, wallet, EXP / level, account metadata, email, JWT, tokens.
- Not in the pose packet and not a Broadcast: movement traffic (3–4 Hz) is unchanged.

### Why Presence

Presence already gives zone join, late-join sync, reconnect reconciliation, session replacement and
`publishPresence()`. A late joiner receives everyone's current equipment in the Presence sync with
no extra request; an equipment change is one Presence update.

### Backward compatibility

- Old clients rebuild presence from their allowlist (`PRESENCE_FIELDS` + `guest`) and ignore
  `equipment`; players and poses keep working.
- New clients treat a presence without `equipment` (old senders) as "nothing equipped".
- `PROTOCOL_VERSION` stays `1`.

### Validation (`protocol.js` `sanitizeEquipment`)

- Reads only the nine known slot keys (a payload with thousands of keys costs nine lookups).
- Each entry keeps exactly `itemId` (catalog id shape, bounded) and `catalogStatus` (allowed set);
  extra keys are stripped; a bad entry is dropped **on its own**.
- A malformed `equipment` value never rejects the presence: the player still appears, with no
  equipment. Output is frozen.
- `guest: true` presences never carry equipment (sender) and have it dropped (receiver).

## Sender authority

```
Wardrobe → equip / unequip RPC → loadout client re-read (get_my_world_appearance_loadout_v1)
  → loadout.onChange → publicEquipmentFor(change, accountId)   [appearance/equipment-presence.js]
  → online.setLocalEquipment(accountId, equipment)             [world-online.js]
  → NetworkManager.setEquipment → transport.publishPresence
```

- Only a **READY** server loadout snapshot produces equipment; LOADING / UNAVAILABLE / SIGNED_OUT
  produce none. No optimistic broadcast on click, no Inventory inference, no DOM, no storage.
- `world-online` applies it only to a **member** session of the **same account** the loadout was
  read for; guests and other accounts publish nothing.
- `NetworkManager.setEquipment()` stores the sanitized value and compares a canonical key: an
  identical refresh sends **0** packets; a real change sends **1** Presence update (same `joinedAt`,
  same session — an update, not a re-join). Without a joined zone it only stores; the next join,
  zone change, rejoin or reconnect carries the latest value.

## Receiver

```
Presence → SupabaseRealtimeTransport → NetworkManager → RemotePlayerManager (player.equipment)
  → sample().equipment (frozen) → RemotePlayerView → remote avatar
  → createRemoteEquipmentSource (per session)  → createEquipmentProjection (unchanged, shared rules)
  → character.getEquipmentAnchor(slot)          → createEquipmentModelLoader (one per factory)
```

- `RemotePlayerManager` stores sanitized `equipment` on join and replaces it on a Presence update of
  the **same** player object; `sample()` hands out the frozen snapshot.
- The remote avatar keeps its entity: an equipment change only updates its in-memory source, and
  the existing Equipment Projection reconciles the changed slots (attach / replace / remove,
  catalog lookup, projectable statuses, modelAssetId → registry, stale-load tokens). No projection
  logic is copied into the online layer.
- The source's identity is the remote **session** (`remote:<sessionId>`); a reload, second tab or
  superseded session is a different avatar, so an old session's late model load cannot attach.
- Leave / disconnect / superseded / offline / zone change / room pause destroy the avatar, which
  destroys its projection first (pending loads invalidated, equipment entities destroyed).
- One model loader for all remote avatars: PlayCanvas reuses the loaded container per URL, so N
  players wearing the cap download `induck-cap-v1.glb` once; each avatar gets its own instance.
- Remote equipment follows the remote character pose (walk, run, jump, sit, emote, dragon, bike)
  through the same anchors as the local player.

### Transport fix: a re-track is not a leave

Realtime (Phoenix `syncDiff`) delivers a re-track of the same key as `join(new)` then `leave(old)`.
Until now nothing re-tracked, so the adapter reported every `leave`. `SupabaseRealtimeTransport`
now drops a `leave` whose key is still present in `presenceState()`, so an equipment update is
never mistaken for the player leaving (which would destroy and recreate the avatar). The test fake
Realtime server now uses the same join-then-leave order.

## Zones, rooms, reconnect

- Scope is the current Place Zone channel. Moving to another zone removes you (and your equipment)
  from the old zone's players; joining a zone carries your latest equipment.
- Club / personal rooms pause campus Presence as before: campus players stop seeing you and your
  equipment, nothing is sent from inside a room, and leaving the room rejoins with the latest value.
- Reconnect rejoins with the latest equipment; logout removes the member avatar (the guest session
  that follows wears nothing).

## Trust boundary

Presence equipment is **visual-only, client-declared** state. An honest client builds it from the
server loadout read, but receivers must never use it for rewards, achievements, quest completion,
ranking, trade, purchase, access control, combat / stats or ownership proof. Realtime policies do
not inspect payload fields; the existing place-zone authorization is unchanged. Server-verified
remote appearance, if ever needed, is a separate task (the same limitation already applies to
client-declared Presence identity).

## Bandwidth

- Idle: 0 equipment traffic (Browser QA: 30 s idle → 0 Presence updates).
- Movement: pose traffic only (0 Presence updates while walking).
- One equip change: exactly 1 Presence update. Identical loadout refreshes: 0.
- Payload: 152 bytes of JSON for HEAD + BACK (`{"equipment":{...}}`), sent only on join or when it changes.

## Debug / status

`online.status().equipment` → `{ localSlots, remoteAvatars, remoteSlots, republished }` (counts only;
no entities, no raw Presence, no auth data).

## Tests and QA

- `tests/multiplayer-equipment-network.test.mjs` — wire contract, sanitization, guest drop, protocol
  v1 compatibility, privacy, NetworkManager republish rules, remote model.
- `tests/multiplayer-equipment-avatar.test.mjs` — remote source + existing projection + anchors:
  attach, unequip, null-model replace, statuses, leave, stale loads across session replacement,
  load failure, shared asset download, local isolation, wiring.
- `tests/multiplayer-equipment-integration.test.mjs` — two clients over the real world-online +
  Supabase transport + fake Realtime: equip / unequip / replace without recreating the avatar, late
  join, zone transition, room pause, reconnect, logout, guest, bandwidth, privacy.
- Browser QA (two independent browsers relayed through a Realtime-like hub, WebGPU and WebGL2,
  1280×720 and 360×740): see the PR.
