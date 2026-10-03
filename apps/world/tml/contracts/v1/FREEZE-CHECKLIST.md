# Freeze Checklist

Verdict: **READY_TO_FREEZE** for the specification candidate. No production writer or rollout approval is implied.

| Blocking issue | Normative resolution | Machine artifacts / executable evidence | Status |
|---|---|---|---|
| B1 lifecycle vs knowledge | CONTRACT §5, §12 | core Execution/Knowledge/Locator; X01–X07; A-recovery-C; A-transition-*; A-authority-forbids-* | RESOLVED |
| B2 namespace/alias/transaction identity | CONTRACT §4–6 | Namespace/Scope/Locator; A-identity-*; A-recovery-alias/independent-key/execution-collision; A-transaction-repackaged; A-two-parent-commits-one-execution | RESOLVED |
| B3 complete Claim meaning | CONTRACT §6–7 | ClaimBody schema; S01/S05/S13; F07/F08; A-exact-*/A-at-least-*; A-multistream-projection | RESOLVED |
| B4 admission/closure/profile | CONTRACT §7–8, §10, §13 | closed profile/host-fixture schemas; A-source-names-only; A-source-author-role-only; A-fact-*/A-observation-*; A-extra-unreachable-fact; A-forged/admitted/author-signed-verification | RESOLVED |
| B5 deterministic failures/invariants | CONTRACT §6, §9 | reason registry with layer/substage/order; disjoint LedgerEntry union; L-*; F09/F12; A-stale-and-conflict; A-or-satisfied-conflict-evidence; A-scope-before-hash; A-reward-before-effect-set | RESOLVED |
| B6 normalization/time/number/evolution | CONTRACT §3, §10–11 | core Value/I64/U64/Time/Handle; closed schemas; structural-sets.json; C*/V*/E*; A-set-permutation-01..24; A-time-*; A-number-*; A-bundle-*/A-value-depth-* | RESOLVED |
| B7 executable oracles | CONTRACT §15 | corpus schema + 244 materialized vectors; 252 manifest entries; tools/check_semantics.py + tools/check_oracles.mjs; validation-report.json | RESOLVED |

## Implementation gate

- [x] Task-start latest public main pinned and P10–P15 differences recorded.
- [x] B1–B7 normative changes represented in documents and machine artifacts.
- [x] All 112 prior vector IDs retained with explicit status/reason intent.
- [x] 244 cases pass the small reference harness; all schema documents and corpus envelope validate.
- [x] Every non-null canonical expectation has corresponding manifest content; every manifest entry is independently checked.
- [x] Two independent canonical/digest paths agree; no application/production evaluator generates expected outputs.
- [x] Exactly enumerated set normalizations and numeric/time lossless rules; no implicit core extensions.
- [x] No production, migration, runtime writer, deployment, repository source edit, PR or merge.

PR1 may import these artifacts as a contract/spec/schema/corpus change, with its checks. Follow-up implementation must keep v0.1 behavior separate, bind to actual public/local backend facts, preserve existing recovery during rollback, and pass the normative corpus. No production schema is inferred from the synthetic profile. No source-allowlist-only adapter is acceptable.

Rust/C++/WASM runtime conformance is not claimed: their independent implementation runners are still future implementation work, not a remaining ambiguity in this specification. The reference harness is a bounded specification test aid, not a production-complete evaluator. A future implementation must satisfy the prose/schema invariants beyond sampled vectors as well.
