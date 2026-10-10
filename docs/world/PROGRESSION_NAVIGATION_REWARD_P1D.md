# Progression / Economy P1d · Main2 navigation reward + first persistent coin faucet

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| `reward.quest.navigation_intro` (+180 인덕코인, +100 EXP) | **IMPLEMENTED** |
| Main2 completion → Reward (server, same transaction) | **IMPLEMENTED** |
| Reward toast + progression / wallet re-read (client) | **IMPLEMENTED** |
| Retroactive grant for accounts already at Main2 stage 9 | NOT DONE (policy) |
| BG01 event reward | NOT CHANGED (`rewardMode: NONE`) |
| Authoritative physical movement proof | NOT PROVIDED (see Security model) |

## What happens

Main2 is `campus_navigation_intro_v1`, the destination and Auto Move tutorial. A player finishes it
when `visit_back_gate` moves the quest from stage 8 to 9. In the same database transaction the server
runs the new production RewardDefinition `reward.quest.navigation_intro` (version 1):

| Position | Grant | Target | Amount |
| --- | --- | --- | --- |
| 0 | CURRENCY | `currency.induck_coin` | 180 |
| 1 | EXP | `exp.campus` | 100 |

There is no item. The tags are `quest` / `tutorial` / `navigation`, and the description is "길찾기 익히기
완료 보상".

On a normal new-player path, First Campus (100 EXP, Lv.2) followed by Main2 gives 200 EXP, which is
still Lv.2 (Lv.3 is at 300), and 180 coins. That is exactly the price of `head.induck_cap` (180, Lv.1),
so the tutorial leads straight into a first purchase and equip: Shop → cap → Inventory → Wardrobe →
HEAD. No LEVEL UP shows on that path. An account whose other rewards cross a threshold still gets the
normal server-snapshot LEVEL UP; the client does not suppress it.

Path: browser `POST /api/world-quest {quest_id, event}` → Vercel proxy → Cloud Run `/quest` →
`createSupabaseQuestStore` (service role) → `public.advance_world_navigation_quest_v1` →
`private.world_reward_grant_v1` → Wallet ledger / P0-F1 EXP adapter.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929092621_world_quest_navigation_reward_p1d`). It adds the
definition, its two grants, and a new body for the Main2 function. Level thresholds, Shop prices,
required levels and every other RewardDefinition are unchanged.

## Trigger and atomicity

- The Main2 `UPDATE` now matches only a valid ordered transition, and `RETURNING` identifies the call
  that moved the row. The old `CASE` wrote `stage = stage` for every other event, so the stage 1..8
  rules and the `{quest_id, stage, available}` response are unchanged.
- Only the call that itself moves stage 8 → 9 on `visit_back_gate` runs the reward. A concurrent final
  call waits on the row lock, re-checks `stage = 8`, updates nothing and runs no reward.
- `SUCCESS` or `PARTIAL_SUCCESS` commits stage 9 together with the coin and EXP.
- Anything else raises `QUEST_REWARD_FAILED`, which rolls back the stage change and the reward
  attempt. The quest stays at stage 8 and the final visit can be retried, so a quest can never be
  complete while its coins or EXP are missing.

## Idempotency

| Field | Value |
| --- | --- |
| Reward id | `reward.quest.navigation_intro` |
| Source type / id | `QUEST` / `quest.navigation_intro` |
| Idempotency key | `grant:quest.navigation_intro:<user uuid>` |
| Coin child key | `reward/grant:quest.navigation_intro:<user uuid>/currency.induck_coin` |
| EXP child key | `reward/grant:quest.navigation_intro:<user uuid>/exp.campus` |

Status calls, repeated `visit_back_gate`, refreshes and reconnects run no reward and return no
`reward` key. Accounts already at stage 9 before this migration are not backfilled; that would be a
separate policy.

## Response

`{ quest_id, stage, available }` is unchanged. Only the completing call adds `reward`, using the same
shape as P1c First Campus (the Reward core result without server-only fields).

## Client

- `quest-store.mjs` reuses `quest-reward-shape.mjs` (no new parser) and passes a reward through only on
  the completing stage of Main 1 (5) or Main 2 (9).
- `createMain2QuestClient({ onReward })` calls `onReward(reward)` once, only for a well-formed reward on
  the `visit_back_gate` → 9 response and only for the current account generation, so there is no late
  callback after sign-out or an account switch. The deferred Auto Move flow is unchanged.
- `createNpcDevRuntime` passes the existing shared `onQuestReward` to both the Main 1 and Main 2
  clients, so there is no second display path.
- `main.js` shows the reward through the existing Reward Toast Queue ("🎁 보상 획득 / +180 인덕코인 /
  +100 EXP"). It then re-reads progression, re-reads the wallet only when an entry is `CURRENCY`, and
  re-reads the inventory only when an entry is `ITEM`. The client never adds coins or EXP and never
  computes a Level.
- EventRegistry `BG01` keeps `rewardMode: NONE`. This is a Main2 quest completion reward, not a BG01
  event reward.

## Security model

This is **ordered, authenticated quest progress plus a one-time server Reward**, the same model as
P1c.

- Destination set, Auto Move start, pause/resume, the Building 5 visit and the Back Gate visit are all
  **client-originated soft evidence**. The server does not prove physical movement.
- The server enforces a verified permanent account, Main 1 completion, strict event order,
  duplicate-safe transitions, a service-role-only RPC, and a one-time idempotent reward whose reward
  id, amount and user are chosen server-side.
- The browser sends only `{quest_id, event}`. It cannot name a reward, currency, amount or user, and
  it cannot call `world_reward_grant_v1` or `advance_world_navigation_quest_v1` directly.

That is acceptable only for this one-time, low-value tutorial reward. **Do not reuse this evidence
model for high-value or repeatable rewards.**

## Current acquisition summary (production RewardDefinitions)

| Source | Reward | EXP | 인덕코인 | Items |
| --- | --- | --- | --- | --- |
| First Campus (Main 1) | `reward.quest.first_campus` v2 | +100 | 0 | 정문 첫걸음 배지 |
| Main2 navigation | `reward.quest.navigation_intro` v1 | +100 | +180 | — |
| Campus Daily Quiz (P1e) | `reward.daily.campus_quiz` v1 | +25 / KST day | +50 / KST day | — |
| MCM landlord first clear | `reward.minigame.landlord_first_clear` v2 | +50 | 0 | 건물주 챌린지 배지 |
| MCM main clear | `reward.event.mcm_2026_main_clear` v2 | +150 | +80 | 생존자 상의, 일일호프 포스터 |

Main2 is the first persistent (non-event) coin faucet; the Campus Daily Quiz (P1e, [PROGRESSION_DAILY_QUIZ_P1E.md](PROGRESSION_DAILY_QUIZ_P1E.md)) is the first repeatable one.

## Tests

- `supabase/tests/database/79_world_quest_navigation_reward_p1d.test.sql` covers:
  - the definition and its grants, and the cap price;
  - the stage 1..8 regression, out-of-order and duplicate events;
  - completion, the reward entries and no server-only fields;
  - wallet 0 → 180 and 100 → 200 EXP at Lv.2;
  - one reward transaction, one coin ledger row and one EXP row;
  - replays, isolation and the Main2-only fixture (0 → 100 / Lv.2);
  - failure rollback (a failing coin child) and retry;
  - no retroactive grant for an existing stage 9, the Main 1 requirement, and direct calls rejected.
- `70` and `77` pinned the whole RewardDefinition catalog. They are scoped to the three definitions
  they describe; their expected values are unchanged.
- `supabase/tests/integration/navigation-reward.integration.test.mjs` runs the real `/quest` handler
  and Supabase store:
  - First Campus → Main2 gives 200 EXP / Lv.2 and 180 coins, once;
  - replay adds nothing;
  - the first purchase (cap 180 → wallet 0 → owned → equipped HEAD) goes through the Data API;
  - forged bodies are rejected;
  - 8 concurrent final visits give 1 reward, 1 coin row and 1 EXP row;
  - other accounts are unaffected.
- `apps/world/tests/navigation-reward.test.mjs` covers:
  - callback / no callback, malformed rewards and stale generations;
  - deferred Auto Move and the Main 1 dependency;
  - the store, the toast and the wiring, and BG01 `rewardMode: NONE`.

`[REDACTED: production rollout and rollback procedure — maintained privately]`
