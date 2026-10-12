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
