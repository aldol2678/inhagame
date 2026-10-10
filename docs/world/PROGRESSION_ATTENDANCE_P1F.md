# Progression / Economy P1f · 캠퍼스 출석부 (Monthly Attendance)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Daily attendance claim (+10 인덕코인 / KST day) | **IMPLEMENTED** |
| Monthly cumulative milestones 3 / 7 / 14 / 21 (+30 / +50 / +100 / +150) | **IMPLEMENTED** |
| ☰ → 📅 출석부 panel, reward toasts, Wallet re-read | **IMPLEMENTED** |
| 21-day monthly cosmetic | DEFERRED to **P1f1** (separate reward / item per month) |
| Streaks, backfill, missed-day recovery, attendance tickets | NOT PLANNED here |

## What it is

캠퍼스 출석부 is a persistent account system. It is not an EventRegistry event. Once per
**Asia/Seoul** day, a permanent signed-in account can press **오늘 출석하기** and receive +10 인덕코인.

Attendance is **monthly cumulative, not a streak**. The count is "2026년 9월 · 8일 출석": the
number of days attended in the current KST calendar month. Missing a day removes nothing, and the
count never resets to 1 inside a month.

When the count reaches a milestone during the month, a one-time bonus is added:

| Attended days this month | Bonus | That day's total |
| --- | --- | --- |
| 3 | +30 | 10 + 30 = 40 |
| 7 | +50 | 10 + 50 = 60 |
| 14 | +100 | 10 + 100 = 110 |
| 21 | +150 | 10 + 150 = 160 |

A month with 21 claims pays 21 × 10 + 330 = **540 인덕코인**. Attendance gives no EXP and no items.

Attendance and the Daily Quiz have separate roles. Attendance means "I came today"; the Daily Quiz
means "I played today". They share the same KST day rule, but their rows, rewards and keys are fully
separate, and neither one counts as the other.

## Rules

- **KST DB authority:**
  - The day is `private.world_attendance_today_v1()` = `(now() at time zone 'Asia/Seoul')::date`, the
    same rule as the P1e quiz, defined as its own helper.
  - The month runs from the first of that day's month to the first of the next month.
  - No public RPC takes a date, month, time or user (`p_date`, `p_today`, `p_month`, `p_now` and
    similar do not exist), so the browser clock and timezone have no effect.
- **Explicit claim:** loading the page, logging in, refreshing or opening the panel never claims.
  Only the 오늘 출석하기 button calls `claim_my_world_attendance_v1()`.
- **No backfill:** days before the production rollout are not attended. Accounts start on the first
  day they claim.
- **No missed-day recovery:** there is no past-day claim, no attendance ticket, no ad attendance and no
  admin backfill.
- **Month change:** on 10/1 the status shows `attendedDays = 0` and `claimedToday = false`. September
  rows stay in the database but are not counted, and an October claim creates a new row.

## Schema (`20261001213132_public_baseline.sql` (private `20260929133944_world_attendance_p1f`))

`private.world_attendance_days`, primary key `(user_id, attendance_date)`:

| Column | Notes |
| --- | --- |
| `user_id` | `references auth.users(id) on delete cascade`. Account deletion removes the rows; no new deletion registry. |
| `attendance_date` | KST day from the DB |
| `claimed_at` | |
| `daily_reward_transaction_id` | the daily RewardTransaction |
| `milestone` | null, or one of 3 / 7 / 14 / 21 |
| `milestone_reward_transaction_id` | present exactly when `milestone` is set (check constraint) |

- RLS is enabled and every grant is revoked from public / anon / authenticated.
- There is no monthly aggregate table: the month count is the number of rows in the current KST month.

## RewardDefinitions (coin only)

| Reward | Grant | Source (`SYSTEM`) | Idempotency key |
| --- | --- | --- | --- |
| `reward.attendance.daily` v1 | +10 `currency.induck_coin` | `attendance.daily` | `attendance:daily:<user uuid>:<YYYY-MM-DD>` |
| `reward.attendance.monthly_3` v1 | +30 | `attendance.monthly.3` | `attendance:monthly:<user uuid>:<YYYY-MM>:3` |
| `reward.attendance.monthly_7` v1 | +50 | `attendance.monthly.7` | `…:<YYYY-MM>:7` |
| `reward.attendance.monthly_14` v1 | +100 | `attendance.monthly.14` | `…:<YYYY-MM>:14` |
| `reward.attendance.monthly_21` v1 | +150 | `attendance.monthly.21` | `…:<YYYY-MM>:21` |

- The Reward `source_type` constraint is unchanged: attendance uses `SYSTEM`.
- Dates and months in the keys come from the DB KST day.

## Player RPCs (authenticated; caller = `auth.uid()`; permanent, non-banned account)

| RPC | Does |
| --- | --- |
| `get_my_world_attendance_v1()` | Read-only status. Never claims. |
| `claim_my_world_attendance_v1()` | Claims today, or returns the replay-safe status if today is already claimed. |

Status shape:

```json
{ "rewardDate": "2026-09-29", "month": "2026-09", "claimedToday": true, "attendedDays": 8,
  "attendedDates": ["2026-09-01", "2026-09-03", "…"], "dailyCoin": 10,
  "nextMilestone": { "days": 14, "bonusCoin": 100 },
  "milestones": [ { "days": 3, "claimed": true, "bonusCoin": 30 }, { "days": 7, "claimed": true, "bonusCoin": 50 },
                  { "days": 14, "claimed": false, "bonusCoin": 100 }, { "days": 21, "claimed": false, "bonusCoin": 150 } ] }
```

- `attendedDates` lists only dates in the current month, up to today; no future dates are returned.
- `nextMilestone` is `null` after 21 days.
- The first claim adds `claimed: true, replayed: false, rewards: [daily, milestone?]`, so a normal day
  has 1 reward and a milestone day has 2.
- A same-day repeat returns `claimed: false, replayed: true, rewards: []`.
- Reward entries use the P1e public view (`private.world_daily_quiz_reward_view_v1`): no user, keys,
  child transaction ids or attempts.

## Claim transaction

1. Validate the account.
2. Compute the KST day.
3. Take the advisory lock `hashtextextended('world_attendance:' || uid, 0)`.
4. If today's row exists, return the replay status.
5. Otherwise `new_count` = (rows this month before today) + 1.
6. Run the daily Reward.
7. If `new_count` is 3 / 7 / 14 / 21, run that milestone Reward.
8. Insert the row.
9. Return the status and the rewards.

All of this is one transaction:

- If the daily Reward, or the milestone Reward after a successful daily, is not `SUCCESS` or
  `PARTIAL_SUCCESS`, `ATTENDANCE_REWARD_FAILED` rolls everything back. No row, no daily transaction,
  no milestone transaction and no coin remain. The next claim runs all of it once.
- Concurrency (integration): 8 simultaneous claims give 1 row, 1 daily RewardTransaction and 1 currency
  ledger row. On a milestone day they also give exactly 1 milestone RewardTransaction.

The claim body is `private.world_attendance_claim_v1(p_user, p_today)`. The public RPC always passes
`private.world_attendance_today_v1()`. DB tests call it with pinned dates to cover month ends and
milestones deterministically. It is not callable by anon / authenticated.

## Client

- `apps/world/src/attendance/attendance-client.js`
  - Account generation guard; strict status validation (this month only, no future dates, the count
    must match the dates).
  - Reward shape check reuses `npc-factory/quest-reward-shape.mjs`.
  - One claim at a time: a double click returns `BUSY` and is never sent. No `Date`, `localStorage` or
    `Intl`.
- `apps/world/src/attendance/attendance-panel.js` renders:
  - the header 📅 캠퍼스 출석부 · 2026년 9월 · 이번 달 N일 출석;
  - **unclaimed:** 오늘 출석 🪙 +10 · 누적 N일 🪙 +bonus · [오늘 출석하기];
  - **claimed:** ✅ 오늘 출석 완료 · 다음 보상: N일 출석까지 M일;
  - a milestone row 3일/7일/14일/21일 with ✓/○ and +bonus, with no streak wording;
  - a month calendar laid out from the server month, with 🐥 stamps on attended days, today
    outlined, and future days dimmed with no claim affordance.
- `main.js` wiring:
  - ☰ → **📅 출석부**, with its own BLOCKING_UI input owner `attendance`, one modal at a time with
    Shop / Inventory / Wardrobe / Daily Quiz / map / room change.
  - After a paying claim: the daily toast through the existing Reward Toast Queue ("🎁 보상 획득 /
    +10 인덕코인"), then a queued "누적 출석 보상 / +30 인덕코인" on milestone days, then
    `wallet.refresh("reward")` only (no progression or inventory re-read).
  - Note: at 360×740 the 4.5 s reward toast covers part of the open panel's calendar. It blocks
    nothing; a separate notification UX follow-up can move it.

## Current acquisition summary (production RewardDefinitions)

| Source | EXP | 인덕코인 | Items | Frequency |
| --- | --- | --- | --- | --- |
| First Campus (Main 1) | +100 | 0 | 정문 첫걸음 배지 | once / account |
| Main2 navigation | +100 | +180 | — | once / account |
| Campus Daily Quiz | +25 | +50 | — | once / KST day (PASSED) |
| **캠퍼스 출석부** | — | +10, plus +30 / +50 / +100 / +150 at 3 / 7 / 14 / 21 days | — | once / KST day; milestones once / month |
| MCM landlord first clear | +50 | 0 | 건물주 챌린지 배지 | event / once |
| MCM main clear | +150 | +80 | 생존자 상의, 일일호프 포스터 | event / once |

## Tests

- `supabase/tests/database/81_world_attendance_p1f.test.sql` (49 assertions):
  - privacy, RLS, cascade FK; the 5 coin-only definitions;
  - no-argument public RPCs; anonymous / banned / permanent accounts; the public claim on the DB day;
  - KST 23:59:59 / 00:00 and 9/30 → 10/1;
  - first claim, same-day replay, a gap day (no streak);
  - milestones 3 / 7 / 14 / 21 with the exact wallet totals, 540 for 21 days, and no milestone repeat;
  - the ledger count; October starting at 0 with September kept; no future dates;
  - daily failure and milestone failure roll back, and the retry pays once;
  - isolation, direct abuse, account deletion.
- `01_grants_contract` lists the two new authenticated RPCs.
- `supabase/tests/integration/attendance.integration.test.mjs` (real PostgREST):
  - A: status, claim +10, replay +0, and a date argument rejected;
  - B: two earlier days this month, then the third claim pays 10 + 30 (skipped only on KST day 1–2);
  - C: 8 concurrent claims, on a normal day and a milestone day;
  - account / abuse checks;
  - D: account deletion cascade.
- `apps/world/tests/attendance.test.mjs` (11 tests):
  - bind / refresh without claiming; claim, replay, milestone rewards;
  - duplicate-click lock, stale generation / logout, malformed responses, month change, calendar cells;
  - toasts, panel rendering, `main.js` wiring.

`[REDACTED: production rollout and rollback procedure — maintained privately]`
