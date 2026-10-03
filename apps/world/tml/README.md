# INHA WORLD × TML

This directory contains the public INHA WORLD integration surface for TML (official name: TML; English spelling: sui).

## Scope

TML is used here as a semantic/state-transition layer above the existing game implementation. It does not replace the browser runtime, rendering stack, Supabase authority, or other execution providers.

- `ir/tml-ir.ts` — TML IR v0.1 TypeScript contract
- `schema/tml-ir-v0.1.schema.json` — strict JSON Schema for Module / Profile / Trace
- `profiles/inha-world-v0.1.profile.json` — public INHA WORLD vocabulary, capabilities, and authority rules
- `runtime/conformance.mjs` — generic Module ↔ Profile semantic conformance validator
- `runtime/quest-read-adapter.mjs` — P3 read-only `world.quest.read` adapter producing authoritative TML Facts/Observations
- `runtime/capability-registry.mjs` — P3 read-only capability registry; mutating capabilities are intentionally unbound
- `runtime/verification.mjs` — P4 authority-aware Evidence/Verification evaluator with SATISFIED / UNSATISFIED / UNKNOWN / CONFLICT states
- `runtime/trace.mjs` — P4 Trace recorder for Observation / Fact / Evidence / Verification records
- `runtime/quest-advance-adapter.mjs` — P5 one-attempt provider boundary for `world.quest.advance`
- `runtime/verified-write-runtime.mjs` — P5 pre-read → one write → authoritative readback → verification loop
- `fixtures/` — executable-domain conformance fixtures tied to current INHA WORLD contracts

## Boundary

INHA WORLD-specific vocabulary belongs to profiles/fixtures, not to generic TML Core semantics.

Provider success is not equivalent to verified state change. Mutating flows must be observable through authoritative readback before they can be treated as satisfied.

The first fixture mirrors Main 2 (`campus_navigation_intro_v1`) and is checked by the public test suite against the live source contract in `npc-factory/main2-quest-contract.mjs`. The P2 semantic validator checks Module ↔ Profile identity, declared predicates/events/capabilities, action argument shape/types, duplicate IDs, and authoritative postcondition readback for mutating capabilities. P3 binds only `world.quest.read` to the existing quest-store `status` boundary and converts the server result into `server.quest` Facts/Observations; `world.quest.advance` remains deliberately unavailable at runtime. P4 evaluates conditions only from the profile-declared authoritative source, preserves missing evidence as `UNKNOWN`, preserves same-snapshot disagreement as `CONFLICT`, and evaluates the latest authoritative observation snapshot so normal state progression is not misclassified as a conflict.

## Current status

TML IR v0.1 is an integration contract under active validation. The sui surface syntax, VM/runtime implementation, and broader language features are not frozen by this directory.


## P5 design

The next mutating-runtime design is documented in [design/P5_VERIFIED_WRITE_RUNTIME.md](design/P5_VERIFIED_WRITE_RUNTIME.md).

P5 implementation now has a candidate verified-write registry. The existing P3 read-only registry remains available in parallel. P5 requires precondition verification, exactly one mutation attempt, mandatory authoritative readback, P4 Evidence/Verification, and no automatic mutation retry after timeout or ambiguous provider failure.
