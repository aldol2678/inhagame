# Freeze Candidate Delta

## Authority update

Previous public baseline: `84448a7285bfda56aa466b5bf6f1ce374a584e14` (P9).
Task-start latest public main: `68c76093236e70426a645d4aa5a18b00a4ee1deb` (P15).
The public fetch found these follow-ups, in chronological order:

| Commit | Change | Candidate treatment |
|---|---|---|
| b435bac | P10 shadow parity metrics | Preserve diagnostic aggregation; pending account state reset is not v1 admission |
| 37c13f2 | P11 shadow readiness | Advisory READY_CANDIDATE cannot authorize a writer |
| b2c6687 | P12 human promotion review | Review packet remains non-executable |
| 4e036cb | P13 human attestation | Caller reviewerRef/fingerprints prove no backend transaction; no fabricated human decision |
| 0dcd196 | P14 promotion proposal | Percentages and rollback criteria remain proposals |
| 68c7609 | P15 canary dry-run | Synthetic simulation cannot produce admitted runtime Evidence |

The diff spans 14 files: five new runtime modules, six new test files, the existing shadow module, README, and three diagnostic wiring additions in npc-factory/dev-runtime.mjs. It does not change the existing v0.1 IR, core verification module or public DB baseline. No P10–P15 artifact is promoted into the v1 evidence authority chain. See CONTRACT §14. The public repository working tree was not edited.

## Changed

- Authority state is four-state only. Caller knowledge, receipt-read availability and alias recovery are separate.
- Five identity domains are normative; transaction identity excludes executionId. One atomic execution has one canonical parent commit/receipt; competing admitted parent commits are a conflict rather than a selection-by-order opportunity.
- STATE requires EXACT/AT_LEAST snapshot requirement. SETTLEMENT binds expected fingerprint/capability/target and a trusted immutable execution request.
- Host admission is per digest/Scope/role/binding. Full Observation/Fact closure and ledger completeness are explicit.
- Receipt APPLIED/SKIPPED shapes are disjoint; unknown partial commit cannot become a valid atomic receipt.
- Deterministic validation substages and reason selection coexist with unchanged P4 logical tables.
- Profile, bundle, corpus and host-fixture schemas are closed; core reasons and state-dependent execution fields are constrained.
- Set paths are exhaustively enumerated. Time/integer lossless adapters, token underflow and schema evolution rules are normative.
- Corpus inputs are complete values/bundles/host bindings; no patch expansion or note-driven record synthesis remains in the emitted corpus.

## Original 112 vector intents

All 112 original IDs are retained. 132 vectors are added, for **244 total**. No original vector intent is deleted.

| IDs | Change |
|---|---|
| C01–C12 | Original lexical/canonical/digest intent preserved; explicit normalized output/result/reason added |
| V01–V17 | Original rejection intent preserved; raw bytes in Base64, normalized/canonical/digest explicitly null |
| E01–E09 | Primitive comparison layer, explicit reason; full Claim typing remains separate |
| L-* (36) | Original truth table unchanged; reasons made explicit; NOT propagates UNKNOWN/CONFLICT reasons |
| S01–S15 | Full Claim/Evidence/Receipt and digest-bound host input; changed actual effects are explicitly authority-admitted when testing UNSATISFIED |
| S08 | UNTRUSTED_SOURCE renamed to normative UNTRUSTED_PROVENANCE |
| S11 | Valid new-epoch projection is UNKNOWN/SNAPSHOT_INCOMPARABLE; mixed STATE epoch remains INVALID in separate vectors |
| X01–X07 | Authority journal, caller knowledge, transport and concrete key/ID lookup fixture separated; expected assertions moved out of input |
| X02/X03 | Output label is KNOWN, with SUCCEEDED retained in explicit authorityState, not conflated with caller enum |
| X08 | Two admitted immutable Receipt candidates with distinct record IDs and one transaction identity |
| F01–F09/F11/F12 | Explicit Fact/Observation/Claim bundles and deterministic stage faults |
| F10 | Checked arithmetic helper layer; not a new expression operator |
| B01–B03 | Language-neutral host bridge table; not JS object/pointer behavior |

Useful equivalence pairs C01/C02 and C03/C04 are intentionally retained. AND/OR operand permutations are intentional commutativity checks. No exact duplicated old case was found.

## Added

- Five schema documents, machine-readable reason/structural-set registries.
- Namespace, session and Observation isolation; alias lookup; key independence and execution collision.
- Digest-specific provenance, role-only author signing, admitted/forged VerificationResult consumption.
- Receipt repackaging, missing child relation, partial DTO, complete-but-wrong effects, allowed and forbidden SKIPPED.
- Fingerprint changes for identity/target/reward/profile and exclusions for execution/key/transport credential.
- EXACT/AT_LEAST, multistream projection, stale conflict, true OR with authoritative conflict.
- Schema null/unknown fields, U64/I64 bounds, numeric token rounding/underflow, microsecond conversion, exact Id termination.
- All 24 structural-set path permutations; ordinary list order preserved.
- A–E recovery, state transitions and forbidden authority states.
- Combined failures, syntax-before-duplicate and duplicate-before-overflow prerequisites.
- Complete raw 1 MiB boundary inputs, complete 4096/4097 record arrays and depth 32/33 trees.
- 252 canonical byte/digest manifest entries, independently checked by Python RFC8785 and Node ECMAScript/JCS paths.
- Reproducible tooling, validation report and raw file checksums.

## Removed

No original test intent or production code. Removed from the active candidate format:

- Schematic scenario flags standing in for records.
- Implicit JSON Patch expansion/recomputed-oracle instructions.
- Source-name admission shortcut.
- Expected mutation counts/canonical IDs stored inside test inputs.
- Authority NOT_STARTED/UNKNOWN/RECOVERABLE.
- Ambiguous CURRENT and optional-null interpretation.

Unmodified old artifacts remain only under provenance/, clearly outside the candidate normative specification.

## Intentionally unchanged

- Single backend atomic command; no distributed protocol, saga, framework, repo split or production migration.
- One mutation attempt; timeout is not failure; read-only recovery; no implicit retry after rollback/expiry.
- P4 AND/OR/NOT semantics, including OR(SATISFIED, CONFLICT)=SATISFIED.
- Receipt settlement independent of concurrent balance projections.
- Source/hash are not authority; Gyeol/WorldForge gain no transaction authority.
- Separate v0.1 compatibility path and P3–P15 diagnostic/operational review boundaries.
- No claim that production schema already implements any new binding or durable revision.
