# TML Evidence / Execution / Settlement Contract v1 — Freeze Candidate

Contract version: **1.0**. Status: specification candidate; no production activation.
Repository authority observed at task start: public `aldol2678/inhagame`, main
`68c76093236e70426a645d4aa5a18b00a4ee1deb` (P15). Previous review: `84448a7285bfda56aa466b5bf6f1ce374a584e14` (P9).
No private repository or inferred production schema is authoritative for this document.

## 1. Normative artifacts and scope

MUST/MUST NOT express requirements. The following artifacts jointly define the contract:

- `schemas/core.schema.json`: records, values, execution request, authority lifecycle, caller knowledge, locators and static templates.
- `schemas/evaluation-bundle.schema.json`: wire evaluation bundle.
- `schemas/profile.schema.json`: closed evaluator profile.
- `schemas/host-fixture.schema.json`: deterministic **test-host** inputs, not a wire trust declaration.
- `schemas/conformance.schema.json`: conformance envelope, distinct from runtime records.
- `structural-sets.json`: exhaustive unordered-collection registry.
- `reason-registry.json`: result reason codes, layers and deterministic selection.
- `conformance-corpus.json`, `canonical-digest-manifest.json`: complete test inputs and authored expectations, canonical byte/hash oracles.

JSON Schema validates shape, not provenance or all semantic invariants. The semantic validation in this document is mandatory in addition to JSON Schema. No field with a critical semantic meaning is implementation-defined. Unknown core fields, unknown versions and unsupported profile revisions MUST be rejected; profile revisions cannot extend core schemas.

v1 covers an atomic command under a **single backend transaction authority**. It does not define distributed transactions, sagas, auto-compensation, a VM, a scheduler, deployment or a cryptographic trust protocol. Backend-specific adapters must prove the defined bindings, not invent missing revisions or ledger links.

## 2. Concepts and ownership

- **Fact:** immutable typed assertion about an entity at a source snapshot, within a Scope.
- **Observation:** immutable trusted-read result, query, snapshot, observation time and Fact references.
- **Claim:** immutable proposition and its explicit evaluation requirements. A Claim is an expectation, never proof.
- **Receipt:** immutable description of an actual committed atomic command and its complete economic effect set.
- **Evidence:** immutable reference closure supplied to evaluate one Claim.
- **VerificationResult:** evaluator output about that exact Claim/Evidence/profile. A serialized result is not self-authenticating.
- **Execution:** mutable authority journal view for one command. Its request binding is immutable; its lifecycle state is not. Execution is deliberately not a member of the immutable runtime Record union and is not content-addressed as a fixed lifecycle object.

TML owns these semantics. The backend owns identity authorization, execution journal, snapshots and transaction truth. UI/shadow metrics do not own any of them.

## 3. Scalars, identifiers and time

### 3.1 IDs and values

Id is 1–128 ASCII characters, first `[A-Za-z0-9]`, remaining `[A-Za-z0-9._:/-]`. Matching consumes the entire string. IDs are case-sensitive; no trim, case fold or Unicode normalization. IDs are not credentials. New opaque IDs are recommended, but global UUID uniqueness is not assumed.

Value is a tagged union: string, boolean, integer, number, null, time, ref, list, object. Null is exactly `{"type":"null"}`. Missing fields and missing Facts are not null. A ref Value contains a domain entity Id, not a content-addressed runtime record Ref. Scope checks precede its equality.

Strings and object keys are Unicode scalar sequences; invalid UTF-8 and unpaired surrogates are rejected. No NFC/NFKC normalization. Equivalent JSON escape spellings decode to the same string; composed and decomposed sequences remain different. Object equality compares key sets and recursively typed values, without key-order dependence. Lists preserve order and length.

Equality compares the complete typed value: integer `"1"` and number `1` differ. `eq/ne` allow all valid Value pairs. Ordering allows only matching integer, number or time tags. Other ordering is INVALID/OPERAND_TYPE. A profile's predicate type applies before primitive comparison, so primitive cross-type equality cannot bypass a predicate declaration.

### 3.2 Exact integers and binary64

I64: canonical decimal string in [-9223372036854775808, 9223372036854775807].
U64: canonical decimal string in [0, 18446744073709551615].
Only `0` or an optional minus followed by a nonzero digit and decimal digits is allowed; U64 has no minus. `+1`, `01`, `-0`, whitespace and exponent notation are forbidden. Range checks use exact integer arithmetic.

I64/U64 MUST NOT pass through JS Number, float intermediates, signed/unsigned coercion or wrapping arithmetic on the semantic, hashing, adapter or FFI path. JS uses BigInt internally; Rust uses checked i64/u64 operations; C++ uses checked int64_t/uint64_t operations. Wire values remain strings. Checked arithmetic overflow is ERROR/INTEGER_OVERFLOW; out-of-range input is INVALID/INTEGER_RANGE. Ledger quantities use positive I64 magnitudes and ADD/REMOVE direction, never binary64. `abs(INT64_MIN)` is not a valid magnitude conversion.

Number is finite IEEE-754 binary64. Decimal numeric tokens decode with round-to-nearest, ties-to-even. Reject overflow/nonfinite values. Reject a nonzero decimal token that decodes to zero **before losing its token**. Negative zero normalizes to positive zero. Integer-valued decoded numbers outside ±(2^53−1) are forbidden. NaN/Infinity tokens are invalid JSON; overflow from a legal numeric token is NONFINITE_NUMBER. Equality is exact decoded binary64 equality; no epsilon. v1 adds no general floating arithmetic. A programmatic adapter that receives an already rounded float cannot claim to have validated the original discarded decimal token.

### 3.3 Time

Canonical wire Time is `YYYY-MM-DDTHH:mm:ss.ffffffZ`, exactly six fractional digits, UTC, Gregorian year 0001–9999, actual valid date, seconds 00–59. Leap seconds are rejected. Offset and shorter/longer fractions are invalid on this wire, even if an adapter can convert them.

Equality is exact microsecond instant equality. Ordering is exact chronological microsecond order. Under this fixed representation, ASCII string comparison is equivalent. JS Date MUST NOT participate in authoritative normalization/equality/hashing. Rust/C++ must retain exact microseconds or exact calendar components; pre-Unix-epoch instants must not underflow an unsigned timestamp representation.

A lossless adapter accepts an explicitly offset timestamp, checks its calendar and offset (00–23 hours, 00–59 minutes), converts to UTC exactly and emits six digits. Fractions shorter than six are right-padded. More than six digits are accepted only if all excess digits are zero. Otherwise INVALID/TIME_PRECISION_UNSUPPORTED; no silent truncate or round. UTC conversion outside the supported year range is TIME_ENCODING. A producer may measure time at microsecond or millisecond resolution, but an adapter may not reconstruct discarded precision. Postgres timestamp text with an explicit offset is converted before any driver JS Date conversion. Offset-free database timestamps require a separately fixed UTC source binding; they are never interpreted using local timezone. Existing admitted bytes are not reformatted during replay.

`observedAt`, `checkedAt` and `committedAt` are timestamps, not causal ordering or proof of commit. SQL `now()` is not advertised as physical commit time. Sources expose receipts only after commit; source revisions establish stream ordering.

## 4. Scope and identity namespaces

Scope requires tenantId, worldId, principal `{kind:account|service,id}`, executionId; sessionId is optional only for session-independent operations. Optional means absent, never null. Present/absent is an exact difference, not a wildcard.

| Field | Lifetime and comparison | Serialization, privacy, cache/replay |
|---|---|---|
| tenant | Tenant incarnation, exact Id; not reused | Opaque Id; top-level isolation namespace |
| world | Persistent authority/data partition, exact Id | Not render area, tab or room; no arbitrary relabeling |
| principal | Account/service incarnation, kind+id exact | No email, nickname or bearer; records remain access controlled |
| execution | One command or isolated read evaluation | Namespace below; never reused for a different request |
| session | Required when command semantics depend on session | Opaque non-bearer Id; historical receipt survives session closure |
| entity | EntityRef type+instance id exact | Fact.subject, Observation.query.subject and request/receipt target; reused spawn requires new instance id |
| source | Logical binding identity, exact Id | No hostname or credential; name alone is not admission |
| snapshot | source+stream+epoch+revision | Exact U64; not fabricated from UI sequence or timestamp |
| observedAt | Observation's actual observation time | Time; cache reuse preserves it and never pretends to be a fresh read |

A single-tenant/world host may use fixed configuration only if its backend binding actually establishes that partition. Account-global economy requires an explicit shared authority partition; this contract does not permit cross-world relabeling.

Normative uniqueness/comparison domains:

1. Execution ID: `(tenant, world, principal.kind, principal.id, executionId)`.
2. Idempotency key: `(tenant, world, principal.kind, principal.id, capability, idempotencyKey)`.
3. Runtime record ID: `(full Scope including session presence/value, recordId)`; unique across immutable record kinds in that Scope.
4. Receipt transaction: `(tenant, world, principal.kind, principal.id, source, transactionId)`.
5. Snapshot revision comparison: `(tenant, world, principal.kind, principal.id, source, stream, epoch)`.

Capability/session MUST NOT hide an execution-ID collision. A transaction identity binds to exactly one full execution Scope, independent of the transaction's Receipt record ID. IDs for transactions cannot be reused within their authority domain, including after restore. A source unable to preserve that identity must use a new source incarnation identity. Different tenants may use the same executionId. Runtime Ref resolution always uses the enclosing Scope and checks both id and digest; it is never a global id-only lookup.

Static precondition Refs are the explicit exception: they address scope-free immutable `tml.claim-template` records inside the pinned profile's preconditions collection. Their digest covers the full template using TML1/record. Templates do not contain runtime Evidence or execution IDs. Runtime records cannot be substituted for templates.

All records in an evaluation have the same Scope and profile pin as the bundle and host's expected Scope. Service-principal world Facts are evaluated separately; no wildcard merge into account Evidence. Cross-Scope policy consumes separate VerificationResults.

## 5. Execution and fingerprint

Authority lifecycle contains only ACCEPTED, EXECUTING, SUCCEEDED, FAILED.

- ACCEPTED: durable immutable request/key/fingerprint registration, no claim of command completion.
- EXECUTING: original execution attempt has begun.
- SUCCEEDED: command committed and immutable durable Receipt reference(s) fixed. Reader availability is irrelevant.
- FAILED: terminal proof that this execution committed no effects; failed/skipped domain entries from a partially committed operation cannot be translated to this state.

Persisted transitions: ACCEPTED→EXECUTING, ACCEPTED→FAILED, EXECUTING→SUCCEEDED, EXECUTING→FAILED. Same-state observations are permitted but cannot alter immutable fields or terminal data. Intermediate observations may be skipped; durable transition rules may not. ACCEPTED has no startedAt; EXECUTING has startedAt; terminal states have completedAt; FAILED requires failureCode and empty receipts; SUCCEEDED has exactly one canonical parent Receipt reference, startedAt, no failureCode. Clock order alone cannot prove these transitions. FAILED after an attempted execution retains startedAt; rejection before dispatch need not have it. Terminal states never regress.

Caller knowledge is separate:

- NOT_STARTED: this local intent has never been submitted. Not returned by an authority lookup.
- KNOWN: a trusted Execution view plus receiptRead = NOT_REQUESTED / AVAILABLE / UNAVAILABLE.
- UNKNOWN: submitted/outcome unresolved; no currently established locator usable for recovery.
- RECOVERABLE: submitted/outcome unresolved with a usable authorized execution or idempotency locator.

Knowledge may retain lastObserved. Known terminal state remains known when a later read fails. `KNOWN + SUCCEEDED + UNAVAILABLE` is valid. Timeout, 404 and response loss cannot produce authority FAILED or local NOT_STARTED.

Fingerprint payload is the normalized Request with exactly idempotencyKey and scope.executionId removed. Include version, profile id+revision, tenant/world/principal/semantic session, capability, target, typed args, static preconditions and expectedReward when present. Transport credentials/timestamps are outside the Request schema, not extra fields that normalization silently drops. Fingerprint is SHA256 under TML1/request. Authority recomputes it from its validated request; client hash is not proof.

Same idempotency identity + same fingerprint returns the original canonical execution, even if a different executionId was proposed. Same key + different fingerprint is IDEMPOTENCY_CONFLICT. Same execution identity + a different immutable request/key is EXECUTION_BINDING_MISMATCH. Different keys with identical fingerprints are independent intents; no automatic fingerprint-only deduplication.

Read-only `lookupExecution(locator, expectedFingerprint)` supports both schema-defined Locator forms. It authenticates the current caller and resolves either execution identity or idempotency identity to the original canonical execution. Neither lookup nor receipt read may insert a journal row, dispatch work, repair via mutation, grant effects or automatically submit. A client that lost an alias response can recover by key. Fingerprint mismatch never changes the stored execution.

Registration, dispatch fencing and atomic domain commit+receipt+terminal linkage must prevent duplicate commits after crash. This is an invariant on the existing backend transaction, not a new distributed protocol. A crashed worker may not be replaced by blindly retrying the mutation. Proving no commit also requires ensuring the previous worker can no longer commit. A never-dispatched original job may get its first dispatch only if durable state proves it has never been attempted; uncertainty is not that proof.

## 6. Receipt and settlement

Receipt contains Scope, source, logical transactionId, requestFingerprint, capability, target, optional reward, committedAt, entries and postState. Reward is required for rewardRequired capabilities and prohibited otherwise. IDs are logical domain IDs, not DB physical transaction IDs or native pointers.

Within v1, an execution has one atomic parent commit and one canonical parent Receipt. The receipt-reference array shape is retained, but an accepted SUCCEEDED journal must reference that one canonical parent Receipt; child ledger transactions are entries, not additional parent commits. Evidence may contain competing candidate receipts to detect authority conflict. Two admitted parent transaction identities for one execution yield CONFLICT/RECEIPT_CONFLICT; evaluators never select the first or latest receipt. Entries are the complete effect set of this atomic command. entryId is unique within Receipt and identifies the grant/effect specification, not array position. Multiple entries may target one resource. requested is positive I64. APPLIED has positive applied I64 and a required actual child transaction; SKIPPED has applied=`0`, a reason, and **no child transaction field**. Negative/zero APPLIED amounts are invalid. Different entries may share a child transaction only if the authority explicitly proves their distinct ledger-entry relations; entryId must still distinguish effects. There are no duplicated wallet/EXP totals to reconcile.

Source authority verifies actual child ledger relations, target, magnitude, outcome, after revision and completeness. A string child ID is not proof. An authenticated provider with known missing child effects cannot admit an atomic Receipt. A temporary inability to establish required relations yields UNKNOWN; known inconsistent relations yield INVALID/RECEIPT_INTEGRITY. Profile-permitted SKIPPED within an atomic commit is not unknown partial commit.

Same transaction identity has an immutable Receipt body/digest and one execution binding. Duplicate identical bytes are harmless retransmission, not a second Record definition in the same bundle. Two admitted different bodies for one transaction are CONFLICT/RECEIPT_CONFLICT, even if their record IDs differ. Replayed transport metadata never changes Receipt bytes. Duplicate record definitions inside one bundle are INVALID/DUPLICATE_RECORD before authority conflict evaluation.

SETTLEMENT requires a trusted immutable execution/request binding. Claim.expectedExecution is compared to that binding and the Receipt; Claim itself supplies no authority. Receipt source/capability/target must match the profile and the execution binding. Expected reward/effects must match the pinned profile's capability+reward rule exactly; a caller cannot weaken that rule by editing Claim. Actual trusted reward ID/version/effects differing from this valid expectation yield UNSATISFIED, not a retroactive mutation retry.

EXACT effect-set comparison is by entryId, including ledger/target/effect/requested/applied/outcome. Extra debit/removal or missing effect yields EFFECT_SET_MISMATCH. Present entries with different values yield EFFECT_MISMATCH. Wrong actual reward version yields REWARD_VERSION_MISMATCH. Semantic mismatch precedence follows the reason registry within stage 5.

Balances are projections. Starting at 100, committed reward +180 and concurrent purchase −50 producing 230 can satisfy settlement. No `preBalance + grant == latestBalance` invariant is used.

## 7. Observation, Evidence and snapshot rules

Fact.source = Fact.snapshot.source = associated Observation.source = Observation.snapshot.source. Scope and complete SnapshotRef also match. Fact.subject/predicate is within Observation.query. Each Fact names its observationId; Observation.facts includes that exact Fact Ref. Both directions are checked. Fact alone is not authoritative. Observation's snapshot binding must actually cover its query; a provider cannot assign one revision to independently read incoherent values.

EvaluationBundle contains version, Scope, profile, root Claim/Evidence Refs and fully materialized records. No arbitrary payloads or host credentials. Every supplied Record must be reachable from roots through declared references (including Fact→Observation ID). Evidence's actual input is exactly this reference closure; neither hidden facts nor unreferenced records may influence evaluation. Expected referenced records may be unavailable; valid unresolved refs yield UNKNOWN. Malformed refs, wrong kinds, hash/Scope/profile mismatch and broken resolved links yield INVALID. Missing root Claim/Evidence yields UNKNOWN/CLAIM_MISSING or EVIDENCE_MISSING. Runtime Ref kind is determined by its containing field; an ID resolving to a different kind is REFERENCE_MISMATCH.

STATE's frame contains zero snapshots when there are no observations, otherwise exactly one SnapshotRef shared by all its Facts/Observations. Multiple source/stream/epoch/revision tuples in one STATE frame are INVALID/SNAPSHOT_MISMATCH; not CONFLICT. Frame snapshots equal the distinct snapshots of included Facts/Observations. A STATE claim cannot smuggle a transaction Receipt in place of a state Fact.

Every STATE has snapshotRequirement:

- EXACT: required tuple must equal observed tuple. Historical replay uses EXACT.
- AT_LEAST: same comparison domain and observed revision ≥ required revision.

Different source/stream/epoch is incomparable, not numerically newer. A valid single-snapshot observation that cannot meet the Claim's comparison domain yields UNKNOWN/SNAPSHOT_INCOMPARABLE. Same domain but wrong EXACT revision or insufficient AT_LEAST revision yields UNKNOWN/STALE_SNAPSHOT. There is no permanent CURRENT mode. A new freshness criterion is a new immutable Claim; product policy must approve that criterion, not blindly trust a caller-selected low minimum.

Revision is U64 and strictly monotonic when state changes within its domain; repeated reads of unchanged state may reuse a revision. Epoch changes on a reset/restore breaking continuity. Epoch IDs are opaque, never ordered or reused for reset incarnations. Before overflow a source must stop advancing that epoch and explicitly create a new epoch. No wrap, guessed revision bridge or old/new epoch numerical comparison. Sources without durable revisions remain legacy until a real binding exists.

For PROJECTION_APPLIED, Claim.receipt must resolve to the admitted Receipt in Evidence; entryIds is a nonempty subset of its entries. Each selected entry needs a trusted projection for its target/source/stream, same epoch, revision ≥ entry.after, and a profile stream rule `includesPriorEffects=true`. This promises that all committed effects through that revision are included, not just that a counter is large. Missing proof is UNKNOWN. Different epoch is SNAPSHOT_INCOMPARABLE. For SKIPPED, the check proves visibility of the checked state, not a nonexistent child transaction. Newer balances may differ because of other commands. Multiple streams are checked separately; success asserts no common atomic STATE cut. Actual commit-state Facts, if supplied through Receipt.postState, must carry their own valid Observation closure.

Multi-stream STATE is unsupported. Separate Claim/VerificationResult pairs may be combined by policy without claiming simultaneity. PRE and POST are separate Evidence; PRE does not lock the backend. Mutation authority rechecks required conditions or CAS at commit time.

Caches include full Scope, profile pin and source/stream/epoch/revision. Different execution means new trusted observation binding; no raw Evidence reassignment. A cached read retains original observedAt and snapshot. Session expiry does not mutate historical receipts; recovery uses their original Scope with current authorization checked separately.

## 8. Admission and trust transfer

The trust chain is one-way:

Authenticated provider → current authorization for tenant/world/principal/capability → actual execution/snapshot/ledger binding → immutable record bytes → digest-specific host admission → Evidence → evaluator → VerificationResult → authorized consumer.

Admission binds record id+digest, full Scope, source identity and role, and an execution/request/transaction or snapshot binding. The host side table is not accepted from submitted runtime JSON. A source allowlist is necessary policy, never sufficient evidence. Changing bytes and recalculating a digest requires new admission. Hash provides integrity; it provides neither authenticity, authorization, freshness, confidentiality nor semantic validity.

A snapshot reader role must be allowed both by source roles and the predicate's allowed sources, with matching stream/target binding. A transaction authority must be the capability's declared source; admission covers complete child relations. A serialized VerificationResult requires trusted evaluator provenance, exact Claim/Evidence refs and authorized consumption, or re-evaluation with newly admitted evidence. These properties cannot substitute for each other.

Missing valid admission produces UNKNOWN/UNTRUSTED_PROVENANCE for the atomic claim needing that input. An otherwise authoritative contradiction requires two admitted values; attacker bytes cannot create an authoritative conflict. Known binding mismatch is INVALID. Additional untrusted values do not override admitted facts, but malformed/Scope-invalid input anywhere in the bundle is still a validation failure.

Host fixture is a deterministic test specification of these external bindings. Supplying its JSON to a runtime does not grant trust. Admissions are immutable during one evaluation. Production hosts obtain equivalent bindings through authenticated readers and authorized journal/ledger relationships. No new signature protocol is required. Remote process consumption must re-admit or use an already trusted transport/binding; a digest or field named `trusted` is not trust transfer.

## 9. Validation, evaluation and reasons

Execute these stages in order:

1. Wire/schema/type/Scope/reference validation.
2. Host admission and execution/snapshot binding validation.
3. Authoritative identity conflict detection.
4. Snapshot requirements and evidence sufficiency.
5. Atomic Claim semantic evaluation.
6. P4 logical composition.

Stages 1–2 collect deterministic validation failures before any semantic truth result. A detected INVALID prevents semantic evaluation. An internal failure preventing completion of validation is ERROR/INTERNAL_ERROR, not evidence of invalid input. A later semantic fault cannot mask an already returned validation failure. A semantic evaluator failure is ERROR; no logical short circuit may hide it.

Within a stage, obey the registry's substage, then result priority (INVALID before unknown markers), then ASCII reason code, then canonical record-id/JSON-Pointer path. This order is independent of network arrival, map iteration and record-array input order. Stop before dependent substages when prerequisite decoding/schema validation failed. Canonical diagnostic paths use record id instead of incoming record index. A known read failure for a required Ref uses READ_UNAVAILABLE instead of the generic missing-record reason; an unrelated read failure does not affect the atom. Missing-admission/sufficiency markers remain local to the affected atomic expression, not global failures.

For each atomic STATE expression, two different admitted typed values at the same subject/predicate/snapshot yield CONFLICT before freshness checks. Contradictions on unrelated predicates do not force unrelated atoms to conflict. Insufficient valid input is UNKNOWN. A sufficient value that falsifies the predicate is UNSATISFIED. Fact absence alone is UNKNOWN; a Fact with null value still satisfies exists. Explicit true is allowed only as the entire expression of a static precondition template, never as a STATE Claim shortcut.

P4 composition is unchanged:

- AND: CONFLICT > UNSATISFIED > UNKNOWN > SATISFIED.
- OR: SATISFIED > CONFLICT > UNKNOWN > UNSATISFIED.
- NOT swaps SATISFIED/UNSATISFIED; UNKNOWN/CONFLICT and their reason are preserved.
- Empty AND/OR is invalid. Full input validation precedes composition.

Thus OR(SATISFIED, CONFLICT) = SATISFIED; atomic conflict precedence over freshness does not change this. AND/OR emits `AND_<status>`/`OR_<status>`; NOT emits `NOT_<new status>` only when inverted. Comparison emits AUTHORITATIVE_COMPARISON for either truth value.

When independent projection entries or settlement checks produce different semantic outcomes, collect them and choose the earliest applicable registry substage/reason. The table distinguishes bad contract input (INVALID), missing proof (UNKNOWN), admitted contradictory authority (CONFLICT), proven mismatch (UNSATISFIED), internal failure (ERROR), and satisfied claim (SATISFIED).

## 10. Closed profile and normalization

Profile envelope is `{schema,version,id,revision,definition}`. Revision equals TML1/profile digest of the entire envelope with **only revision removed**. No self-hash cycle. Definition contains only source roles, predicate top-level Value types/allowed sources, capabilities, exact reward/effect rules, scope-free static precondition templates and source/stream projection rules. Profile schema rejects all other fields. Lists/objects use core recursive Value rules; this minimal profile does not add per-key type grammars.

Source IDs, predicate IDs, capability IDs and template IDs are unique in their collections. Reward bindings are unique by capability+reward.id+reward.version; streams by source+stream. References to source/capability/template must resolve within the profile. Capability source must have TRANSACTION_AUTHORITY role; predicate sources must have SNAPSHOT_READER role. Expected reward rules use the exact effect set and capability-allowed outcomes. A profile's revision is pinned by host policy; caller-authored profile cannot authorize itself. Profiles add no new core wire fields, statuses, operators or canonical rules.

Raw decoding first validates UTF-8, then the complete JSON grammar, then duplicate decoded keys, then Unicode scalar validity, then binary64 token conversion, before schema-dependent checks. A failed prerequisite stops later dependent checks. TML validation handles raw duplicate decoded keys, Unicode, integer/time/number restrictions, closed schemas, optional-field null rejection, set duplicate validation and normalization. JCS only encodes a valid normalized JSON value. Standard JSON.parse followed by duplicate-key validation is insufficient.

`structural-sets.json` exhaustively lists unordered paths, including Receipt entries/postState, Claim expectedEffects/projection entryIds, Evidence references/frame snapshots, Observation facts/query predicates, request/static preconditions, Execution receipts, bundle records and every profile set. ASCII tuple comparison applies to IDs/enums; U64 tuple components compare numerically. Duplicate keys are rejected, not silently coalesced. Equal id with different digest is still a duplicate in a Ref set. Identical duplicate snapshot tuples are rejected. Wildcards apply only to the declared profile paths. All unlisted arrays, especially TypedValue list and Expr.args, preserve order. Arbitrary object properties are not discarded.

Canonical bytes = UTF8(RFC8785_JCS(normalized value)), no BOM, trailing newline or locale-sensitive output. Object keys sort by UTF-16 code units, not Unicode codepoints. Non-BMP/private-use key order has an explicit vector. All Unicode is preserved without normalization. Optional null does not canonicalize to absence. No undefined, class instance, Date, Map, function, cycle or raw JS BigInt crosses the DTO boundary.

Digest = `sha256:` + lowercase hex SHA256(UTF8(domain + LF) || canonical bytes).
Domains are exactly TML1/record, TML1/request, TML1/profile, TML1/vector. Runtime record digest covers the entire immutable Record, including id/version/profile/Scope. TML1/vector is a test-only domain for non-record fixture payloads; no production authority derives from it. Fingerprint uses its defined projection, not the whole request. No object contains its own runtime digest.

Changing core shape, semantic normalization, ordering, numeric/time meaning or required-field interpretation requires a new contract version. Profile revision cannot legalize unknown core fields. Existing version-1.0 bytes/hashes are replayed using version-1.0 rules forever; readers must not re-hash old records using a future schema.

## 11. Limits, wire handling and deterministic host calls

An evaluation bundle wire frame is at most 1,048,576 UTF-8 bytes, including whitespace. Its records array has at most 4096 entries, including root Claim/Evidence. Each TypedValue or Expr tree has maximum depth 32 with its root at 0 and each nested Value/Expr child adding 1. JSON wrappers/properties are not semantic depth increments. Limits are checked before costly processing; violations yield LIMIT_EXCEEDED. Other transport limits are operational refusal, not a different TML semantic result. Untrusted framing cannot bypass the byte limit by parsing first. BOM is not accepted as part of JSON input.

A submitted bundle contains the chosen immutable inputs. Evaluation does not perform nondeterministic network I/O halfway through an expression. The host resolves/admit inputs and records any unavailable references before evaluation; a new read produces a new Evidence/evaluation. Network delay is UNKNOWN/READ_UNAVAILABLE, not a Fact. Host fault injection in corpus is explicitly tied to a numbered stage, not a real timer. checkedAt is supplied by the host in exact Time format; runtime wall-clock variations are not compared as truth.

## 12. Recovery and retention

Mutation automatic retry is forbidden. Read-only lookup/readback may retry with backoff; exact scheduling does not change contract meaning. Re-evaluating identical immutable inputs is not retrying a mutation. A new explicit business intent requires a separate authorized decision; UNKNOWN is not permission for it to impersonate a retry of the old command.

| Case | Authority and knowledge | Required behavior |
|---|---|---|
| A: commit, lost response, deployment rollback, legacy reconnect | Durable SUCCEEDED; caller may be RECOVERABLE | Preserve key/alias/receipt binding and lookup. Legacy writer must retain domain duplicate prevention or reject affected intents. Never replay uncertain v1 work through old writer. |
| B: ACCEPTED, crash, outcome unclear | Journal observation does not prove no effects | No mutation replay. Inspect authorized journal/ledger; fence prior worker before declaring no-commit terminal failure. Retain unresolved execution. |
| C: SUCCEEDED, receipt reader unavailable | KNOWN/SUCCEEDED/UNAVAILABLE | Keep terminal state. Retry reads. Receipt and immutable reference remain durable. |
| D: retention expires, old retry | UNKNOWN/RETENTION_EXPIRED | Retained tombstone or permanently rejected namespace prevents new effects. Expiry is not fresh intent. |
| E: version retired, recovery outstanding | Stop new acceptance, retain old recovery | Preserve old reader/schema/profile interpretation and key/receipt access; retire new writer independently. |

Unresolved journals cannot be removed by TTL. Terminal full Receipt retention may follow an explicitly declared service retention policy; after removal, verification may be UNKNOWN. Duplicate-prevention key/execution/transaction tombstones survive independently until the entire corresponding namespace is permanently rejected. No silent namespace reuse. Restoring a database must preserve these protections or keep writes disabled. Receipt archives must preserve original bytes/digests, not rewrite them under the newest profile. Contract retirement cannot revoke recovery merely because new writer support ended.

Read authorization is rechecked with current credentials, while original session-bound Scope remains unchanged. External API errors may conceal another account's execution existence. Internal SCOPE_MISMATCH is not permission to leak its contents.

## 13. Gyeol, WorldForge and FFI

Gyeol consumes Claim + admitted VerificationResult + Evidence refs. GyeolDecision contains policy id+immutable revision, consumed VerificationResult Ref and a policy-owned decision. It does not overwrite TML status, mint Fact/Receipt, move wallets, define reward truth or reinterpret historical evidence as current. A conformant TML evaluator embedded in Gyeol may re-evaluate under this same contract; a distinct policy decision remains separate.

WorldForge emits authoring documents, behavior/capability declarations and static validation artifacts. Valid schema, digest, author signature and static success do not grant runtime-observer or transaction-authority role. Host separately authorizes any runtime binding. Static validation does not instantiate authoritative runtime Facts or SATISFIED VerificationResults. Artifact authorship is not proof of execution.

JS/TS, Rust, C++ and WASM exchange copied UTF-8 bytes or validated DTOs. Stable host handle `{id: Id,generation: U64}` (core Handle schema) is scoped to owner/lifetime/Scope and checked at every use; released/mismatched generation or cross-Scope handle is INVALID. Generation never wraps; exhaustion requires a new handle Id. Native pointer and persistent WASM memory offset are forbidden as contract identity. A transient offset may identify a call-local buffer only. Host callbacks independently authorize capabilities; the existence of a handle is not authorization.

## 14. Current main, compatibility and non-activation

P3–P9 behavior remains legacy. v1 uses separate schemas/entry points; it does not silently change v0.1 string ordering, numeric coercion or P7/P9 delta diagnostics. Old traces missing Scope/provenance cannot be promoted by inventing fields. Lossless safe-integer legacy values may be adapted; lost precision cannot be reconstructed. Revision-less reads remain legacy.

P10–P15 on the new baseline add memory-only parity metrics/account pending-state reset, advisory readiness, human review packet, human attestation, non-executable promotion proposal, and synthetic canary dry-run. Their statuses, caller reviewerRef and fingerprints are not v1 execution/transaction admission. No human approval is fabricated. Existing `authorityChangeAllowed:false`/legacy-main2 boundaries remain. v1 freeze does not approve a rollout or activate a writer.

The first implementation can remain a single atomic Main 2 completion adapter using existing public journal/ledger information where actually available. No repository split, production migration or rewrite follows from this artifact. Subsequent PRs can implement strict decode/evaluator, host adapters, local journal/readback and multi-runtime conformance independently.

## 15. Corpus execution and oracle provenance

All previous 112 IDs are preserved; additional critical cases are explicit. Each vector has layer, input wire bytes or fully materialized structured input, optional deterministic hostFixture, and expected normalized/canonical/digest/result/reason/effects. Test envelope null is explicitly allowed and is unrelated to runtime optional-field null rejection.

Layer operations:

- value: strict raw decode + Value validation/normalization.
- comparison: validate typed left/right, apply op; no profile bypass in full evaluation.
- logic: combine supplied status/reason children using P4 tables.
- evaluation: validate the supplied complete bundle with hostFixture and return status/reason.
- execution: deterministic virtual store operation LOOKUP/SUBMIT/LEGACY_RECONNECT/RETIRE; never actual backend mutation. SUBMIT to a fresh key only registers ACCEPTED, no dispatch; existing keys return canonical journal. Transport fields control read availability. Legacy reconnect/retire asserts writer closed and recovery retained. Expected newMutationCalls is zero.
- transition: validate complete before/after Execution views and legal state transition/proofs, with no actual writer.
- fingerprint: project request, exclude separate transport, normalize and hash under TML1/request; effects.equalsBaseline compares with A-fingerprint-baseline.
- identity: construct the named namespace tuple from the fully supplied left/right objects and compare it.
- schema: validate the named core definition plus mandatory scalar semantic checks.
- normalization: isolated structural-set transformation on the complete supplied JSON value/kind; this component test does not run record schema, lifecycle, profile-digest or admission validation. Its VALID/NORMALIZED result is not a declaration that the input is a valid runtime Record. Production canonical admission still validates the complete Record first.
- arithmetic: exact checked I64 add/sub helper, not a new language operator.
- time-adapter: exact explicit-offset conversion defined above.
- bridge: supplied handle table, Scope, generation and released flag; no native pointers.
- consumption: supplied serialized VerificationResult requires an exact evaluator-role admission; successful consumption returns VALID/VERIFICATION_ADMITTED without changing its TML verdict. Missing admission, including author-role-only signing, means UNKNOWN/UNTRUSTED_PROVENANCE.
- limits: raw input tests exact byte limit; structured bundle tests records count independently; structured `{value}` tests semantic depth independently. This layer intentionally isolates each limit and does not claim a 4096-record fixture also fits the byte limit or reference closure.

For rejection before a normalized value is produced, expected normalized/canonical/digest are null. Count-only limit tests have null normalization because that operation does not encode a bundle. For other valid outputs, normalized value and canonical bytes are provided. Expected effects are assertions, never hidden inside input. No runner synthesizes records from notes or patches.

`tools/build.py` is an artifact generator with authored semantic expected results; it imports no application evaluator. Python rfc8785 0.1.4 produces the first canonical oracle. `tools/check_oracles.mjs` independently implements normalized-set ordering and ECMAScript JCS serialization/SHA256 and checks all applicable inputs plus every manifest entry. `tools/check_semantics.py` is a small reference test harness and schema checker, not a production runtime or evidence of Rust/C++/WASM conformance. Its passing corpus is necessary evidence about the candidate, not proof of arbitrary implementation correctness. Independent implementations must match the corpus and all normative prose/schema invariants, including cases beyond the sample corpus.
