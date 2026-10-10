# INHA WORLD P0-F3a · Progression HUD (read-only)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Status: **P0-F3a IMPLEMENTED**. Reward EXP detail feedback (`+N EXP`): **P1a IMPLEMENTED** separately
(`docs/world/PROGRESSION_REWARD_FEEDBACK_P1A.md`).
Shop level-lock UI: **P0-F3b IMPLEMENTED** separately (`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`);
the shop does not depend on this HUD.

The World HUD shows the signed-in player's own progression. The server stays the only authority
(P0-F0): Level is derived from stored EXP and the immutable thresholds inside
`get_my_world_progression_v1()`. The client adds no migration, no RPC and no Supabase client.

## Modules

| File | Responsibility |
| --- | --- |
| `apps/world/src/progression/progression-client.js` | Calls `get_my_world_progression_v1()` only, validates the snapshot (`parseProgressionSnapshot`), tracks `SIGNED_OUT / LOADING / READY / UNAVAILABLE`. No DOM. |
| `apps/world/src/progression/progression-hud.js` | Presentation: `formatProgression`, `levelUpMessage`, `createProgressionHud`. No RPC. |
| `apps/world/src/main.js` | Wiring only (see below). |

`createProgressionClient({ getClient: () => online?.supabase ?? null })` reuses the member client of
the online layer. `online.supabase` is null for guests, so guests never call the RPC.

## Presentation

Shown exactly as served: `level`, `totalExp`, `nextLevelExp`, `isMaxLevel`. The only client
arithmetic is the bar ratio `progressExp / progressRequired` (clamped 0–1) and thousands separators.

- Normal: `Lv.2 145 / 300 EXP` with a thin bar.
- Highest defined Level: `Lv.10 · 5,240 EXP`, no bar, no invented next threshold.
- Signed out / guest / loading: hidden. RPC error or unexpected shape: hidden, the HUD menu says
  `진행도를 불러오지 못했어요`.

Placement (checked in a real browser, see Verification):

- **≥ 960px wide:** a small pill centred under the location chip (`#progression-hud`), between the
  Main Quest / tour HUD on the left and the Mini-map / guidance column on the right.
- **< 960px (incl. 360px):** a compact `Lv.N` badge with a thin bar inside the location chip
  (`#progression-badge`); no separate centre pill that could cover the Main Quest HUD.
- **HUD menu (all widths):** `#progression-menu-line` with the full `진행도 Lv.N …` line.
- Hidden in the lobby shell and inside rooms, like the Main Quest HUD.

## Refresh (no polling)

| Trigger | Wiring in `main.js` |
| --- | --- |
| First permanent identity, sign-in, account switch, sign-out | `online.onIdentity` → `progression.setAccount(identity ? online.userId : null)` |
| MCM 2026 reward claim finished | MCM `onReward` → `progression.refresh("reward")` (Reward code unchanged) |
| Page restored from back/forward cache | `pageshow` with `persisted` → `progression.refresh("resume")` |

Concurrent refreshes coalesce: at most one request in flight plus one follow-up.

## Stale responses and account isolation

Every `setAccount` change bumps a generation counter and drops the previous snapshot immediately.
A response whose generation or account no longer matches is discarded. The first READY snapshot of
an account has no `previous`, so a Level from another account is never compared.

## Level-up toast

`levelUpMessage(change)` returns `LEVEL UP · Lv.N` only for a READY → READY transition of the same
account where the server Level increased. It reuses the existing `showWorldStatus()` status line.
The first fetch, an equal Level, account switches and errors show nothing. Since P1a the line waits
until an open MCM reward toast has gone (`showWorldStatusAfterReward`), so a reward's `+N EXP` and the
following `LEVEL UP · Lv.N` are read one after the other instead of the status hiding under the toast.

## Verification

- `apps/world/tests/progression-client.test.mjs`: contract parsing, single no-argument RPC, guest and
  signed-out (no RPC), error/throw/malformed → UNAVAILABLE, level-up only on same-account rise,
  account switch drops the snapshot, stale responses after a switch or sign-out, coalescing.
- `apps/world/tests/progression-hud.test.mjs`: Lv.1 / mid / max formatting, server Level never
  recomputed, DOM render for every state, no threshold table or write RPC in client code.
- `apps/world/qa.mjs`: DOM targets, badge inside the location chip, the 960px pill rule, lobby/room
  hiding, no progression-owned Supabase client.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session): 1280×720, 960×720,
  959×720 and 360×740. Main Quest HUD, tour, Mini-map, navigation guidance, auto-move HUD and
  context action were forced visible; the progression view overlapped none of them.
