# INHA WORLD Progression P1a · Reward EXP Detail Feedback (`+N EXP`)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| EXP Authority (P0-F0) | **IMPLEMENTED** |
| Reward → EXP Adapter (P0-F1) | **IMPLEMENTED** |
| Progression HUD (P0-F3a) | **IMPLEMENTED** |
| Reward EXP Detail Feedback | **IMPLEMENTED** (this document) |
| Production EXP Content Sources | FOLLOW-UP |
| Level Unlock Feedback | FOLLOW-UP |
| Additional Quest / Exploration EXP | FOLLOW-UP |

The MCM reward toast now shows an EXP grant from the server Reward result as one more line:

```
🎁 보상 획득
+120 인덕코인
건물주 챌린지 배지 획득
+50 EXP
```

This is presentation only. No RewardDefinition, EXP amount, Level threshold, RPC or migration changed.
Production MCM RewardDefinitions have no EXP grant today, so production shows no `+N EXP` line; that is
expected until a content/balance decision adds one.

## Source of the amount

`result.rewardResult.entries[]` with `grantType === "EXP"` is the only source. Nothing is derived from
totalExp or Level differences, reward ids, source types or constants.

P0-F1 settles an EXP entry as `GRANTED` (`granted = requested`, confirmed against the EXP ledger) or
`FAILED` (`granted = 0`, retried later); EXP is never `SKIPPED`. So:

| Entry | Line |
| --- | --- |
| `GRANTED`, `granted` a positive integer | `+N EXP` from `granted`, thousands separators (`+1,000 EXP`) |
| `FAILED` | none (never shown as earned) |
| `SKIPPED` (not produced for EXP) | none; no case is invented |
| malformed (`null`, `0`, negative, NaN, non-integer, string, unsafe integer) | none; no raw / NaN text |

The server `reason` is never shown. `requested` is not used for EXP, so a not-yet-granted amount can
never read as earned. CURRENCY and ITEM lines are unchanged.

## Claim statuses

`rewardToastMessage(result)` keeps the existing structure:

- `PREVIEW` → the QA preview notice; no EXP line even if entries were present.
- `REWARD_FAILED` → the existing failure notice (`보상 정산에 실패했어요...`); no line at all, so a
  partially granted sibling or a failed EXP entry is not listed. The claim stays retryable.
- `ALREADY_CLAIMED` (`replayed: true`) → the existing `이미 정산된 보상입니다` heading with the past
  settlement lines (including `+N EXP`), never `🎁 보상 획득`. Nothing is added client-side; the
  following progression re-read returns the unchanged server total, so no LEVEL UP appears.
- `CLAIMED` → `🎁 보상 획득` and one line per entry in server order.

## Order with LEVEL UP

`main.js` `onReward` is unchanged: `showReward(result)`, then (non-preview) `progression.refresh("reward")`,
`wallet`, `inventory` and `loadout` re-reads. The Level is never computed from the Reward result; a
Level rise is detected by the existing `levelUpMessage` between two READY server snapshots.

Browser QA reproduced a real collision: the `LEVEL UP · Lv.N` status line sits in the same bottom-centre
column as the reward toast (and under its z-index), so it was hidden for its whole 3 s. Minimal fix:

- `showWorldStatusAfterReward(message)` shows the status line immediately when no reward toast is up,
  otherwise after it has gone (`mcmEventUi.toastRemainingMs()` + 150 ms). Used for LEVEL UP and the
  existing REWARD_FAILED retry hint. No notification framework.
- The reward toast is display-only (`pointer-events: none`), sized `max-content` (it was shrinking to
  half the viewport and wrapping item names), and on narrow screens (≤ 560 px) sits above the
  context action and the social buttons (`bottom: max(212px, safe-area + 170px)`).

Resulting sequence (QA, both viewports): reward toast 4.5 s → 150 ms → `LEVEL UP · Lv.2` 3 s; the HUD
already shows the server Lv.2 while the toast is up.

## Files

- `apps/world/src/progression/reward-exp-line.js` — pure `rewardExpLine(entry)`.
- `apps/world/src/events/zombie-university-2026/event-ui.js` — `rewardLine` handles EXP;
  `rewardToastMessage(result)` extracted (pure); `toastRemainingMs()`; toast CSS.
- `apps/world/src/main.js` — `showWorldStatusAfterReward` for LEVEL UP and the retry hint.

## Verification

- `apps/world/tests/reward-exp-feedback.test.mjs` — CURRENCY / ITEM lines unchanged, `+50 EXP`,
  `+1,000 EXP`, granted over requested, composite order, no-EXP output identical, PREVIEW,
  REWARD_FAILED, FAILED / SKIPPED EXP, ALREADY_CLAIMED heading, malformed amounts, no progression
  mutation, `onReward` re-read wiring, `levelUpMessage`, status deferral wiring.
- Browser QA (real `/campus/`, fake member Supabase with fixture claim results, real MCM settle action
  → claim RPC → `onReward`; 1280×720 and 360×740): A composite reward with `+50 EXP`; B `+50 EXP`
  crossing Lv.1 → Lv.2 (HUD Lv.2 from the server re-read, LEVEL UP after the toast); C ALREADY_CLAIMED
  (server total unchanged, no LEVEL UP); D REWARD_FAILED (no EXP text, retry hint after the toast,
  retry action kept); long item names + `+1,000 EXP` on 360 px stay on screen without overlapping the
  context action, social buttons or menu toggle; 0 console / page errors.
