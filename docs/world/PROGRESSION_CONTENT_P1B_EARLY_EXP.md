# INHA WORLD Progression Content P1b · Early EXP Rewards & Balance

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043331_world_progression_early_exp_p1b`).

| Item | Status |
| --- | --- |
| EXP Authority (P0-F0) | **IMPLEMENTED** |
| Reward EXP Adapter (P0-F1) | **IMPLEMENTED** |
| Reward EXP Feedback (P1a) | **IMPLEMENTED** |
| First production EXP balance | **IMPLEMENTED** (this document) |
| MCM EXP Sources (landlord first clear, main clear) | **IMPLEMENTED** |
| First Campus RewardDefinition EXP | **IMPLEMENTED** |
| First Campus player-facing execution | **IMPLEMENTED** (P1c, [PROGRESSION_FIRST_CAMPUS_P1C.md](PROGRESSION_FIRST_CAMPUS_P1C.md)) |
| Additional Exploration EXP | FOLLOW-UP |
| Main2 navigation reward (+100 EXP, +180 코인) | **IMPLEMENTED** (P1d, [PROGRESSION_NAVIGATION_REWARD_P1D.md](PROGRESSION_NAVIGATION_REWARD_P1D.md)) |
| Campus Daily Quiz (+25 EXP, +50 코인 / KST day) | **IMPLEMENTED** (P1e, [PROGRESSION_DAILY_QUIZ_P1E.md](PROGRESSION_DAILY_QUIZ_P1E.md)) |
| 캠퍼스 출석부 (+10 코인 / KST day, monthly 3/7/14/21 bonuses, no EXP) | **IMPLEMENTED** (P1f, [PROGRESSION_ATTENDANCE_P1F.md](PROGRESSION_ATTENDANCE_P1F.md)) |
| Additional Quest EXP | FOLLOW-UP |
| Level Unlock Feedback | FOLLOW-UP |
| Lv.4+ Content | FOLLOW-UP |

## Balance canon

| Source | RewardDefinition | EXP |
| --- | --- | --- |
| First Campus | `reward.quest.first_campus` | 100 |
| Landlord first clear | `reward.minigame.landlord_first_clear` | 50 |
| MCM main clear | `reward.event.mcm_2026_main_clear` | 150 |

Early total: 300 EXP = Lv.3 (thresholds unchanged: Lv.2 = 100, Lv.3 = 300, Lv.4 = 600, …, Lv.10 = 4500).

| Progress | Total EXP | Level | Shop |
| --- | --- | --- | --- |
| fresh | 0 | 1 | Lv.2 / Lv.3 offers `LEVEL_REQUIRED` |
| first_campus | 100 | 2 | Lv.2 offers unlock (sneakers, hoodie, campus map poster, desk lamp) |
| + landlord | 150 | 2 | Lv.3 offers still locked |
| + MCM main | 300 | 3 | Lv.3 offers unlock (backpack, blue rug, induck chair) |

Order does not matter (main 150 → + landlord 200 → + first_campus 300 = Lv.3). Lv.4+ is not
reachable from these three rewards. Shop `required_level`, prices, wallet amounts and every existing
coin / item grant are unchanged.

## Grants

Each definition gains one row after its existing positions:

| rewardId | position | grant_entry_id | grant_type | target_id | amount |
| --- | --- | --- | --- | --- | --- |
| `reward.quest.first_campus` | 1 | `exp.campus` | EXP | `exp.campus` | 100 |
| `reward.minigame.landlord_first_clear` | 1 | `exp.campus` | EXP | `exp.campus` | 50 |
| `reward.event.mcm_2026_main_clear` | 3 | `exp.campus` | EXP | `exp.campus` | 150 |

`exp.campus` follows the P0-F1 fixture convention. EXP runs only through the unchanged path:
Reward → P0-F1 EXP entry → `private.world_exp_apply_v1` → append-only EXP ledger → derived Level →
`get_my_world_progression_v1()` → HUD / LEVEL UP / Shop gate. Ledger provenance: `source_type`
`reward`, `source_id` `<rewardId>:<rewardTransactionId>:exp.campus`, idempotency key
`reward/<parent key>/exp.campus`. No new RPC, no client EXP write.

## Version and retroactive policy

A RewardTransaction records `reward_version` and snapshots its grants into entry rows when it is
created; a FAILED transaction resumes from that snapshot. The content changed, so the three
definitions move from **version 1 to version 2**:

- transactions created after the migration record version 2 and carry the EXP entry;
- final (SUCCESS / PARTIAL_SUCCESS) version 1 transactions are immutable and replay their stored
  result: no EXP, no EXP ledger row, `reward_version` stays 1 (an MCM claim replays as
  `ALREADY_CLAIMED` with its original three entries);
- a FAILED version 1 transaction resumes its own version 1 snapshot and completes without EXP.

**No retroactive EXP backfill** in this PR: accounts that claimed these rewards before the migration
do not receive the new EXP. A backfill, if wanted, is a separate policy and migration.

## First Campus

P1c wires the player path: the call to `advance_world_quest_v1` that moves `campus_first_walk_v1`
from stage 4 to 5 (`talk_001`) runs `reward.quest.first_campus` through the existing Reward core in the
same transaction. The browser never calls a Reward RPC. See
[PROGRESSION_FIRST_CAMPUS_P1C.md](PROGRESSION_FIRST_CAMPUS_P1C.md) for the trigger, atomicity,
idempotency and the soft-evidence security model.

## MCM (player path)

- `claim_my_mcm_landlord_first_clear_reward_v1()` → badge + `exp.campus` 50.
- `claim_my_mcm_2026_main_reward_v1()` → +80 coin, survivor top, poster + `exp.campus` 150.

P1a shows them unchanged (`+50 EXP`, `+150 EXP`), then the existing progression re-read and, when the
server Level rises, `LEVEL UP · Lv.N` after the reward toast.

Observed in Browser QA: the landlord clear is the last MCM stage, so the settle action claims both
rewards back to back and the main reward toast used to replace the landlord toast after ~60 ms.
**IMPLEMENTED** in Progression UX P1c0 (`docs/world/PROGRESSION_NOTIFICATION_QUEUE_P1C0.md`): reward
toasts now show FIFO (`+50 EXP` for its full 4.5 s, then the main reward), and LEVEL UP follows the
last one.

## Verification

- `supabase/tests/database/77_world_progression_early_exp_p1b.test.sql` — definitions, amounts,
  positions, identifiers, versions, unchanged non-EXP grants / thresholds / Shop levels; first_campus
  100 → Lv.2, landlord claim 50, main claim 150 → 300 / Lv.3; Shop at Lv.1 / 2 / 3; replays move no
  EXP; ledger provenance and entry ↔ ledger identity; order independence; account isolation; v1
  replay and v1 FAILED resume gain no EXP; v2 failed-child resume settles EXP once.
- `supabase/tests/database/70_…`, `73_…` updated: the production results now include the EXP entry.
- `supabase/tests/integration/mcm-completion.integration.test.mjs` (P1b section) — real REST claims:
  0 → 100 → 150 → 300 with Shop tiers, replay, order independence, 8 concurrent landlord and main
  claims → one EXP ledger row each; `reward.integration.test.mjs` updated for the EXP entry.
- `apps/world/tests/progression-early-exp.test.mjs` — production claim results render `+50 EXP` /
  `+150 EXP` with unchanged coin / item lines; LEVEL UP stays server-derived; reward re-read wiring.
- Browser QA against the disposable local stack (all migrations): fresh account → settle → `+50 EXP`,
  `+150 EXP` → 200 / Lv.2 → `LEVEL UP · Lv.2`; first_campus account 100 → 300 / Lv.3 →
  `LEVEL UP · Lv.3`; replay → `이미 정산된 보상입니다`, no EXP, no LEVEL UP; 1280×720 and 360×740.
