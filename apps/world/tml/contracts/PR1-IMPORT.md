# Freeze PR1 import provenance and delta

## Authority

- Repository: public `aldol2678/inhagame`; no private repository authority.
- Public main resolved at PR1 task start: `c496c98cf20106961229c46091c5bde0aeaad62d`.
- Public main advanced during validation; final integration baseline:
  `9363a497bee98f9a532549d600e9f897376b07d9` (P18).
- Reviewed candidate baseline: `68c76093236e70426a645d4aa5a18b00a4ee1deb` (P10–P15 included).
- Candidate archive SHA256: `13bc263b93534bdc134ee79ccab1a4baf0bd2900480fe6ba840dae8076df2714`.
- Import: all 23 candidate files copied byte-for-byte to `v1/`; original baseline
  metadata and historical reports deliberately retained.

## Main drift inspected before import

The following public changes occurred after the candidate baseline. None changes
the v1 wire contract or requires regenerating any normative expected value.

| Main commit | Change | Relationship to v1 import |
|---|---|---|
| `b6dfed5` (#45) | P16 canary execution contract | v0.1 advisory contract pinned to P14/P13 evidence and separate approval; activation remains disabled. It is not v1 runtime admission. |
| `3ef537e` (#47) | P17 canary adapter interfaces | Reference-only cohort/preflight/observability/rollback/expiry interfaces; no adapter invocation or writer activation. |
| `c496c98` (#48) | Write admission fencing and attempted-outcome preservation | Existing v0.1 runtime validates and captures inputs before dispatch, preserves uncertain attempts/readbacks, and prohibits automatic mutation retry. It does not implement v1 execution/receipt semantics. |
| `9363a49` (#49) | P18 adapter mock conformance | Synthetic branded-mock harness for the five P17 interfaces, with live invocation and authority effects disabled. It is not v1 contract conformance or runtime admission. |

All 21 changed TML paths were inspected (paths below are relative to
`apps/world/`). The README additions describe P16, P17 and P18.

| Group | Files |
|---|---|
| P16/P17 | `tml/runtime/canary-execution-contract.mjs`, `tml/runtime/canary-adapter-interfaces.mjs`, `tests/tml-canary-execution-contract.test.mjs`, `tests/tml-canary-adapter-interfaces.test.mjs`, `tml/README.md` |
| P18 | `tml/runtime/canary-adapter-conformance.mjs`, `tests/tml-canary-adapter-conformance.test.mjs` |
| Validation and immutable admission | `tml/runtime/conformance.mjs`, `tml/runtime/value-snapshot.mjs`, `tml/runtime/write-admission.mjs`, `tests/tml-conformance-validator.test.mjs`, `tests/tml-runtime-admission.test.mjs` |
| Existing writes and attempt preservation | `tml/runtime/quest-advance-adapter.mjs`, `tml/runtime/verified-write-runtime.mjs`, `tml/runtime/verified-write-plan.mjs`, `tests/tml-verified-write-runtime.test.mjs`, `tests/tml-main2-roundtrip.test.mjs` |
| Existing settlement and pipeline | `tml/runtime/reward-settlement.mjs`, `tml/runtime/reward-aware-pipeline.mjs`, `tests/tml-reward-settlement.test.mjs`, `tests/tml-main2-pipeline.test.mjs` |

The legacy conformance validator still targets the v0.1 schema and time/value
semantics. Legacy settlement still uses balance-delta evidence. Neither is
silently declared conformant to v1 by this import. The word “PR1” in existing
runtime-hardening comments from #48 does not refer to this freeze-specification PR.

## Delta from READY_TO_FREEZE candidate

- **Changed normative artifacts:** none. All bytes, digests, IDs, reason codes and
  vector expectations are preserved; no old digest is superseded.
- **Added integration:** this import report, parent README, a discovery link in
  the TML README, a standalone validation wrapper and an isolated CI job.
- **Removed:** nothing from the candidate; no runtime or regression files removed.
- **Intentionally unchanged:** all five schemas, contract, 244 vectors,
  252 manifest entries, 24 set paths, 82 reasons, synthetic fixtures, provenance,
  tools, checksums, candidate checklist and historical reports.
- **Runtime/DB/production changes:** zero. No migration, deployment, writer
  activation, runtime provider/evaluator implementation or PR2 work is included.

The wrapper runs the candidate reference tools as specification tests and
regenerates only a temporary copy. The Python generator and independent Node
checker remain the two canonical/digest calculation paths. Neither imports the
application runtime. The new CI job uses public dependencies and no secrets or
backend credentials. The pre-existing repository CI job remains unchanged.

## Merge gate

The frozen inventory, all schema checks, 244 reference cases, 252 independent
oracle entries, deterministic regeneration, existing TML regressions and affected
repository CI must pass for the PR head. Review and merge remain separate steps.
An unmerged branch has no canonical merge SHA; publish that SHA only after
verifying the actual merge into public main. This document does not claim that
any JS/Rust/C++/WASM production implementation conforms to v1.
