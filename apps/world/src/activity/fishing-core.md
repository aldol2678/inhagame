# Fishing F1 pure resolver

Implementation candidate for the personal P1-A roadmap. Two logical source refs and
one existing carp identity are implemented. Source refs are not world coordinates.
Activity, Discovery and Life Skill registries remain `COMING_SOON`.

`fishing-core.js` has no IO, authentication, randomness generation, persistence,
inventory/XP writes or browser wiring. It is not a playable or Production-enabled feature.

## Server inputs and policy

- Start body: `activityId`, `sourceRef`, `clientAttemptKey` only.
- Input body: `attemptId`, `sourceRef`, `nonce`, `action` (`HOOK` or `CANCEL`) only.
- Actor must come from verified server authentication. Time must be server receipt time.
- Generate attempt ID and nonce with secure UUIDs on the server. Sample `biteRoll`
  in `[0, 1)` once on start. Never accept these authority inputs or a stored attempt from a client.
- Supply all policy fields explicitly: `policyVersion`, `minWaitMs`, `maxWaitMs`,
  `responseWindowMs`, `attemptTtlMs`, `lifeXp`. There are no default balance values.
  Wait is sampled as an integer in the inclusive min/max range. TTL must exceed
  max wait plus the response window. Tests use fixture tuning, not approved game balance.
- Persist the detached policy and timing snapshot. Later policy changes apply only to new attempts.
  Unsupported resolver/schema versions fail closed and need their matching adapter.

## Decisions

The input time window is `[biteAtMs, hookDeadlineMs)`, evaluated at server receipt.
No client timestamp, latency compensation, claimed success, fish, XP or weather is accepted.

| Input on ACTIVE attempt | Terminal result |
|---|---|
| At or after TTL, any action | EXPIRED / ATTEMPT_EXPIRED |
| CANCEL before TTL | CANCELLED / PLAYER_CANCELLED |
| HOOK before bite | FAILED / PREMATURE_HOOK |
| HOOK from bite through deadline minus 1 ms | SUCCEEDED / CAUGHT |
| HOOK at or after deadline, before TTL | FAILED / MISSED_BITE |

Every decision consumes the attempt. Success carries one carp, its discovery identity,
and the snapshotted fishing XP intent. Other terminal outcomes carry `catch: null`.
`resultRef` is derived from the server attempt ID; result identity, actor, source,
time, policy and versions are frozen together. Weather is explicitly `UNKNOWN`.
This does not assert real campus ecology or validate physical proximity/bot absence.
T1 timing with published deadlines is not a bot-prevention mechanism.

## Replay and adapter obligations

`resolveFishingAttempt` validates actor, source, ID and nonce before terminal replay.
The same action returns the stored result even after TTL; a different action conflicts.
A timer-produced EXPIRED result can be read by either valid action. A new request
cannot turn a failed/cancelled/expired attempt into success. `expireFishingAttempt`
is a server-only sweep, and `projectFishingAttempt` requires the verified owning actor.
The projection contains the response nonce/timing; it excludes the private policy.

The adapter must still implement these durable guarantees; pure snapshots alone do not:

1. Gate availability/eligibility, validate source presence as far as T1 permits, and apply
   per-account rate/active-attempt limits before start.
2. Atomically create/reuse the attempt by `(actor, clientAttemptKey)`. Compare source and
   activity on key reuse; return the persisted attempt, never resample it after response loss.
3. Load the complete trusted attempt/policy/result payload, serialize finalize with a DB
   lock or compare-and-set, and persist exactly one terminal outcome before responding.
   Concurrent commands must read the winning row instead of resolving an old ACTIVE copy.
4. Keep the terminal outcome immutable and independent of settlement. `result_ref` alone
   in the existing Activity lifecycle table is insufficient storage for this payload.
5. Compose the existing private Inventory / Discovery / Life Skill cores in the later
   narrow settlement adapter using this result identity. A settlement rollback retries
   the same outcome; it never reruns start/resolution or redraws a species.
6. Expose authenticated owner-only recovery/readback. Do not grant generic XP or item RPCs
   to browser roles, and do not report a pure catch intent as a completed grant.

## Verification

The existing `scripts/public-ci.sh` test glob automatically includes
`apps/world/tests/fishing-core.test.mjs`. Run it with the Activity, catalog,
Discovery, Life Skill and life-foundation tests for the affected contracts.
DB races, authenticated endpoints, settlement, world UI and device latency are F2/F3 work.
