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
- `fixtures/` — executable-domain conformance fixtures tied to current INHA WORLD contracts

## Boundary

INHA WORLD-specific vocabulary belongs to profiles/fixtures, not to generic TML Core semantics.

Provider success is not equivalent to verified state change. Mutating flows must be observable through authoritative readback before they can be treated as satisfied.

The first fixture mirrors Main 2 (`campus_navigation_intro_v1`) and is checked by the public test suite against the live source contract in `npc-factory/main2-quest-contract.mjs`. The P2 semantic validator checks Module ↔ Profile identity, declared predicates/events/capabilities, action argument shape/types, duplicate IDs, and authoritative postcondition readback for mutating capabilities. P3 binds only `world.quest.read` to the existing quest-store `status` boundary and converts the server result into `server.quest` Facts/Observations; `world.quest.advance` remains deliberately unavailable at runtime.

## Current status

TML IR v0.1 is an integration contract under active validation. The sui surface syntax, VM/runtime implementation, and broader language features are not frozen by this directory.
