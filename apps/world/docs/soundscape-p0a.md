# Soundscape P0-A · Audio Zone Foundation

> **Ported from the private development repository** (`apps/world/docs`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

## Runtime

`PlaceZoneRegistry` owns campus location. `createRoomTransition().onChange` owns room location. `main.js` forwards those states to `world-audio.js`, which resolves exactly three ambience profiles. Unmapped campus areas and other rooms are quiet in this phase.

The WebAudio context is created only after a pointer, touch, or key gesture. A locked or failed context leaves the World playable. Visibility changes suspend and resume audio. Profile changes crossfade over the shared `AUDIO_TRANSITION.fadeSeconds`; outgoing loop sources are stopped and disconnected. The Personal Room profile uses a very quiet, low-pass window layer and room tone. The dorm lobby temporarily has no dedicated ambience. There is no BGM.

All six sound layers are deterministic WebAudio synthesized placeholders written for this repository. They have no external source or license dependency. Production recording and mix approval remain separate work.

## Preview and QA

- Gate: `/campus/?lobby=1&audioDebug=1` → select the main gate.
- Inkyung: `/campus/?spawn=inkyung-pond&audioDebug=1` (preview hosts only).
- Personal Room: `/campus/?start=personal-room&audioDebug=1` (preview hosts only; static scene preview without account authority or persistence).

`audioDebug=1` adds a development-only status panel showing resolved zone, ambience, mix, source count, context state, degraded state, and volume. `window.__INHAGAME_P0__.getStatus().audio` exposes the same values. Browser settings include one saved environment volume control.

Run the contract and lifecycle tests with `node --test apps/world/tests/world-audio.test.mjs`. The test suite includes ten campus → lobby → personal room → lobby → campus cycles and verifies one context, bounded source count, timer cleanup, and listener cleanup.

## Deferred checks

The synthesized profiles need a human blind listening pass on speakers and headphones before release approval. Real iOS Safari / Android Chrome audio policy, battery use, and device mute behavior need device QA; a desktop mobile viewport cannot prove these. No production deploy or merge is part of this candidate.
