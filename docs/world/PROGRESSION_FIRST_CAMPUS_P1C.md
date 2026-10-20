# Progression P1c · First Campus reward wiring

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| First Campus quest → `reward.quest.first_campus` (server) | **IMPLEMENTED** |
| Reward toast + progression / inventory re-read (client) | **IMPLEMENTED** |
| Retroactive grant for accounts already at stage 5 | NOT DONE (policy) |
| Authoritative physical visit proof | NOT PROVIDED (see Security model) |

## What happens

A player finishes `campus_first_walk_v1` (Nana-yul → main hall → Inkyung pond → Ga-yudam → back to
Nana-yul). The final `talk_001` moves the quest from stage 4 to 5, and in the same database transaction
the server runs the existing production RewardDefinition `reward.quest.first_campus`:
`badge.main_gate` ×1 + `exp.campus` 100 (P1b). A fresh account goes from 0 EXP / Lv.1 to 100 EXP / Lv.2,
which opens the Lv.2 Shop offers. The wallet does not change (no currency).

Path: browser `POST /api/world-quest {event}` → Vercel proxy → Cloud Run `/quest`
(`createQuestCloudHandler`, verifies the permanent account) → `createSupabaseQuestStore` (service role)
→ `public.advance_world_quest_v1(user, event)` → `private.world_reward_grant_v1` → Inventory / P0-F1
EXP adapter → EXP ledger → derived Level.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929073413_world_quest_first_campus_reward_p1c`) (replaces the
function body only; no table, definition, amount or threshold changes).

## Trigger and atomicity

- The ordered `UPDATE … WHERE stage = 4 AND event = 'talk_001' … RETURNING` identifies the one call that
  completed the walk. Only that call runs the reward. A concurrent final call waits on the row lock,
  re-checks `stage = 4`, updates nothing and returns stage 5 with no reward.
- `SUCCESS` or `PARTIAL_SUCCESS` (badge already owned → `SKIPPED`, EXP still granted) commits stage 5 and
  the reward together.
- Anything else raises `QUEST_REWARD_FAILED`: the stage change and the reward attempt roll back, the
  quest stays at stage 4, and the final talk can be retried.

## Idempotency

| Field | Value |
| --- | --- |
| Reward id | `reward.quest.first_campus` |
| Source type / id | `QUEST` / `quest.first_campus` |
| Idempotency key | `grant:quest.first_campus:<user uuid>` |
| EXP child key | `reward/grant:quest.first_campus:<user uuid>/exp.campus` |

If the key already holds a final transaction (for example a version 1 snapshot made before P1b), the
Reward core replays that snapshot unchanged: no retroactive EXP. Accounts that were already at stage 5
before this migration are not backfilled. A backfill would be a separate policy and migration.

## Response

`{ quest_id, stage }` is unchanged. Only the completing call adds `reward`: the Reward core result
without server-only fields.

```json
{ "quest_id": "campus_first_walk_v1", "stage": 5,
  "reward": { "rewardId": "reward.quest.first_campus", "rewardVersion": 2, "rewardTransactionId": "…",
    "status": "SUCCESS", "replayed": false, "completedAt": "…",
    "entries": [
      { "grantType": "ITEM", "targetId": "badge.main_gate", "requested": 1, "granted": 1, "status": "GRANTED", "reason": null },
      { "grantType": "EXP", "targetId": "exp.campus", "requested": 100, "granted": 100, "status": "GRANTED", "reason": null } ] } }
```

Replays, `status`, `start` and repeated `talk_001` return no `reward` key.

## Client

- `quest-reward-shape.mjs` checks the minimal shape (status `SUCCESS`/`PARTIAL_SUCCESS`, boolean
  `replayed`, non-empty entries with integer `granted`). The Cloud Run store and the browser client both
  reject a malformed reward. Nothing is recomputed.
- `createQuestClient({ onReward })` calls `onReward(reward)` once, only for the current account
  generation: no late callback after sign-out or an account switch.
- `createNpcDevRuntime({ onQuestReward })` passes it through as `onReward`.
- `main.js` shows it through the existing Reward Toast Queue (`🎁 보상 획득 / 정문 첫걸음 배지 획득 /
  +100 EXP`), then re-reads progression and inventory. `LEVEL UP · Lv.2` follows the toast after the
  150 ms gap (P1c0). There is no client EXP or Level math, and the wallet is not re-read.

## Security model

This is **ordered, authenticated quest progress plus a one-time server Reward**. It is not a physical
visit proof.

- The server enforces: a verified permanent account, account-scoped progress, strict event order,
  duplicate-safe transitions, a service-role-only RPC, a one-time idempotent reward, and a server-side
  reward id, amount and user.
- The browser sends only an event name. It cannot name a reward, item, amount or user, and it cannot
  call `world_reward_grant_v1` or `advance_world_quest_v1` directly (both are service-role only).
- The visit events (`visit_main_hall`, `visit_inkyung`) are **client-originated soft evidence**
  (browser place zone + landmark proximity). A modified client can send them without walking there.

That is acceptable only for this one-time, low-value onboarding reward (a badge + 100 EXP, no
currency). **Do not reuse this pattern for high-value or repeatable rewards.** Those need
authoritative evidence, such as a server-judged action like the MCM landlord run, and their own review.

## Tests

- `supabase/tests/database/78_world_quest_first_campus_reward_p1c.test.sql`: stages, order,
  duplicates, reward result, entries, progression 0 → 100 / Lv.2, badge, wallet 0, replays, account
  isolation, failure rollback (badge catalog disabled → stays at stage 4, then retry succeeds),
  PARTIAL_SUCCESS, v1 snapshot replay (no retroactive EXP), direct authenticated calls rejected.
- `supabase/tests/integration/first-campus-reward.integration.test.mjs`: the real `/quest` handler and
  Supabase store against the local stack, covering the full walk, 8 concurrent final talks (1 transition,
  1 reward, 1 EXP row), forged request bodies, and isolation.
- `apps/world/tests/first-campus-reward.test.mjs`: client pass-through, no reward on replay or status,
  malformed reward rejection, no late callback after sign-out, store validation, toast text and
  `main.js` wiring.

`[REDACTED: production rollout and rollback procedure — maintained privately]`
