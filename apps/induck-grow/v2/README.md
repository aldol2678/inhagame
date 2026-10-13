# INDUCK-GROW V2 Foundation (Draft only)

Mission: `INDUCK-GROW-V2-FOUNDATION-01`, based on `INDUCK-GROW-DEPARTMENT-EXPANSION-01` (2026-10-12).

## Actual implementation

- `major-registry.mjs`: 36 **provisional** major entries, 8 families, 12 per wave. Six legacy IDs kept unchanged; 12 wave-1 majors have standalone signature event choices and conceptual course IDs.
- `validate-major-registry.mjs`: complete referential / scope integrity validator; planned entries cannot impersonate playable entries.
- `signature-choice.mjs`: pure deterministic one-event outcome preview for the first 12 majors, with memory, choice-specific outcome and replay protection. **Not yet connected to the main game.**
- `tests/registry.test.mjs`: integrity, alternative choices, replay protection, invalid data, untouched input state.

Run locally: `node --test apps/induck-grow/v2/tests/registry.test.mjs`. The existing Grow `npm test` command includes these tests. Existing 15-week gameplay and 6-major assertion are unchanged.

## Deliberate exclusions / follow-up gates

- No V2 route, life scheduler, 8-semester playable game, real enrollment/eligibility claims, real 2026 curriculums, V2 cloud-save slug, Supabase migrations, authentication changes, WORLD app integration, wallet grants, inventory items or deployments.
- Status is registry/choice foundation only; a 36-major catalog **does not mean 36 playable majors**. Wave-2/3 entries are `planned`.
- `sourceStatus: provisional` applies to display names and course structure pending official academic verification; example `grow2.course.*` IDs are conceptual game IDs, not official course titles.
- `worldMemoryTagIds` are **non-economic candidate content labels**; not permissions, wallet instructions or proof of campus location implementation.
- No existing `induck-grow-p0`, `save_my_grow_progress`, version 1 memory, account or production changes.
- Next milestones require explicit design/technical verification: deterministic 120-week Life Engine, 12 majors' follow-up events + assessments/NPCs, separate V2 save contract, account isolation, read-only WORLD bridge.

## Validation boundaries

The validator checks only data for this V2 registry; it does not certify existing academic curricula, V1 CI, browser UX, WORLD readiness, or backend rewards. The choice executor is an isolated deterministic unit, not a secure authority for cross-game grants.


## LIFE-ENGINE-01 (stacked successor Draft)
- \`life-engine.mjs\` is a pure deterministic, no-storage simulator for **12 foundation majors only** using the preceding \`major-registry.mjs\` and \`signature-choice.mjs\`. This is **not** a replacement for the existing production game.
- Play duration is exactly 4 years, 8 academic terms, 15 weeks each, 120 academic weeks. Vacations are narrative transitions, not extra simulated academic weeks. Medical/pre-med and planned wave-2/3 majors remain unsupported until their own curriculum/scheduler contracts are approved.
- \`createLife({majorId,seed,policy})\` returns an independent state; \`advanceLife(state)\` advances a single week, or stages a choice and pauses **before** that week's advancement; \`chooseLifeEvent(state,id)\` resolves offered choices and clears the pause. \`setLifePolicy(state,policy)\` selects auto-activity direction. \`advanceLifeBatch(state,{maxWeeks:1|2|4|8|16|120})\` models manual speed controls, but no real-time timers/UI are installed. \`simulateCompleteLife\` completes a deterministic headless playthrough for tests only.
- Each term contains 2 state-weighted general events (week 5 and 10), and the first term additionally has one unique major signature event (week 6): **17 choices per full run**. Outcomes change competencies, in-game KRW, stress or stamina. Seed and state are serializable and reproduce the same story, including branches when the exact offered choice ID is replayed.
- Each semester records a **prototype abstract** GPA/credits result and inserts a semester chronicle entry. This is a game balance estimate, not a real university transcript, assessment, diploma or employment qualification. Eight terms generate an ending and a timeline.
- No \`Date\`, \`Math.random\`, network, browser storage, Supabase, real currency or WORLD wallet calls. The engine must never authorize currency/achievement grants from client state; separate signed/verified backend integration is a later gate.
- \`node --test v2/tests/registry.test.mjs v2/tests/life-engine.test.mjs\` covers 12 majors x multiple seeded 120-week full runs, replay, immutable input, pause/resume, alternative choices, credit and resource bounds and fail-closed paths. Existing v1 tests stay in \`npm test\`.

**Future independent gates:** UI prototype and accessibility/speed controls, gameplay balancing and much deeper content, v2 versioned save/account sync, 36-major expansion, official 2026 course verification, and read-only INHA WORLD memory bridge. Nothing has been merged/deployed by this PR.
