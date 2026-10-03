# INHA WORLD · MCM 2026 P0-E0 · Server Completion Authority

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260928011430_world_mcm_2026_completion_e0`). This is the precondition
for P0-E reward wiring. **No reward, coin or item is granted here**: completion ≠ reward claim.
Canonical identity: `event.mcm_2026` (좀비대학교 · 2026 문콘경 일일호프).

## Event window

`private.world_events`: `event.mcm_2026` runs from `2026-09-30 12:00+09` to `2026-10-01 01:00+09`
(`timestamptz`), with an `is_disabled` flag. The start was `18:00+09` in this migration and moved to
`12:00+09` in `20261001213132_public_baseline.sql` (private `20260928011440_world_mcm_2026_live_window`) (live phases, see
`apps/world/docs/mcm-2026-client-content-v03.md`). The state is computed from the database clock only:
`DISABLED` → `SCHEDULED` (before start) → `ACTIVE` → `ENDED` (from end). No function accepts a
client time. Every mutation requires `ACTIVE`, and anything else is refused with `EVENT_NOT_ACTIVE`.

## Event progress (trusted server boundary)

`advance_mcm_2026_event_v1(p_user, p_event)` is **server-authoritative (client-noncallable)**, the same boundary as
`advance_world_quest_v1`. The Cloud Run handler verifies the player and forwards only whitelisted
interaction events:

| action | reference NPC (private #215) |
| --- | --- |
| `status` | read only |
| `start` | guide ZUE-900 |
| `investigate_staggering` | 비틀거리는 학생 ZUE-901 |
| `investigate_dancing` | 춤추는 학생 ZUE-902 |
| `investigate_hungry` | 배고픈 학생 ZUE-903 |

`private.world_event_progress` has one row per account: `stage` 1 STARTED / 2 VENUE_UNLOCKED /
3 COMPLETED, `investigated[]`, `started_at`, `updated_at`, `venue_unlocked_at` and `completed_at`.
- Investigations count only after `start`, may happen in any order (as in private #215), and are
  idempotent.
- The venue unlocks by itself when all three are in.
- There is **no action** that sets VENUE_UNLOCKED or COMPLETED directly, and progress never moves
  backwards.

## Landlord minigame (server-issued runs, player = `auth.uid()`)

- `start_mcm_landlord_run_v1()` returns `{runId, status, resumed, startedAt, deadlineAt, serverNow,
  durationMs: 45000, wrongPenaltyMs: 5000, wrongCount, actorIds[5]}`. It **never** returns the
  survivor. The survivor is picked server-side from `extensions.gen_random_bytes` with rejection
  sampling (uniform, unpredictable), replacing private #215's `ACTOR_IDS[run % 5]`. There is one ACTIVE run
  per account (a partial unique index plus a per-account lock), and a repeated start resumes that run.
- `submit_mcm_landlord_choice_v1(runId, actorId)`:
  - Only the run's owner can submit (anyone else gets `RUN_NOT_FOUND`), only while the event is
    ACTIVE, and only for the five `ZUE-MG-00x` actors (otherwise `INVALID_ACTOR`, with no penalty).
  - After the server deadline the run is `FAILED`, even with the right answer.
  - The survivor ends the run as `CLEARED` and records the account's **first clear** once
    (`private.world_landlord_first_clears`).
  - A wrong choice adds one to `wrongCount` and moves the server deadline 5 s earlier; if that
    passes the deadline, the run fails.
  - A terminal run is reported as it stands, so resubmitting never creates a second first clear.
    A new run may start after a FAILED or CLEARED run.
- There is no leaderboard or run history beyond the run rows.

## Main completion

COMPLETED needs the venue unlocked (all three investigations) **and** a server-recorded landlord
clear, in either order. `completed_at = now()` is stamped once and stable on replay. The minigame
alone, or the investigations alone, is not completion.

## Reads and security

`get_my_mcm_2026_event_v1()` (permanent accounts) returns `{eventId, eventState, startsAt, endsAt,
serverNow, progress{stage, investigated, startedAt, venueUnlockedAt, completedAt},
landlord{firstClearedAt, activeRun{runId, startedAt, deadlineAt, wrongCount}}}`. It never contains
the survivor.
- No Data API role has any privilege on the four tables.
- The browser cannot advance progress, write COMPLETED, forge a clear, read survivors, or move the
  window.
- Guests and banned accounts get no progress and no runs.
- Arbitrary `save_my_game_progress` JSON has no completion authority.
- Account deletion cascades all rows.

Next (P0-E):
- `world_event_progress.completed_at` → `reward.event.mcm_2026_main_clear`
- `world_landlord_first_clears` → `reward.minigame.landlord_first_clear`

Claim state stays separate from completion. Wired in P0-E: `MCM_2026_REWARD_CLAIMS_P0E.md`.

## private private #215 rebuild notes

**Reuse conceptually:**
- Content and route:
  - `event-data.js`: title, organizer, programs, venue label, window. Change the id to `event.mcm_2026`.
  - `event-npcs.js`: NPC ids, names, dialogue.
  - `event-route.js`.
  - `event-ui.js`: presentation.
- Venue and room:
  - Back-market venue geometry and the Geonmulju facade.
  - `minigame-room-layout.js` / `-renderer.js`: the room and the five actors `ZUE-MG-001..005`.
  - Room registry and transition wiring.
- The minigame HUD copy (deadline countdown, the −5 s message). Drive it from server `deadlineAt`
  and `serverNow`, not the client clock.

**Discard or rework (client authority):**
- `event-quest.js`: its `localStorage` state, `save_my_game_progress('inha-world')` completion,
  local `completedAt`, and `grantZombieReward`.
- `event-reward.js`: the `zombie2026_survivor_bandage` client cosmetic. Rewards come from P0-C in P0-E.
- `minigame-state.js`: the client state machine, `Date.now()` deadline and `run % 5` survivor.
  Keep only display constants.
- `zombieUniversityPhase(Date.now())` as an authority. Use `eventState` from
  `get_my_mcm_2026_event_v1`. private #215 also let players play in a promo/UPCOMING phase. The server
  contract only accepts play while ACTIVE; changing that is a product decision.
- The `20261001213132_public_baseline.sql` (private `20260927114500_inha_world_event_progress_v2`) `inha-world` games row, which is only
  needed for JSON progress.

**Adapter points to wire later:**
- NPC talks with ZUE-900/901/902/903: the server-side NPC or quest handler (Cloud Run, which
  verifies the JWT) calls `advance_mcm_2026_event_v1(user, 'start' | 'investigate_*')`, for example
  through a `quest-store.mjs`-style store. The browser never calls it.
- Minigame room: the client calls `start_mcm_landlord_run_v1()` on entry and
  `submit_mcm_landlord_choice_v1(runId, actorId)` on each actor talk, and renders the returned status.
- HUD and quest panel: `get_my_mcm_2026_event_v1()`.
- Rewards (P0-E): a claim adapter reads COMPLETED and the first clear and calls `world_reward_grant_v1`.

Known product limits (not authority bugs):
- Actor talks and NPC visits are client interactions. The server verifies the account, the order,
  the window, the deadline and [REDACTED: event secret], but not physical proximity (there is no position authority).
- With five actors, a 45 s deadline and a 5 s penalty, trying every actor always fits inside the
  deadline, so the difficulty is a design choice.
