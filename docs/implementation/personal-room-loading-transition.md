# Personal-room loading transition (local candidate)

## Behaviour
- The lobby door is a static mesh. A UI door illustration opens while the original scene remains visible behind a modal; no world-space hinge animation is claimed.
- Own-room authority lookup, saved furniture layout, and scene/furniture visuals are separate truthful stages. There are no percentages or minimum-duration animation waits.
- Saved layout is bound before the hidden personal scene is prepared. The post-commit room-session flow remains authoritative; its same-room furniture bind reuses the ready snapshot.
- Preparation completes before the scene checkpoint, campus presence pause, reparenting, lighting, collision, or camera changes. Cancellation and preparation failures leave the source scene in place. Scene-switch failures use the existing checkpoint rollback.
- Optional visual loaders keep their existing procedural fallback values. Layout/authority failures fail closed and allow retry from the same source. Uncertain cleanup/rollback keeps the input lock and requests reload.
- Authority timeout invalidates only the same client generation so retry can issue a fresh idempotent request; a late old response cannot repopulate its cache.
- Escape and the cancel button cancel the current attempt. Account changes and pagehide invalidate pending work. Late callbacks cannot enter, reset newer preparation, or dismiss a newer overlay.
- The modal includes an accessible live status, focus containment/restoration, inert background, 44px minimum cancel target, safe-area padding, and reduced-motion CSS. Existing SYSTEM_LOCK input ownership is reused.

## Watchdogs and readiness limits
- Layout preparation retains its 15-second deadline. The visual stage allows 45 seconds of inactivity, renewed only by strictly increasing received bytes from this preparation's code-owned sources. Source-key deduplication prevents multiple placements or replayed snapshots from renewing it with the same bytes. A fixed 210-second preparation cap spans all stages and never moves.
- Small enabled models retain their original eight-second total load/render limit. Trusted immutable manifests larger than 1 MiB use a 15-second transport inactivity limit and fixed 180-second total cap, with at most 30 seconds for byte validation/engine parsing and eight seconds for the first postrender. The shared source has its own deadline, so subscriber turnover cannot prolong a hung request; each placement retains independent cleanup and first-render bounds. These are conservative safety limits, not measured throughput, mobile performance, or asset acceptance targets.
- Streaming copies into an exact-manifest-size buffer, rejects overflow and short EOF, and reports only bytes actually received. Non-streaming compatibility transports emit one actual completed-byte snapshot and remain subject to the same deadlines. No percentage or phase heartbeat is invented. Download completion does not imply validation, rendering, GPU completion, or visual acceptance.
- Progress subscriptions are installed before awaiting fixed room assets, replay the last measured snapshot for late subscribers, and detach independently on abort/settlement. Cancelled or stale preparations cannot renew another attempt's deadline or change its overlay.
- Hidden-scene readiness means layout and engine asset/instance preparation, not shader compilation, GPU completion, or a measured first visible frame. The floor texture is cached while hidden and applied by the existing activation microtask.
- No general world CPU suspension was added. The engine still renders/updates the source during preparation, allowing existing postrender-based loaders to complete. Existing campus online/streaming suspension starts only at commit.
- Official candidate furniture stays disabled. No catalog, seats, size definitions, RPC, database, production deployment, or remote operations are part of this change.

## Validation
Run `node --test apps/world/tests/*.test.mjs`, `node apps/world/qa.mjs`, and `git diff --check`. Optional existing pinned engine fixture: `node apps/world/tests/browser/personal-room-preparation-null.mjs`.
Additional progress/deadline tests: `node --test apps/world/tests/furniture-load-progress.test.mjs apps/world/tests/personal-room-preparation.test.mjs apps/world/tests/room-transition-preparation.test.mjs`.
Targeted tests cover cancellation and retry, deadline failure, stage timer generations, duplicate entry, stale account epochs, late loads, lease commit/cleanup failures, rollback, real furniture-client snapshot reuse, modal focus/inert lifecycle, and reduced-motion source contracts.
Browser/GPU/mobile visual validation remains unperformed because the existing Chromium launch path was denied with EPERM. Node tests and static QA do not establish visual quality or GPU FPS.
