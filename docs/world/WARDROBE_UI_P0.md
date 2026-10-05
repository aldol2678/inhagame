# INHA WORLD · Wardrobe UI P0 (server-authoritative equip / unequip)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Inventory Ownership Authority (P0-B) | **IMPLEMENTED** (`docs/world/ECONOMY_P0B_INVENTORY_CATALOG.md`) |
| Inventory UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Appearance / Loadout Authority P0 | **IMPLEMENTED** (`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`) |
| Wardrobe UI P0 | **IMPLEMENTED** (this document) |
| Local Avatar Projection | FOLLOW-UP |
| Multiplayer Appearance Projection | FOLLOW-UP |
| Starter auto-equip | FOLLOW-UP |
| Profile Badge Decoration | separate scope |

☰ → `👕 옷장` opens a panel where a signed-in player sees what each appearance slot holds and equips,
replaces or takes off wearables they own. **This is the equip UI only.** Equipping changes the server
loadout; it does not change how the 3D character looks. The local avatar and other players' views stay as
before until the projection follow-ups; the panel said so ("캐릭터 외형 반영은 다음 업데이트에서 지원돼요").
Since Equipment Asset Binding P0 the note reads "3D 모델이 지원되는 장비는 캐릭터에 바로 반영돼요." because the
first two wearables now render on the local character.

No migration, no new RPC, no new Supabase client, no change to the loadout / ownership / catalog / Shop /
Wallet / Reward authorities, the avatar or the Realtime protocol.

## Three sources, three jobs

| Source | Used for | Never used for |
| --- | --- | --- |
| Loadout read `get_my_world_appearance_loadout_v1()` | what each slot holds ("장착 중", the slot list) | — |
| Inventory read `get_my_world_inventory_v1()` | which items the account owns (the candidate list) | what is worn |
| Local catalog `getItemDefinition()` | name, description, rarity, and the equip slot of a known WEARABLE | ownership, what is worn |

- An empty slot shows `장착 없음`. Owning a DEFAULT item (`head.inha_cap`, `top.inha_basic`,
  `back.freshman_bag`) never marks it as worn.
- A slot entry the catalog does not know is shown by its `itemId` with `정보 없음`, never hidden.
- An owned item the catalog does not know stays owned but is not a wardrobe candidate: it is listed
  under `장착 정보 확인 불가`. The client never derives a slot from the item id prefix.
- BADGE, FURNITURE, MEMORABILIA, EMOTE and MOUNT items are not wardrobe candidates.

## Modules

| File | Responsibility |
| --- | --- |
| `apps/world/src/appearance/loadout-client.js` | Loadout read (validates exactly the nine slots), equip / unequip, idempotency keys, per-slot in-flight guard, generation-guarded account lifecycle, coalesced reads. No DOM. |
| `apps/world/src/appearance/wardrobe-panel.js` | `slotView`, `wardrobeCandidates`, `wardrobeMessage`, `createWardrobePanel`: joins the three sources and renders. No RPC. |
| `apps/world/src/main.js` | Wiring: member client, identity, menu, modal gate, refresh triggers. |

## Panel

- Header `👕 옷장` + `보유한 착용 아이템을 슬롯별로 관리해요`.
- **현재 장착**: the nine slots in server order (`몸 · BODY`, `얼굴 · FACE`, `헤어 · HAIR`, `머리 · HEAD`,
  `상의 · TOP`, `하의 · BOTTOM`, `신발 · SHOES`, `등 · BACK`, `액세서리 · ACCESSORY`), each with the worn
  item and `해제`, or `장착 없음`.
- **보유 착용 아이템**: owned wearables in the inventory's order with name, description, slot · rarity,
  the server `catalogStatus` chip, `장착 중` when the loadout says so, and `장착` / `해제`.
- Reuses the shop / inventory modal shell and cards; buttons are 44 px; the list scrolls and keeps its
  scroll position across re-renders; hidden in the lobby shell.

## Equip / unequip

- `장착` calls `equip_my_world_item_v1(slot, itemId, key)` with the slot from the catalog definition; `해제`
  calls `unequip_my_world_item_v1(slot, key)`. The client does not pre-judge ownership, slot or status;
  the server re-checks everything.
- **State after a write: re-read.** After any server answer (success or refusal) the client re-reads the
  loadout and shows that read. The `loadout` field of the write response is not used, so the panel
  always follows the same read-model path as a fresh open.
- A refusal also re-reads the inventory (for example `ITEM_NOT_OWNED` means the shown ownership is old).
- Success: `장착 완료 · {이름}` / `해제 완료 · {이름}` in the panel and via `showWorldStatus()`.

**Idempotency.** Each intent (action + slot + item) gets a key `appearance:<uuid>`. A server answer retires
it; an unknown outcome (transport failure) keeps it so retrying the same intent replays instead of writing
twice. One write per slot is in flight at a time; a second click on that slot is ignored locally.

| Server code | Text |
| --- | --- |
| `ITEM_NOT_OWNED` | 보유한 아이템만 장착할 수 있어요 |
| `ITEM_NOT_EQUIPPABLE` | 착용할 수 없는 아이템이에요 |
| `SLOT_MISMATCH` | 이 슬롯에는 장착할 수 없어요 |
| `ITEM_UNAVAILABLE` | 현재 장착할 수 없는 아이템이에요 |
| `UNKNOWN_ITEM` | 아이템 정보를 확인할 수 없어요 |
| `PERMANENT_ACCOUNT_REQUIRED` | 로그인한 계정만 옷장을 이용할 수 있어요 |
| `ACCOUNT_UNAVAILABLE` | 현재 이 계정으로는 옷장을 이용할 수 없어요 |
| `IDEMPOTENCY_CONFLICT` | 요청이 겹쳤어요. 잠시 후 다시 시도해 주세요. |
| anything else (incl. `INVALID_APPEARANCE_SLOT`) | 변경하지 못했어요. 잠시 후 다시 시도해 주세요. |

Raw server messages are never shown.

## Catalog status

Follows the loadout authority policy. The `장착` button is disabled as a hint when the inventory row's
`catalogStatus` is `DISABLED`, `HIDDEN` or `UNKNOWN_ITEM`; `ACTIVE`, `COMING_SOON` and `LOCKED` can be
equipped. An item already worn when it became `DISABLED` / `HIDDEN` stays shown in its slot with its
status chip and can be taken off, not put on again. The equip RPC stays the final authority.

## Refresh (no polling)

| Trigger | Wiring |
| --- | --- |
| Identity / sign-in / account switch / sign-out | `online.onIdentity` → `loadout.setAccount(...)` (with inventory as before) |
| Panel opened | `loadout.refresh("open")` + `inventory.refresh("open")` |
| Equip / unequip answered | loadout re-read (and inventory re-read on a refusal) |
| Student Center purchase success | shop `onPurchase` → `inventory.refresh` + `loadout.refresh` |
| MCM reward claim finished | progression + wallet + inventory (unchanged) + `loadout.refresh` |
| bfcache restore | `pageshow` → progression + wallet + inventory + loadout |

## Accounts and stale responses

Same as the other read-models: an account change clears the loadout snapshot, in-flight guards and
unresolved keys at once (an open panel shows loading or the login message immediately); reads and writes
of an older generation are discarded; a write that lands after a switch resolves `STALE` and shows
nothing. Guests and signed-out players see `로그인한 INHAGAME 계정만 옷장을 이용할 수 있어요.` and make no
loadout or write RPC. A loadout failure leaves inventory, shop, wallet and progression working; an
inventory failure leaves the worn slots as the server loadout says.

## Modal

Same input gate as the shop and the inventory: World movement and camera input off, context slot
suspended; × / Escape / full map / room transitions close it. Shop, inventory and wardrobe are one at a
time.

## Verification

- `apps/world/tests/loadout-client.test.mjs` (12) and `apps/world/tests/wardrobe-panel.test.mjs` (15).
- `apps/world/qa.mjs`: menu entry, single panel, member client, exactly the three loadout RPCs, purchase /
  reward re-reads, world-action suspension, lobby hiding.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session and a server-side fixture
  that applies the loadout rules) at 1280×720 and 360×740: fresh nine empty slots with DEFAULT items not
  worn; wearables only, unknown item kept aside; equip HEAD, replace with a COMING_SOON item, take off;
  LOCKED equip; DISABLED / HIDDEN not offered; `ITEM_NOT_OWNED` refusal text and inventory re-read;
  local avatar node tree and model state identical before and after writes; scroll, 0 overflow, 44 px
  targets, every visible button hit-tested; Escape restores input; inventory ↔ wardrobe ↔ shop ↔ full map
  one at a time; shop purchase and a real MCM minigame reward re-read inventory and loadout; account
  switch while open renders no previous-account slot or item; loadout failure leaves inventory, wallet
  and progression READY; guest zero loadout RPCs. Inventory, world-entry, wallet, P0-F3b and P0-F3a
  browser QA re-run.

## Not in scope

Changing the 3D avatar, remote avatars, Realtime payloads, profile badges, starter auto-equip, equip
buttons in the inventory panel, and any server authority change.
