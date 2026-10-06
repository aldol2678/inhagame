# NPC Factory P0 · INKYUNG-20

Development-only population NPC generation and QA for `C04_INKYUNG`. Product authority: the Social S1 v0.2 / Social S3 → NPC Life System → NPC Factory P0 design notes (maintained outside this repository). Network/runtime authority stays with Online Architecture v0.1 (see `apps/world/src/network/README.md`). The World app dynamically imports the test runtime only on loopback with `?npcTest=a-r1`; it writes no database records.

## Contract and interpretation

- `contract.schema.json` is the structural JSON Schema. `validate.mjs` evaluates its used keywords directly and adds cross-record rules. No new runtime dependency is required.
- `vocabulary.mjs` lists the exact P0 time, archetype, location, activity, social mode, relationship, and behavior tag vocabularies. Behavior tags are a P0 whitelist, not new world actions.
- Each batch has exactly 20 fictional population NPCs: 10 students, 3 club members, 2 teaching assistants, 2 staff, 1 faculty, and 2 shop workers.
- Each NPC has four schedule slots, each with location/activity/social mode and 2–4 short hooks. `off_zone` is a sentinel rather than a physical crowd location; it is excluded from the six-person per-location cap. `off_zone` requires `leave_zone`.
- `friend`, `clubmate`, and `coworker` candidate relationships require reciprocal edges. `acquaintance` may be directional. No relationship is persisted or mutated by this tool.
- High social mode is capped at six NPCs per period. At least four NPCs must have an off-zone or transit slot somewhere in the day and at least two must be off-zone in the evening. These P0 thresholds make the handoff's qualitative flow/bias constraints testable; they are not new canonical world rules.
- All five capabilities are `false`. A generated NPC cannot start a quest, author world state, create a group, or modify a persistent relationship.

## Reproduce and inspect

Run from repository root with Node.js:

```sh
node apps/world/npc-factory/validate.mjs apps/world/npc-factory/data/validated/INKYUNG-20-A.json apps/world/npc-factory/data/validated/INKYUNG-20-B.json apps/world/npc-factory/data/validated/INKYUNG-20-C.json
node apps/world/npc-factory/tests.mjs
node apps/world/npc-factory/runtime-spike.mjs
node apps/world/npc-factory/tests-repair-a-r1.mjs
node apps/world/npc-factory/tests-human-decision-a-r1.mjs
node apps/world/npc-factory/tests-dev-runtime.mjs
node apps/world/npc-factory/tests-dev-navigation.mjs
node apps/world/npc-factory/tests-dev-memory.mjs
```

For a rendered local inspection, run `node apps/world/dev-server.mjs` from the repository root and open `http://127.0.0.1:8080/campus/?npcTest=a-r1`. Set `PORT` to another local port if 8080 is occupied. The panel switches between morning, class time, lunch, evening, and night, and lets you select each NPC. It checks the A-R1 candidate against the SHA-256 recorded in the synthetic public QA fixture (`data/fixtures/public-fixture.json`, `kind: SYNTHETIC_PUBLIC_QA`, `human_approval: false`) before spawning procedural human avatars. The demo clock cycles through five 15-minute bands (75 minutes total); each browser starts at morning. This is an accelerated local clock, not the real Korean time of day. The population targets are 12, 11, 14, 9, and 5 local NPCs respectively. The live headcount can temporarily differ while NPCs walk to the transit edge and enter or leave the zone. Nana-yul (001) stays at the main gate and Ga-yudam (002) at the Inkyung photo point in all five bands; both are signed-in AI NPCs. Night reuses evening dialogue and AI context because the reviewed A-R1 source has only four slots. Sky and lighting remain fixed. The panel can move the camera near a selected visible NPC. Within 3 m, press `F` or the conversation button to talk; nameplates appear within 8 m. The local test remembers distinct meetings and an interest topic in this browser. The panel identifies this as memory shared by the browser's guest nicknames, not account storage.

### Purposeful NPC P0-B slice

The 18 non-quest NPCs keep all four source schedule slots. An `off_zone` slot now hides the actor and removes its nameplate and talk target. Consecutive off-zone slots stay hidden. When the next outdoor slot begins, the actor reappears at the existing C04 transit edge and walks to its destination. The transit edge is a temporary inspection anchor, not a verified building entrance; this slice does not simulate an interior room. Visible rest, reading, coffee, and snack activities still hold at their destinations. The separate `?campusLife=p0a` student demo also hides at the main hall and student-center activity anchors during study and eating, then resumes outside. Its URL remains for existing test links.

### Campus Pulse P0-C slice

The runtime applies the existing curated attendance sets to the 18 moving NPCs. Each NPC holds its destination activity until the demo clock selects the next band. Attendance changes send departing NPCs to the C04 edge sink; returning NPCs emerge there and walk to their next destination. The protected two quest NPCs remain available throughout. Night is a runtime-only overlay on the reviewed evening source slot, with a smaller attendance set. The frozen A-R1 schema and data still contain four periods.

### Social Motion P0-D slice

NPCs 003 and 012 are reciprocal coworkers in the reviewed roster and share the morning waterfront slot. When the clock enters class time and both are nearby, they wait, join, walk within 3 m of one another to the existing photo point, then separate toward their different class-time destinations. This authored encounter runs at most once per morning-to-class transition. A player conversation pauses both walkers and their route timers; closing the conversation resumes the shared walk. A new time band cancels the social detour and replans each NPC to its current schedule goal. The two quest NPCs remain unaffected. In the localhost panel, select 003 or 012, focus near the waterfront, then select class time to inspect the sequence and the `동행` phase. This slice does not infer new relationships or add dialogue/LLM calls.

`generate.mjs`, `make-fixtures.mjs`, and `quality.mjs` were run once to create committed evidence. They use exclusive creation and deliberately fail when output already exists. This prevents accidental replacement of the P0 dataset. To run a new experiment, use a separate clean copy and label its output separately. A/B/C use independent seeded generator invocations and shuffled profiles/schedules, with one shared authored grammar. They are not three separate model API samples.

## Evidence layout

| Path | Meaning |
| --- | --- |
| `data/raw/INKYUNG-20-{A,B,C}.json` | Preserved generator output |
| `data/validated/INKYUNG-20-{A,B,C}.json` | Byte-identical raw files copied only after validation; no repair |
| `data/fixtures/invalid/*.json` | 14 named adversarial fixtures |
| `data/qa-comparison.csv` | 60 rows ready for later deterministic/model/human disagreement logging |
| `data/repaired/INKYUNG-20-A-R1.json` | Separate, dialogue-only A repair candidate; not substituted for the Phase A baseline |
| `data/fixtures/public-fixture.json` | Synthetic public QA fixture: candidate hash and count, no human approval |
| `data/fixtures/public-roster.json` | Synthetic public roster (visual profiles and fictional affiliations) for local rendering |
| `data/expansion/CAMPUS-28-P2A.json` | Campus expansion population used by the P2-A runtime |

The generator is code authored by an AI coding agent; the repeated dialogue finding is retained rather than quietly edited. A later repair must create separate `REPAIRED` artifacts, preserve these RAW files, record changed fields, and validate again.

The A-R1 candidate follows that rule: it rewrites dialogue only and leaves the original A/B/C dataset and Phase B baseline unchanged. `review-a-r1.mjs` creates a 20-row worksheet with schedules and original/candidate hooks for direct comparison. The quality report, human review worksheets and decision records, the local roster, and the model-judgment run are development records that are not part of the public repository; the public fixtures above stand in for them and grant no Production or canonical adoption.

## Phase B gate

A model-based judgment pass must first discover the evaluator's actual capability and schema, read the existing validated A/B/C files and verify their SHA-256 hashes. Do not regenerate. Record judgments in a separate artifact and populate the comparison sheet without overwriting deterministic results or pretending blank human fields are reviews. Judge usefulness and production value separately.

## Limits

The schema and deterministic checks establish contract validity. Dialogue world-fit and contradiction checks are bounded string/location heuristics; they do not establish naturalness, distinctiveness, stereotype safety, or resemblance to real people. `runtime-spike.mjs` rehearses the original validated data import and a 7.5-minute logical day cycle only. The separate A-R1 localhost test renders stylized human actors with simple activity cues. Gender, departments, and SIM student numbers are separate fictional roster candidate fields, not frozen NPC identity or canonical data. It does not establish pathfinding, final animation, photorealism, human player-view quality, or production import.
