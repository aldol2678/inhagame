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
- `runtime/promotion-proposal-pack.mjs` — P14 non-executable canary/rollback/observability proposal pack
- `runtime/canary-dry-run.mjs` — P15 virtual cohort canary simulator; no routing, deployment or authority effect
- `runtime/canary-execution-contract.mjs` — P16 short-lived immutable execution-input contract; still no router or activation logic
- `runtime/canary-adapter-interfaces.mjs` — P17 reference-only external adapter interface pack; no adapter invocation
- `runtime/canary-adapter-conformance.mjs` — P18 MOCK_ONLY conformance harness for P17 interfaces; never accepts live adapters
- `runtime/gyeol-verdict-contract.mjs` — P19 shadow-only TML → Gyeol verdict request/response contract; no live Gyeol invocation or authority effect
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


## P14 Promotion Proposal Pack

P14 accepts only a P13 attestation whose human decision is `APPROVE_FOR_NEXT_STAGE`. It produces a non-executable rollout proposal and never changes runtime authority.

The default proposal contains three human-gated Canary phases:

- 1%
- 5%
- 25%

These percentages are proposal defaults only. They are not written to any feature flag, routing system, deployment config, database, or runtime controller.

Every phase requires separate human approval for both entry and exit. Full rollout is intentionally excluded from P14.

The proposed rollback criteria are strict:

- any transition mismatch;
- any Reward receipt mismatch;
- any Reward settlement mismatch;
- settlement coverage below 100%;
- any verification `UNKNOWN` or `CONFLICT`;
- an explicit human stop request.

P14 proposes rollback to `legacy-main2`, but does not execute rollback automatically.

The proposed observability set includes:

- transition parity by transition id;
- Reward receipt parity;
- Reward settlement parity;
- Reward settlement coverage;
- Verification status distribution;
- verified-write disposition distribution;
- rollback-event reasons.

Every P14 pack carries:

```text
advisoryOnly: true
executable: false
automaticExecutionAllowed: false
authorityChangeAllowed: false
runtimeEffect: NONE
persistenceEffect: NONE
current authority: legacy-main2
```

P14 exposes no runtime wiring and no automatic rollout mechanism. It is a design artifact for later human review only.


## P15 Canary Dry-Run Simulator

P15 simulates the P14 canary proposal against virtual cohorts and synthetic failure scenarios. It never assigns a real player, writes a feature flag, changes routing, deploys code, or switches authority.

The simulator returns only:

- `HOLD`
- `ADVANCE_PROPOSED`
- `ROLLBACK_PROPOSED`

Decision order:

1. missing entry human approval -> `HOLD`;
2. any rollback condition -> `ROLLBACK_PROPOSED`;
3. insufficient dry-run evidence -> `HOLD`;
4. missing exit human approval -> `HOLD`;
5. healthy intermediate phase -> `ADVANCE_PROPOSED`;
6. healthy 25% phase -> `HOLD`, because P14 does not include full rollout.

P15 accepts only the strict P14 boundary:

- 1% -> 5% -> 25% phases;
- human approval required for every phase entry and exit;
- zero mismatch budget;
- 100% Reward settlement coverage during canary;
- rollback target remains `legacy-main2`;
- automatic rollback remains disabled;
- full rollout remains excluded.

Synthetic scenario fields include virtual population, resolved writes, transition / Reward receipt / Reward settlement mismatch counts, Verification UNKNOWN / CONFLICT counts, settlement coverage, and an explicit human stop signal.

Every dry-run result carries:

```text
advisoryOnly: true
executable: false
runtimeEffect: NONE
persistenceEffect: NONE
routingEffect: NONE
authorityChangeAllowed: false
current authority: legacy-main2
```

P15 is intentionally not wired into `main.js`, NPC runtime routing, feature flags, deployment systems, or production traffic.


## P16 Canary Execution Contract

P16 defines the minimum evidence envelope that a future real Canary adapter would have to consume. It does not route users or activate TML.

A P16 contract can be created only when all of the following are present:

- the exact P14 proposal pack and its SHA-256 fingerprint;
- the P13 attestation fingerprint carried by that proposal;
- a separate human approval scoped to `CONTRACT_CREATION_ONLY`;
- an explicit P14 phase id (1%, 5%, or 25%);
- an explicit external cohort id whose expected percentage matches that phase;
- an opaque rollback handle;
- an opaque observability handle;
- a short expiration time.

The separate human approval must bind:

- phase id;
- proposal fingerprint;
- P13 attestation fingerprint;
- approver ref;
- approval ref;
- approval timestamp.

The contract forbids embedded user ids or cohort membership. Cohort assignment remains the responsibility of a future external routing system.

P16 contracts are valid for at most two hours after generation and are deeply immutable.

Every contract carries:

```text
advisoryOnly: true
executable: false
activationAllowed: false
routingEffect: NONE
deploymentEffect: NONE
runtimeEffect: NONE
persistenceEffect: NONE
authorityChangeAllowed: false
current authority: legacy-main2
```

The contract also explicitly states that future execution would still require:

- a separate human activation;
- an external router implementation;
- an external rollback adapter;
- an external observability adapter;
- an expiry check at activation time.

P16 does not provide any of those implementations. It is only the bounded input contract for a future adapter design.


## P17 Canary Adapter Interfaces

P17 defines the contracts that future external Canary components would have to implement. It still does not implement or invoke those components.

Required interfaces:

- `Cohort Resolver`: inspect externally managed cohort metadata only;
- `Activation Preflight`: read-only check before any future activation request;
- `Observability Adapter`: inspect observability capability and read metric snapshots;
- `Rollback Adapter`: inspect rollback capability and produce rollback proposals only;
- `Expiry Guard`: pure expiry check for the P16 contract.

The P17 interface pack contains only implementation references, version references and owner references. Executable handlers and user membership are rejected.

The pack preserves the P16 source contract fingerprint, phase, cohort id, rollback handle, observability handle and expiry.

Every P17 pack carries:

```text
advisoryOnly: true
executable: false
adapterInvocationAllowed: false
routingEffect: NONE
deploymentEffect: NONE
runtimeEffect: NONE
persistenceEffect: NONE
authorityChangeAllowed: false
current authority: legacy-main2
```

P17 deliberately does not wire any adapter into `main.js`, the NPC runtime, routing, deployment, persistence, or authority switching.


## P18 Adapter Mock / Conformance

P18 verifies the P17 interface contracts using explicitly branded `TEST_MOCK` adapters only.

The harness invokes synthetic mock methods for:

- Cohort Resolver;
- Activation Preflight;
- Observability Adapter;
- Rollback Adapter;
- Expiry Guard.

The harness refuses unbranded/live-looking adapters before any invocation. It also rejects missing methods, unexpected callable methods and P17 interface-pack boundary drift.

Synthetic conformance probes verify:

- cohort inspection returns metadata only and embeds no membership;
- activation preflight never activates;
- observability is read-only and returns bounded metric snapshots;
- rollback returns proposal-only output and never executes rollback;
- expiry guard returns `VALID` or `EXPIRED` without mutating expiry.

Every result carries:

```text
mockOnly: true
liveAdapterInvocationAllowed: false
routingEffect: NONE
deploymentEffect: NONE
runtimeEffect: NONE
persistenceEffect: NONE
authorityChangeAllowed: false
current authority: legacy-main2
```

P18 is not wired into `main.js`, NPC runtime, routing, deployment or production traffic. It is a conformance test harness for future adapter implementations.


## P19 Gyeol Verdict Bridge

P19 defines the first code-level boundary from TML evidence/verification into the future 결 엔진 (Gyeol/MTE) reference implementation.

P19 is contract-only. It does not call a live Gyeol engine and does not map TML Verification statuses into Gyeol verdicts. The distinction is explicit:

```text
TML Verification ≠ Gyeol Verdict
```

The bridge request carries the TML Verification plus the Evidence records it references. A conforming Gyeol response may return exactly one advisory verdict:

- `VERIFIED`
- `HOLD`
- `REJECTED`
- `UNKNOWN`

Every response must remain effect-free:

```text
advisory_only = true
runtime_effect = NONE
persistence_effect = NONE
authority_change_allowed = false
mutation_requests = []
```

A verdict may cite only Evidence IDs present in the request. P19 is not wired into `src/main.js`, the NPC dev runtime, quest mutation, reward settlement, routing, deployment, or persistence. Existing domain/server authorities remain unchanged.

The design and completion gate are documented in [design/P19_GYEOL_VERDICT_BRIDGE.md](design/P19_GYEOL_VERDICT_BRIDGE.md).
