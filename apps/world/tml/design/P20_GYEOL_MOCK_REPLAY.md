# TML P20 · Gyeol Mock Adapter + Replay Conformance v0.1

Status: MOCK_ONLY · REPLAY VALIDATION · NO LIVE GYEOL INVOCATION  
Dependency: P19 `tml-gyeol-verdict-bridge@p19`

## Goal

P20 proves that the strict P19 boundary can be exercised repeatedly without inventing a production Gyeol implementation.

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

Public metadata is not sufficient to enter the replay harness. Only adapter objects created by `createTmlGyeolMockAdapter(...)` in the current module graph are accepted. A hand-built object that merely claims `mockOnly = true` and `source = TEST_MOCK` is rejected before invocation.

Before caller-supplied `decide(...)` runs, the full request is validated through strict P19 and converted to a deeply frozen validated copy. Malformed or effect-bearing requests therefore never reach mock decision code.

Every generated response is passed back through the strict P19 response validator.

## Replay conformance

`runTmlGyeolReplayConformance(...)`:

1. validates the full strict P19 request before adapter invocation;
2. refuses adapters not created by the P20 mock factory;
3. evaluates the exact same deeply frozen request at least twice;
4. validates each response against strict P19;
5. compares semantic verdict projections;
6. fails if any replay diverges;
7. detects any unexpected request mutation;
8. never performs network, persistence, routing or authority actions itself.

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
3. malformed strict-P19 requests are rejected before `decide()`;
4. invalid P19 response shapes fail;
5. out-of-scope Evidence citations fail through P19;
6. forged/self-branded adapters are refused before invocation;
7. the request given to `decide()` is deeply frozen;
8. no live wiring exists in `src/main.js` or `npc-factory/dev-runtime.mjs`;
9. public CI passes.
