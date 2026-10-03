# INHA WORLD Progression UX P1c0 · Reward Toast Queue + Mobile LEVEL UP Position

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Frontend only. No change to Reward, EXP, Level, Wallet, Shop, Inventory, Loadout, `supabase/**`.

| Item | Status |
| --- | --- |
| Reward toast FIFO queue | **IMPLEMENTED** |
| LEVEL UP after the whole reward lane | **IMPLEMENTED** |
| Mobile status / reward toast above the social cluster | **IMPLEMENTED** |

## Reward toast queue (`event-ui.js`)

`createToastQueue({ element })` drives the one existing `.mcm26-toast` element (no extra DOM, no
global notification framework). `say(text, ms)` shows at once when the lane is idle; otherwise it is
queued and never replaces the toast on screen. When a toast ends it hides, waits the gap
(`TOAST_QUEUE_GAP_MS` = 150 ms) and shows the next one for its own duration (reward 4500 ms, preview /
failure 3200 ms). No dedupe: every server result is shown in order; replay / idempotency stay with the
server. `destroy()` clears the timer, the gap and the queue, so nothing shows after it.

`toastRemainingMs()` is the time until the **whole lane** is idle: the current toast (or gap) plus every
queued toast and its gap. It is 0 only when nothing is shown or queued.

## LEVEL UP ordering (`createStatusAfterReward`, used by `main.js`)

`showWorldStatusAfterReward(message)` (LEVEL UP from the progression re-read, the REWARD_FAILED retry
hint) waits `toastRemainingMs() + 150 ms` and **re-checks right before showing**: a reward queued after
the wait was computed pushes the status back again. One deferred status at a time: a newer one
replaces an older one that has not shown yet (no stale LEVEL UP at a strange time).

MCM final settle (landlord → main 60 ms later, Level rising on the landlord re-read), measured in
Browser QA on both viewports:

| | shown | hidden |
| --- | --- | --- |
| A · badge + `+50 EXP` | 0 ms | 4 501 ms |
| B · coin + items + `+150 EXP` | 4 651 ms | 9 152 ms |
| `LEVEL UP · Lv.2` | 9 302 ms | 12 303 ms |

## Mobile position (`styles.css`, `event-ui.js`)

On touch phones (`pointer: coarse` and ≤ 560 px) `.follow-status` moves above the social cluster
(48 px buttons), the RUN button and a visible transport button: `bottom: max(212px, safe-area + 184px)`,
222 px with a transport button. Desktop positions are unchanged. The joystick size option was later
removed (one fixed joystick size, side only), and with it the large-joystick rules.

360×740 (left / right joystick, with and without the transport button): status and reward toast
overlap none of 👥 😀 💬, joystick, RUN, JUMP, context action or transport.

## Tests

- `apps/world/tests/reward-toast-queue.test.mjs` — fake-clock FIFO, durations, gaps, no dedupe,
  `toastRemainingMs` growth, destroy (also mid-gap), PREVIEW / REWARD_FAILED / ALREADY_CLAIMED order,
  the late-enqueue race (A → B → LEVEL UP), newer-status replacement, the real event UI on one toast.
- `apps/world/tests/reward-exp-feedback.test.mjs` updated for the new deferral wiring.
