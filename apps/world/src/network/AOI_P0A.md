# INHA WORLD · Online AOI P0-A

Status: **FOUNDATION / INACTIVE**  
Date: 2026-09-29

This slice is the measured follow-up to the Online P0 load probe. It defines the spatial routing contract for a future Supabase Realtime AOI transport, but it does **not** change Production subscriptions yet.

## Why now

The current Place Zone transport is all-to-all Broadcast inside one semantic Place Zone.

The committed capacity probe measured approximately:

| Same Place Zone | Realtime events/s |
| ---: | ---: |
| 10 players | 279 |
| 25 players | 1,700 |
| 50 players | 6,800 |
| 100 players | 26,800 |

The current Online Architecture explicitly allowed AOI/channel splitting once measured load justified it. That threshold is now met.

## P0-A contract

- **Coordinate authority:** canonical network pose metres, never render chunks.
- **Cell size:** **9 m × 9 m**.
- **Interest radius:** **2 cells** in X/Z.
- **Subscriptions per client:** at most **25 AOI cell topics** for one campus Place Zone.
- **Social guarantee:** the current Nearby hysteresis exit radius is 17 m. Any two players within 17 m are guaranteed to fall within the observer's 5×5 subscribed cell window.
- **Topic candidate:** `world:campus:<AREA_ID>:aoi:X<P|N><n>_Z<P|N><n>`.
- **Existing Place Zone topic remains separate:** `world:campus:<AREA_ID>`.

The 25-cell budget intentionally stays below Supabase Realtime's 100-channels-per-connection plan limit. P0-B must still measure channel-join churn before activation.

## Intended P0-B split

Keep the existing Place Zone channel for low-frequency control state:

- Presence / identity / equipment
- zone membership count semantics
- low-frequency social/control events until separately measured

Move high-frequency pose Broadcast to AOI cell channels:

- local pose is published to the player's current primary cell
- each client subscribes to the 5×5 cells around its own primary cell
- cell changes reconcile only the entering/leaving edge of the 5×5 window
- RemotePlayer rendering remains pose-driven, so a distant Presence without an AOI pose is not rendered

This split reduces the dominant movement fan-out without changing PlayerController authority or making coordinates authoritative.

## Synthetic capacity diagnostic

The P0-A test uses the same 2/3-moving, 4 Hz pattern as the committed Online load probe.

With players distributed on a 15 m grid:

| Players | Approx Realtime events/s | Diagnostic band |
| ---: | ---: | --- |
| 25 | 456 | within 500 |
| 50 | 984 | over 500, within 2,500 |
| 100 | 2,092 | over 500, within 2,500 |

A dense 100-player 8 m grid still exceeds 2,500 events/s. Therefore:

- AOI is a **distributed-campus scaling tool**, not a guarantee for tightly packed event crowds.
- 100-player support on a standard 500 events/s ceiling still needs a lower/adaptive pose rate, higher Realtime allowance, a gateway, or instancing.
- crowded live events remain a separate P5-scale problem.

These are deterministic model numbers, not hosted Supabase or browser-rendering proof.

## P0-B activation gates

Do not enable AOI topics in Production until all of these pass:

1. RLS topic grammar explicitly allows AOI topics and still rejects unrelated topics/render chunks.
2. SupabaseRealtimeTransport can maintain one Place Zone control channel plus bounded AOI pose subscriptions without duplicate handlers.
3. AOI cell crossing removes stale subscriptions and distant avatars.
4. entering an AOI window has a late-join pose recovery contract for stationary players.
5. chat / emote / teleport / follow semantics remain explicit rather than accidentally changing scope.
6. 25 / 50 / 100 synthetic tests and 2-browser live Realtime smoke pass.
7. fallback remains local-play-safe when AOI channels fail.

## Non-goals

- no authoritative movement
- no automatic world instancing
- no server-side nearest-K selector
- no change to render chunk/view-distance membership
- no Production RLS change in P0-A
