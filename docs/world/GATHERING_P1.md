# Gathering P1 — trusted presence consumer + world interaction

Gathering P1 extends the closed P0 harvest transaction with the first player-facing world surface.
It does **not** weaken the authority boundary: browser position, Realtime pose and telemetry remain
presentation only and cannot prove harvest eligibility.

## World source

The first semantic source stays:

- `gathering.campus.leaf_pile_01`
- label: 하이데거 숲 낙엽 더미
- source position: the existing `lmk_heidegger_forest` game-navigation center
- interaction/trust radius: 4 m (2 world units)
- place zone: `AREA_AGORA_6_9`

`gathering-spots.js` derives the browser placement from the current facility authority. The DB
stores the projected source geometry and an integration test fails if those two drift.

A small leaf-pile prop is rendered at the same source. It is presentation only.

## Interaction contract

The shared world interaction slot exposes:

- icon: 🍂
- action: 낙엽 줍기
- keyboard: existing F interaction path
- mobile: existing context-action button
- busy state: 채집 중…

There is no new modal. An accepted server result uses the existing world status feedback and
refreshes Inventory + Life Skill Book from their owning authorities.

The action is only offered when the Gathering client reports the server endpoint as available.
The browser never decides reward eligibility.

## API boundary

`/api/world-gathering` is disabled unless:

`WORLD_GATHERING_API_ENABLED=1`

Supported POST operations:

- `{ op: "read" }`
- `{ op: "harvest", sourceRef, clientAttemptKey }`

The server derives the account from the bearer session and invokes service-role RPCs. Client
payloads cannot supply actor, coordinates, item, quantity, discovery, XP, policy or time.

Lost harvest replies reuse the same client attempt key, so exact retries return one immutable
Activity settlement receipt.

## Trusted presence

P1 adds:

- `private.world_gathering_positions`
- `public.world_gathering_observe_position_v1(...)`
- `private.world_gathering_require_position_v1(user, source)`

The producer contract matches Fishing F3:

- service-role issuer only
- permanent, non-banned account
- strictly increasing per-account revision
- identical same-revision replay only
- fresh observation younger than 5 seconds
- `CAMPUS / ON_FOOT` only
- source radius + y-range checked server-side

A successful exact harvest replay is checked before the position gate, so a lost response can be
recovered even after the player walks away.

## Critical delivery HOLD

This repository still has **no authoritative world-position producer**. Current browser movement,
`pose-source.js`, Realtime presence and online heartbeats are not trusted evidence. Relaying those
values through a service credential would not satisfy this contract.

Therefore P1 intentionally leaves:

- Gathering runtime disabled
- Gathering source `COMING_SOON`
- `life.gathering` `COMING_SOON`
- `collection.plant.campus_leaf` `COMING_SOON`
- `WORLD_GATHERING_API_ENABLED` unchanged

The P1 code, interaction and trusted consumer can merge safely, but player exposure stays HOLD until
a real producer is connected and a separate activation/Production rollout is approved.

## Verification

- `gathering-spots.test.mjs`: placement and shared interaction state.
- `gathering-client.test.mjs`: availability, payload boundary, retry key and probe throttling.
- `gathering-service.test.mjs`: auth-derived actor, forbidden client authority, HTTP gate.
- `99_world_gathering_p1.test.sql`: geometry, RLS, grants and closed defaults.
- `gathering-p1.integration.test.mjs`: code/DB geometry parity, missing/out-of-range/ineligible
  presence, accepted harvest, exact replay after movement, deletion cascade.
- authority guards include Gathering positions and their only writer.

No Vercel Preview is required for this slice. Local/static checks, GitHub CI and disposable Supabase
are sufficient until a hosted authoritative producer exists.
