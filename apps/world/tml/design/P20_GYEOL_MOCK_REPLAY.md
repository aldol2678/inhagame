# TML P20 · Gyeol Mock Adapter + Replay Conformance v0.1

Status: MOCK_ONLY · REPLAY VALIDATION · NO LIVE GYEOL INVOCATION  
Dependency: P19 `tml-gyeol-verdict-bridge@p19`

## Goal

P20 proves that the P19 boundary can be exercised repeatedly without inventing a production Gyeol implementation.

The invariant is:

```text
same P19 request
+ same mock decision policy
= same semantic Gyeol verdict
```

Temporal metadata such as `evaluated_at` may differ. The semantic projection must remain identical:

- verdict status;
- ordered reasons;
- evidence IDs used;
- advisory/effect boundary;
- mutation request set.

## Mock adapter

`createTmlGyeolMockAdapter(...)` requires a caller-supplied `decide(request)`.

P20 deliberately ships **no default mapping** from TML Verification to Gyeol Verdict. In particular it does not establish rules such as `SATISFIED → VERIFIED`. Actual Gyeol semantics remain owned by the future Gyeol implementation/policy.

The adapter is accepted only when branded:

```text
mockOnly = true
source   = TEST_MOCK
```

Every generated response is passed back through the P19 response validator.

## Replay conformance

`runTmlGyeolReplayConformance(...)`:

1. refuses live-looking/unbranded adapters before invocation;
2. evaluates the exact same immutable P19 request at least twice;
3. validates each response against P19;
4. compares semantic verdict projections;
5. fails if any replay diverges;
6. fails if the request changes;
7. never performs network, persistence, routing or authority actions.

Result:

```text
PASS | FAIL
```

`PASS` means only deterministic conformance of the test adapter. It does not mean that a verdict is correct, production-ready, authoritative, or eligible for rollout.

## Non-goals

P20 does not:

- implement Gyeol reasoning;
- call a live Gyeol service;
- create a TML→Gyeol status mapping;
- persist verdicts;
- switch quest or reward authority;
- alter gameplay;
- perform mutation retry;
- approve P19/P20 for production.

## Completion gate

P20 is complete when:

1. deterministic mock replay passes;
2. nondeterministic mock verdicts fail;
3. invalid P19 response shapes fail;
4. out-of-scope Evidence citations fail through P19;
5. live/unbranded adapters are refused before invocation;
6. request mutation is detected or prevented;
7. no live wiring exists in `src/main.js` or `npc-factory/dev-runtime.mjs`;
8. public CI passes.
