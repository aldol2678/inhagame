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
- `runtime/verified-write-plan.mjs` — P6 explicit ordered plan runner that chains verified writes and stops on the first non-VERIFIED step
- `runtime/economic-read-adapters.mjs` — P7 authoritative Wallet / Progression readback adapters
- `runtime/reward-settlement.mjs` — P7 Reward receipt + Wallet + EXP settlement Evidence/Verification
- `runtime/reward-aware-pipeline.mjs` — P8 explicit ordinary P5 plan + final P7 settlement pipeline
- `runtime/main2-shadow-contract.mjs` — P9 browser-safe shadow contract aligned to the TML fixtures
- `runtime/main2-shadow.mjs` — P9/P10 memory-only Main 2 observer and parity metrics; no request, write, persistence or external telemetry
- `runtime/shadow-readiness.mjs` — P11 advisory-only readiness evaluator; never changes execution authority
- `runtime/human-promotion-gate.mjs` — P12 immutable human-review packet builder; no approval or authority-switch action
- `runtime/human-attestation.mjs` — P13 immutable human review attestation record; no persistence or runtime effect
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


## P6 Main 2 roundtrip

P6 validates the full `campus_navigation_intro_v1` state machine through the TML verified-write runtime.

The test unlocks Main 2 through the existing Main 1 prerequisite, then executes the explicit nine-transition TML plan from stage 0 through stage 9. Each transition uses P5 pre-read, precondition verification, one provider mutation attempt, authoritative post-read, Evidence and Verification.

P6 does not infer omitted transitions or automatically discover a next write. The caller supplies an explicit ordered transition list. The plan runner stops immediately on the first result that is not `VERIFIED`, and later mutations are not attempted.


## P7 reward settlement evidence

P7 extends the reward-bearing Main 2 final transition beyond quest-stage verification.

For `stage 8 -> 9 / visit_back_gate`, a full P7 `VERIFIED` settlement requires all of the following:

- the P5 quest transition is independently `VERIFIED`;
- the server Reward receipt matches the active reward fixture;
- `server.wallet` readback matches the receipt/spec currency grant;
- `server.progression` readback matches the receipt/spec EXP grant.

Current Main 2 reward fixture:

- `reward.quest.navigation_intro`
- +180 `currency.induck_coin`
- +100 `exp.campus`

The amounts are not recomputed by the UI. The TML fixture is tied to the existing public DB/application reward contracts and is used only to build the expected authoritative post-state.

If the provider times out after the atomic server transaction, P5 may still verify stage 9 by readback. P7 remains `UNKNOWN` unless the Reward receipt itself is also available, even when Wallet and EXP moved correctly. This preserves the distinction between inferred settlement and fully evidenced settlement.


## P8 Main 2 reward-aware pipeline

P8 combines the previously independent P6 and P7 flows into one explicit execution pipeline.

For Main 2:

- transitions `0 -> 1` through `7 -> 8` run through the ordinary P5 verified-write plan;
- transition `8 -> 9 / visit_back_gate` is executed through P7 reward settlement verification;
- the reward transition is selected by the supplied reward spec's `source_transition`, not inferred from position or naming;
- if any ordinary transition is not VERIFIED, the reward transition is never attempted;
- if stage 9 is verified but Reward/Wallet/Progression settlement is not, the pipeline returns `REWARD_UNVERIFIED`, not success.

The current Main 2 pipeline therefore distinguishes:

```text
quest completed + reward settled      -> VERIFIED
ordinary quest step stopped           -> STOPPED
quest completed but settlement unsure -> REWARD_UNVERIFIED
```

P8 also verifies `reward.version` from `server.reward` against the reward fixture version.


## P9 Main 2 Shadow Mode

P9 connects TML to the live Main 2 browser runtime without making TML authoritative.

The existing Main 2 client still owns every request and every gameplay state update. After a valid server response has already been accepted, it emits an isolated copy to the TML shadow observer. Observer errors are swallowed and cannot block quest progress.

Shadow Mode compares:

- observed Main 2 event / previous stage / returned stage against the TML transition contract;
- the final server Reward receipt against the TML reward contract;
- the existing Wallet and Progression readbacks against the expected +180 coin / +100 EXP settlement.

Economic readbacks are not requested by Shadow Mode. It only consumes the Wallet/Progression snapshots already refreshed by the existing reward path. Because those authorities can update independently, partial refreshes remain `PENDING` until both are available.

P9 has no external telemetry sink. Its comparison state exists only in memory and is exposed through the existing NPC runtime debug status as `tml_main2_shadow`.

The rollout invariant is:

```text
legacy Main 2 = authoritative execution
TML shadow    = read-only comparison
```

No TML shadow result changes a request, stage, reward, wallet, progression state or player-facing UI.


## P10 Shadow parity metrics

P10 keeps the P9 execution boundary unchanged and adds structured, memory-only parity aggregation.

The shadow status now exposes:

- transition observations / MATCH / MISMATCH counts;
- per-transition parity ratios;
- Reward receipt parity;
- Reward settlement parity and coverage;
- combined resolved parity;
- reason counters;
- a bounded recent-mismatch sample (20 entries, no user id or raw Reward payload);
- account-scope reset count.

Status refreshes are tracked separately and do not inflate the parity denominator.

Account sign-in, sign-out, or switch clears only pending per-account settlement state. Aggregate parity counters remain available for the current runtime session.

P10 deliberately does **not** define an automatic promotion threshold and does not switch execution authority. A high parity ratio is evidence for later rollout decisions, not a runtime command.

The invariant remains:

```text
legacy Main 2 = authoritative execution
TML shadow    = parity measurement only
```


## P11 Shadow readiness

P11 turns the P10 parity snapshot into an advisory rollout-readiness status. It does not promote TML and does not expose an authority-switch API.

Default thresholds:

- combined resolved samples: at least 100;
- every Main 2 transition: at least 5 observations;
- Reward receipt samples: at least 5;
- Reward settlement samples: at least 5;
- settlement coverage: at least 95%;
- mismatches: 0.

The evaluator returns exactly one of:

- `NOT_ENOUGH_DATA`: one or more sample-count gates have not been met;
- `REVIEW`: sample volume is sufficient but mismatch or settlement-coverage criteria need human review;
- `READY_CANDIDATE`: the configured evidence gates are satisfied.

`READY_CANDIDATE` is intentionally a candidate label, not permission to switch runtime authority.

Every result carries:

- `advisoryOnly: true`;
- `authorityChangeAllowed: false`;
- the thresholds used;
- data-gap diagnostics;
- review diagnostics;
- the parity evidence that produced the result.

The live Main 2 path does not read the readiness result. The invariant remains:

```text
legacy Main 2 = authoritative execution
TML readiness = human-review signal only
```


## P12 Human Promotion Gate

P12 packages the P10/P11 evidence into an immutable human-review packet. It is deliberately a review gate, not a promotion mechanism.

The packet contains:

- the P11 readiness snapshot;
- transition-level parity and sample coverage;
- Reward receipt parity;
- Reward settlement parity and coverage;
- mismatch reason counters;
- bounded recent mismatch samples;
- machine checks for readiness, pending settlement, mismatch history and settlement coverage;
- a required human checklist whose items remain `UNCONFIRMED`.

P12 returns only:

- `BLOCKED`: the evidence is not clean enough to enter human review;
- `HUMAN_REVIEW_REQUIRED`: machine gates are clean, but a person must still inspect the packet.

Even `HUMAN_REVIEW_REQUIRED` carries:

```text
advisoryOnly: true
authorityChangeAllowed: false
current authority: legacy-main2
```

There is intentionally no `APPROVED`, `PROMOTED`, or automatic authority transition state in P12.

The packet is available through the existing debug status as:

```text
npcTest.getStatus().tml_main2_promotion_review
```

The live gameplay path does not consume this value. P12 performs no network request, persistence, RPC, browser storage write, or player-facing UI action.


## P13 Human Attestation Record

P13 records that a human actually reviewed an eligible P12 packet.

It accepts only a P12 packet whose status is `HUMAN_REVIEW_REQUIRED`. Every required P12 checklist item must be explicitly confirmed by the human caller before an attestation can be created.

Supported human decisions:

- `APPROVE_FOR_NEXT_STAGE`
- `REJECT`
- `NEEDS_MORE_DATA`

These are review decisions, not runtime authority decisions.

Even `APPROVE_FOR_NEXT_STAGE` means only:

```text
DESIGN_NEXT_STAGE_PROPOSAL_ONLY
```

and the attestation still carries:

```text
advisoryOnly: true
runtimeEffect: NONE
persistenceEffect: NONE
authorityChangeAllowed: false
current authority: legacy-main2
```

The record includes:

- `reviewedAt`;
- a caller-supplied `reviewerRef`;
- the human decision;
- the full checklist confirmation set;
- an optional bounded note;
- SHA-256 fingerprint of the reviewed P12 packet;
- SHA-256 fingerprint of the human decision context.

P13 performs no storage, network request, RPC, message send, browser-storage write, or authority switch. It returns an immutable record to the caller. Persisting or operationalizing that record is deliberately out of scope.

No attestation is automatically generated by the runtime or by ChatGPT. A human decision must be supplied explicitly.
