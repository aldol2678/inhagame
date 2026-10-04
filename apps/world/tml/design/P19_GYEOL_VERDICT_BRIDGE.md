# TML P19 · Gyeol Verdict Bridge Contract v0.1

Status: SHADOW CONTRACT · NO LIVE GYEOL INVOCATION  
Target: INHA WORLD × TML × 결 엔진(MTE)

## Goal

P19 defines the first code-level boundary between TML and the future Gyeol reference implementation.

It does **not** implement Gyeol reasoning and does **not** invoke a live Gyeol service. It standardizes what TML may send and what a Gyeol verdict must return so a later implementation can be connected without blurring semantic verification and judgment.

```text
TML Observation / Fact
        ↓
TML Evidence
        ↓
TML Verification
        ↓
P19 bridge request
        ↓
future Gyeol adapter
        ↓
Gyeol Verdict
```

Invariant:

```text
TML Verification ≠ Gyeol Verdict
```

## Request contract

`buildTmlGyeolVerdictRequest(...)` accepts:

- one valid TML Verification;
- every Evidence record referenced by that Verification;
- optional read-only context;
- a policy reference;
- an explicit request timestamp.

The resulting request is immutable and always carries:

- `mode: SHADOW_ONLY`;
- `advisoryOnly: true`;
- `runtimeEffect: NONE`;
- `persistenceEffect: NONE`;
- `authorityChangeAllowed: false`.

P19 does not map TML statuses into Gyeol statuses. That mapping belongs to the future Gyeol implementation and policy.

## Verdict contract

A conforming Gyeol response uses one of:

- `VERIFIED`
- `HOLD`
- `REJECTED`
- `UNKNOWN`

It must include at least one reason and may cite only Evidence IDs present in the request.

The response is invalid if it attempts to:

- mutate game state;
- change runtime authority;
- persist a decision;
- request a reward, inventory, wallet, quest or progression write;
- cite evidence not supplied by TML.

## Authority boundary

P19 has no game authority. Existing INHA WORLD authorities remain unchanged.

The bridge is deliberately narrower than P5/P8 execution code:

```text
server/domain authority → TML readback → TML Verification → Gyeol advisory verdict
```

A future Gyeol verdict may inform review, prioritization or a separately governed proposal. It cannot by itself complete a quest, grant a reward, route a player, enable a feature flag, or alter the current authority owner.

## Completion gate

P19 is complete when:

1. request construction rejects malformed Verification/Evidence;
2. every referenced Verification Evidence ID is supplied;
3. response validation accepts exactly the four Gyeol verdict statuses;
4. out-of-scope evidence references are rejected;
5. any runtime/persistence/authority effect is rejected;
6. mutation requests are rejected;
7. no live adapter call is wired into `src/main.js` or `npc-factory/dev-runtime.mjs`;
8. public CI passes.

Live Gyeol invocation is a later phase and requires a separate adapter contract plus replay/conformance evidence.
