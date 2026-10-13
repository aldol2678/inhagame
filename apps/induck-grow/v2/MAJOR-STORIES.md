# INDUCK-GROW V2 major stories pack 1

Candidate only. Based on deployed main 2bd3cde1b6ea7d6e462182f5ceb618ee441d412a (#376).
This change does not approve merge or deployment.

## Player-facing content
- The existing 12 provisional game majors each receive a year-2 and year-3 follow-up at first-term week 6: 24 authored scenes and 72 base choices.
- Each year-2 scene reads the first-year signature outcome flag and memory. Each year-3 scene reads the year-2 choice and flag.
- Each incoming choice changes the scene context and recorded outcome. No single choice guarantees an employment outcome or real academic qualification.
- A full new run has 19 choices (16 common, 1 signature, 2 follow-ups), still exactly 120 weeks and 8 terms.
- Existing six competency endings remain. Three major-story chapters are appended as an epilogue, preserving choice differences even when competencies reach their cap.
- Clinical/nursing scenes are classroom role-play, not treatment instructions. All major/course labels remain provisional game content.

## Compatibility
- The engine version, local save key and envelope remain unchanged.
- Missing contentVersion is the legacy 17-choice pack. Existing sessions are never silently upgraded; their RNG and results remain unchanged.
- The browser's new-game handler explicitly opts into grow2-content-major-stories-1. Headless createLife and session.start retain their legacy default for existing callers; callers opt in via contentVersion.
- Existing overwrite confirmation remains in force. New content applies only to newly created opted-in games.
- Unknown versions, malformed follow-up snapshots and inconsistent epilogues fail closed without deleting or rewriting the original raw save.
- Follow-up scheduling uses unique event IDs and no random draws. New choices may legitimately affect later state-weighted common events through stress changes.
- No V1, account, cloud save, wallet, reward, DB, World, project settings or CI policy changes.

## Validation
- Existing registry, life-engine and UI/session suites are retained.
- New Node tests cover 24 scenes/72 choices, all 27 story paths for each of 12 majors, deterministic replay, legacy 17-choice compatibility, exact-once paused choices, reload at every transition, invalid saves and epilogue preservation.
- Development-only in-memory JavaScript evaluation (imports injected and JSON clone/assert shims) passed 12 added tests and compared 180 legacy runs against the original engine byte-for-byte. This is not Node or browser QA.
- Exact-head repository CI and browser QA must be recorded separately. Desktop/mobile rendering of long scene and epilogue text has not yet been verified.
- Release requires comparison on desktop/portrait/landscape, continuing an actual old save, starting a new expanded game, follow-up modal reload, all 3 chapters at graduation, and console/network checks.

## Known follow-ups
The earlier #376 low-severity Escape dismissal, graduation focus restoration and synthetic duplicate-click UX remain separate. Real mobile browser visibility behavior and non-Chromium coverage are not established by this change.

## Review correction
Read-only review identified malformed-save boundary cases. Expanded saves now require coherent signature/follow-up slot, pending event, completion, memory and outcome flag records at years 1–3. Follow-up namespace validation is independent of the saved type field; completed follow-ups are not scheduled again. Three additional regression tests cover missing/repeated slots, missing/duplicated signature prerequisites and injected event types. Original raw saves remain untouched on rejection.
