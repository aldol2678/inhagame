# Campus Growth and Local Graduate Records
Base: 25783ea1958385dc133bce99b18d6cc5e7685ed0. Implementation candidate; no merge/deployment authorized by this change.

## Scope
- Browser new games explicitly request grow2-campus-growth-1. Prior saves stay unchanged: absent growth means legacy, unknown/malformed growth fails closed.
- Reuse each of 12 existing major action names. At the start of each term choose exploration (analysis), making (creative), or teamwork (collaboration). No extra event pauses. First completed week locks the plan; unselected plans default to exploration.
- Completed weeks 5/10/15 grant +1 to the selected competency, before semester GPA/ending calculation. No RNG draws added. Week count and term plan are the milestone ledger; rewards run only inside completeWeek, never render/load/pending-event handling.
- Six competency bars, 24 derived activity milestone cards per graduation, original choice memory cards, six record-derived traits. Cards/traits do not grant additional stats.
- Existing 120 weeks, eight terms, 19 expanded-story choices and 17 legacy choices retained.

## Local archive
- Separate key induck-grow-v2-graduates-1 / schema grow2-graduates-1. Stores completed summaries, semester GPAs, cards, traits, epilogue; never account/World/economy.
- Maximum 50 distinct summaries, 2 MiB encoded string guard. Identical summaries deduplicate; this is not a distinct-run counter.
- Completion and completed-save load attempt archival. Retry/refresh UI is available. Completed snapshots must be archived successfully before replacement.
- Archive is written and read back before a new game replaces the primary save. Existing valid save replacement writes and reads back before changing in-memory current. Failures show a warning; malformed archives are not repaired, filtered, deleted or overwritten.
- Re-read/compare guards reduce stale-tab loss but localStorage has no multi-key transactions or full simultaneous-tab concurrency guarantee. Use one active playing tab. Browser clearing/uninstalling storage still loses local records; no cloud backup/export implemented.
- 50-record cap preserves all existing records and blocks unarchived completed-life replacement; no automatic eviction.
- Ranking is ONLY locally stored completed records, grouped by engine/content/growth version and major. Equal displayed GPA ties at ranks 1,1,3. Different seeds/policies are not equal-difficulty proof. No online leaderboard or authority claim.

## Validation boundary
Development checks use an in-memory JS loader, structuredClone/assert shims, not Node or browser.
Node tests are included in the existing Grow test command; existing public CI runs them.
Required browser QA remains: desktop/mobile portrait/landscape, activity selector keyboard/touch, card overflow, archive details/ranks, storage denial warnings, reload, new-game cancellation and retention.
No CI scope/workflow changes, no Work/Codex executor, no Production/DB changes.
