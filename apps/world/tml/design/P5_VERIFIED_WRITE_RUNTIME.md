# TML P5 · Verified Write Runtime Design v0.1

Status: DESIGN · NON-RUNTIME · NOT YET BOUND  
Target profile: `inha.world@0.1`  
First capability: `world.quest.advance`  
Baseline: public `aldol2678/inhagame` main after TML P4

## 1. Goal

P5 introduces the first mutating TML runtime path while preserving the authority and verification rules established in P0-P4.

The runtime must implement this contract:

```text
pre-read
  -> precondition verification
  -> action invocation
  -> authoritative readback
  -> evidence
  -> postcondition verification
  -> runtime disposition
```

A provider response is never sufficient to declare a state transition complete.

## 2. Non-goals

P5 does not:

- replace the existing quest store or RPCs;
- expose Supabase service-role RPCs to the browser;
- add a general retry engine;
- add automatic mutation retries;
- treat HTTP/provider success as TML verification;
- infer authority from a client/UI snapshot;
- bind NPC, economy, item, vehicle, or arbitrary write capabilities;
- change the TML IR v0.1 schema unless implementation proves that a schema change is unavoidable.

## 3. Existing authority boundary

`world.quest.advance` is already declared by `inha.world@0.1`:

- provider binding: `world.quest.store`
- mutates: `true`
- verification predicate: `quest.stage`
- verification authority: `server.quest`

The existing quest store accepts `(userId, event, questId)`.
For Main 2, `status` is the read path and non-`status` events are ordered transition requests.

P5 reuses that contract. It does not create a second quest authority.

## 4. Proposed runtime components

```text
runtime/
├─ quest-read-adapter.mjs        # P3 existing
├─ verification.mjs              # P4 existing
├─ trace.mjs                     # P4 existing
├─ quest-advance-adapter.mjs     # P5 new
├─ verified-write-runtime.mjs    # P5 new
└─ capability-registry.mjs       # extend P3 registry only after gates pass
```

### 4.1 quest-advance-adapter.mjs

Owns only the provider invocation boundary.

Proposed interface:

```js
createTmlQuestAdvanceAdapter({ questStore, now })

advance({
  userId,
  questRef,
  event,
  executionKey
})
```

Responsibilities:

1. validate `userId`, `questRef`, `event`, `executionKey`;
2. call the existing `questStore(userId, event, questId)`;
3. record provider timing and normalized provider outcome;
4. never perform its own retry;
5. never return a TML `SATISFIED`/completion claim.

The adapter may return the provider payload as diagnostic output, but that payload is not authoritative verification evidence until an independent readback is performed.

## 5. Verified write algorithm

### Step A · Resolve and validate

The runtime receives:

- conformance-valid TML Module;
- Profile;
- transition id;
- action id;
- execution context including `userId`;
- read adapter;
- write adapter;
- trace recorder.

Before execution:

1. resolve transition and action;
2. require `action.capability === world.quest.advance`;
3. require the capability to be declared mutating;
4. require Profile verification metadata;
5. require authoritative rule for the verification predicate.

Failure here means **no provider call**.

### Step B · Pre-read

Call `world.quest.read` through the P3 adapter.

Append to Trace:

```text
Observation
Fact
Evidence(precondition)
Verification(precondition)
```

The mutation may proceed only when the precondition result is exactly:

```text
SATISFIED
```

Precondition outcomes:

| Verification | Runtime behavior |
|---|---|
| SATISFIED | continue |
| UNSATISFIED | HOLD_BEFORE_EXECUTION |
| UNKNOWN | HOLD_BEFORE_EXECUTION |
| CONFLICT | HOLD_BEFORE_EXECUTION |

No write is attempted for the last three states.

### Step C · Provider invocation

Generate one runtime execution key for the attempt.

The key identifies the TML attempt and is recorded in Trace. It is **not** claimed to be a server-side idempotency key unless the provider explicitly supports it.

Invoke the existing quest-store event once.

No automatic mutation retry is permitted.

Create one `TmlActionExecution` record describing the provider call.

Semantics remain:

```text
SUCCEEDED = provider returned a valid response
FAILED    = provider invocation did not return a valid success
```

Neither status proves the world state.

### Step D · Mandatory authoritative readback

After the provider call, perform `world.quest.read` again whenever the read path is available.

This readback is mandatory after:

- provider success;
- provider error;
- timeout / transport exception where the request may have reached the server.

This is deliberate: a transport failure does not prove that the mutation failed.

Do **not** immediately retry a timed-out mutation.

### Step E · Postcondition verification

Feed post-read Observations/Facts into P4 `verifyTmlTransition(... phase: 'postcondition')`.

Append:

```text
Observation
Fact
Evidence(postcondition)
Verification(postcondition)
```

Only authoritative `server.quest` Facts may satisfy `quest.stage`.

### Step F · Runtime disposition

The runtime returns a composite result separate from the IR verification status.

Proposed P5 disposition set:

```text
HOLD_BEFORE_EXECUTION
VERIFIED
EXECUTED_UNVERIFIED
VERIFICATION_FAILED
EXECUTION_OUTCOME_UNKNOWN
```

Meaning:

- `HOLD_BEFORE_EXECUTION`: precondition was not safely SATISFIED; provider was not called.
- `VERIFIED`: postcondition is SATISFIED from authoritative readback, regardless of whether the provider response itself was clean.
- `EXECUTED_UNVERIFIED`: provider returned success, but postcondition is UNKNOWN or CONFLICT.
- `VERIFICATION_FAILED`: provider returned success, authoritative readback says the postcondition is UNSATISFIED.
- `EXECUTION_OUTCOME_UNKNOWN`: provider did not return a trustworthy success and authoritative readback cannot establish the postcondition.

A provider error followed by authoritative postcondition SATISFIED is `VERIFIED`, not retried.

## 6. Decision matrix

| Provider result | Readback / postcondition | P5 disposition | Retry automatically? |
|---|---|---|---|
| SUCCEEDED | SATISFIED | VERIFIED | No |
| SUCCEEDED | UNSATISFIED | VERIFICATION_FAILED | No |
| SUCCEEDED | UNKNOWN | EXECUTED_UNVERIFIED | No |
| SUCCEEDED | CONFLICT | EXECUTED_UNVERIFIED | No |
| FAILED / timeout | SATISFIED | VERIFIED | No |
| FAILED / timeout | UNSATISFIED | EXECUTION_OUTCOME_UNKNOWN | No |
| FAILED / timeout | UNKNOWN | EXECUTION_OUTCOME_UNKNOWN | No |
| FAILED / timeout | CONFLICT | EXECUTION_OUTCOME_UNKNOWN | No |

P5 never converts a provider failure plus unchanged observed stage into proof that nothing else changed.

## 7. Trace ordering

Successful verified write:

```text
Observation(pre)
Fact(pre)
Evidence(pre)
Verification(pre = SATISFIED)
ActionExecution(provider)
Observation(post)
Fact(post)
Evidence(post)
Verification(post = SATISFIED)
```

The Trace is then closed.

No synthetic success record is inserted.

## 8. Main 2 first implementation target

Use one middle transition before the completion/reward transition:

```text
transition.inha-world.campus_navigation_intro_v1.4_to_5
event = resume_auto_building5
before = quest.stage 4
after  = quest.stage 5
```

Reason:

- deterministic ordered stage transition;
- no completion reward on this step;
- already covered by current Main 2 contract;
- good first mutation test without coupling P5 validation to reward semantics.

The `8_to_9 / visit_back_gate` completion transition remains a later P5 regression case because it includes the reward path.

## 9. Required tests before binding the write capability

### P5-A · happy path

- pre-read stage 4;
- precondition SATISFIED;
- provider called exactly once with `resume_auto_building5`;
- post-read stage 5;
- postcondition SATISFIED;
- disposition VERIFIED;
- one ActionExecution record.

### P5-B · precondition gate

For UNSATISFIED / UNKNOWN / CONFLICT:

- provider call count = 0;
- disposition HOLD_BEFORE_EXECUTION.

### P5-C · provider success but unchanged state

- provider returns valid response;
- readback still stage 4;
- disposition VERIFICATION_FAILED;
- never report VERIFIED.

### P5-D · provider timeout but state changed

- provider throws timeout/transport error;
- readback stage 5;
- disposition VERIFIED;
- provider is not retried.

### P5-E · provider timeout and unverifiable state

- provider throws;
- readback fails or yields UNKNOWN;
- disposition EXECUTION_OUTCOME_UNKNOWN;
- provider call count = 1.

### P5-F · client fact injection

- client claims stage 5;
- server readback is missing;
- result cannot become VERIFIED.

### P5-G · same-snapshot authority conflict

- authoritative readback contains conflicting latest values;
- result remains EXECUTED_UNVERIFIED / EXECUTION_OUTCOME_UNKNOWN according to provider outcome.

### P5-H · trace contract

Verify exact ordering and ensure:

- no write before precondition SATISFIED;
- no second provider invocation;
- provider SUCCEEDED alone never creates Verification SATISFIED.

## 10. Registry activation gate

Do not replace `READ_ONLY_P3` immediately.

Implementation should introduce a separate constructor first:

```js
createTmlVerifiedWriteCapabilityRegistry(...)
```

The P5 registry may bind:

```text
world.quest.read
world.quest.advance
```

The existing P3 read-only registry remains available during validation.

Only after P5 tests and public CI pass should the general runtime choose the verified-write registry.

## 11. Retry policy

P5 has **no automatic mutation retry**.

A retry may be considered only after:

1. authoritative readback is performed;
2. the prior attempt state is classified;
3. the caller explicitly begins a new attempt under a new execution key;
4. provider/domain idempotency rules permit it.

The current Main 2 stage machine rejects or ignores out-of-order/repeated events, but this domain behavior must not be generalized into a universal TML retry guarantee.

## 12. Completion gate for P5 implementation

P5 implementation is complete only when all are true:

1. `world.quest.advance` uses the existing quest store and no new authority path.
2. Precondition SATISFIED is mandatory before mutation.
3. Provider call is executed at most once per runtime attempt.
4. Authoritative post-read is mandatory whenever readable.
5. Provider success alone cannot produce VERIFIED.
6. Timeout/provider failure cannot trigger automatic mutation retry.
7. P4 Evidence/Verification is used for postcondition judgment.
8. Trace contains pre-read, action, post-read, Evidence and Verification.
9. Main 2 4→5 verified-write test passes.
10. Negative/ambiguous outcome tests pass.
11. `public-ci.sh` passes.
12. `public-db.sh` passes.

## 13. Deferred work

Not part of initial P5 implementation:

- reward verification for Main 2 stage 9;
- wallet/EXP multi-authority verification;
- server-side idempotency-key plumbing;
- generic transaction/rollback semantics;
- parallel writes;
- automatic compensation;
- NPC/economy/vehicle write bindings;
- Gyeol verdict integration.

These should be added only after the single-transition verified-write loop is stable.
