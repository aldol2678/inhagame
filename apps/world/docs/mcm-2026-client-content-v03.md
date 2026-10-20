# MCM 2026 Client Content Integration v0.3

> **Ported from the private development repository** (`apps/world/docs`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Status: implementation candidate on current main. This ports the playable **좀비대학교** experience from draft private #215 without porting its client-side completion or reward authority.

## Authority chain

```
World interaction
  → /api/world-quest (JWT verified)
  → advance_mcm_2026_event_v1 (server role (redacted))
  → server event progress

Event room
  → start_mcm_landlord_run_v1
  → submit_mcm_landlord_choice_v1
  → server first clear / completion

Verified completion
  → claim_my_mcm_landlord_first_clear_reward_v1
  → claim_my_mcm_2026_main_reward_v1
  → P0-C Reward → Wallet / Inventory
```

The client never supplies a user id, reward id, amount, item, currency, completion flag or survivor answer. `event.mcm_2026` is the canonical event id.

## private #215 audit

| Legacy area | Decision | v0.3 treatment |
|---|---|---|
| Event copy / program list | REUSE | Display-only metadata, no client phase authority |
| ZUE-900..903 characters and dialogue | REUSE | Rebuilt as a separate current-main event runtime |
| Culture Street route / Geonmulju approach | REUSE | Rebased on current street/layout modules |
| Geonmulju 10.7 m reference frontage | REUSE | Dedicated current-main exterior blockout |
| Event room layout / lighting | REUSE | Current Room Transition / local map contracts |
| Five suspect appearances | REUSE | Visual actors only |
| Mini-game state machine | DROP | Replaced by server-issued run / submit RPCs |
| `Date.now()` timeout judgment | DROP | HUD projects server deadline; server judges timeout |
| `run % 5` survivor | DROP | [REDACTED: event secret] is never returned to the client |
| survivor-specific flee hint | DEFER | Would reveal the [REDACTED: event secret] without a dedicated hint contract |
| localStorage event completion | DROP | Server progress readback only |
| `save_my_game_progress` event authority | DROP | Existing trusted quest route forwards allowed actions |
| `zombie2026_survivor_bandage` | DROP | Canonical P0-C rewards only |
| old `main.js`, navigation, minimap, CI trees | DROP | Current-main systems are integrated in place |

## Live UX

- **SCHEDULED (PRELUDE/WARNING):** event info and NPC teasers render, but no progress mutation or run can start.
- **ACTIVE:** guide starts the investigation, then ZUE-901/902/903 are recorded through the trusted quest adapter. All three unlock the Geonmulju room entrance.
- **Room:** the player starts a 45-second server run and talks to one of five suspects. Wrong choices reduce the server deadline by 5 seconds.
- **Clear:** the client refreshes server completion, then calls the idempotent landlord and main claim RPCs. `CLAIMED` and `ALREADY_CLAIMED` are success; `PARTIAL_SUCCESS` is a final successful main claim.
- **ENDED:** no new progress/run. Already-earned claims remain recoverable under the clarified E4 settlement policy.

## Live phases (v0.4)

The event runs as a time-based live event. Every instant is Asia/Seoul with an explicit `+09:00`
offset; the client schedule lives only in `src/events/zombie-university-2026/event-phase.js` and a
test checks it against the DB window migration `20261001213132_public_baseline.sql` (private `20260928011440_world_mcm_2026_live_window`).

| phase | KST | server `eventState` | play |
|---|---|---|---|
| PRELUDE | 09-28 00:00 → 09-29 23:59:59 | SCHEDULED | ZUE-900..903 in the world, atmosphere lines, D-day chip |
| WARNING | 09-30 00:00 → 11:59:59 | SCHEDULED | "오늘 12:00 조사 개시" on the chip and the NPCs |
| OUTBREAK | 09-30 12:00 → 17:59:59 | ACTIVE | full flow above |
| ONSITE_LIVE | 09-30 18:00 → 10-01 00:59:59 | ACTIVE | same rules; "좀비대학교 LIVE" copy only |
| ENDED | 10-01 01:00 → | ENDED | guide farewell only; no new start, run or room entry |

- The server `eventState` always wins over the clock: a local clock can relabel copy but never turn
  SCHEDULED into play or ENDED back into LIVE. Presentation time is projected from `serverNow`.
- When projected server time crosses the window edge the client re-reads the server once
  (throttled to 5 s); an NPC talk at the edge re-reads first.
- PRELUDE/WARNING talks never call the progress endpoint (`mcm2026TalkMode`), and the server
  refuses progress before 12:00 anyway (`EVENT_NOT_ACTIVE`).
- 18:00 adds no rule, check-in or QR; on-site attendance is never a reward condition.
- After ENDED, only an account with a server-recorded clear may re-enter the room, to settle what it
  already earned (P0-E settlement policy). Rewards are unchanged.
- Signed-out players see the public teaser (NPCs, chip) from the local clock; progress needs sign-in.

## QA preview

Preview hosts can use:

- `?event=mcm-2026-preview`
- `?event=zombie-university-2026` (legacy visual-review alias)
- `?start=zombie-minigame-preview`
- `?start=zombie-minigame` (legacy visual-review alias)

Add `&mcmAt=2026-09-30T11:59:50+09:00` (an explicit offset is required) to start the preview clock at
that instant; the in-memory preview then applies the server window rule, so every live phase and
edge can be reviewed. Without it the preview stays playable at any real time.

Preview state is deliberately isolated in memory. It never calls the trusted progress endpoint, Supabase run/submit RPCs or reward claims; claim methods return `PREVIEW` and move no value.

## Known boundaries

- Server authority proves ordered trusted-adapter actions and minigame submissions, not physical proximity to an NPC.
- The survivor-specific movement hint from private #215 is not used because the live browser must not learn the server's [REDACTED: event secret].
- Participation wristband, repeat landlord coins, EXP, Event Token/Shop, QR/location verification and production deployment remain out of scope.
