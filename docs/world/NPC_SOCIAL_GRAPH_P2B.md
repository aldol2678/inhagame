# NPC Population P2-B · Persistent Social Graph

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Status: IMPLEMENTATION CANDIDATE

## Goal

P2-A made 48 fictional NPCs live on the campus schedule. P2-B makes those NPCs retain social context instead of rebuilding every relationship from zero on each page load.

## Contract

- Scope is the existing 48-NPC runtime population. P2-B does not add NPCs.
- This is local simulation state, not an account entitlement, reward, moderation or identity authority.
- Structural relationship seed comes only from fictional runtime data:
  - same department
  - same non-commuter residence
  - shared interests
  - same year level
- Existing authored A-R1 relationships remain valid and stack with structural context.
- P2-B2 enables structural/persistent graph scores as a **ranking signal** for NG1 membership. They never bypass the existing requirement for repeated real encounters.
- Every relationship-ranked formation/join candidate must pass a physical common-route gate under the canonical 90-second regular-meeting budget before membership is accepted.
- The route gate is read-only: it inspects current Purposeful NPC positions and navigation routes but never moves an NPC during candidate evaluation.
- A completed recurring NPC meetup strengthens the relationships among actual attendees.
- Missed/postponed meetups do not reduce affinity. P2-B must not manufacture rivalry or punitive drama.
- Durable meetup bonds are stored locally in the browser under a population+candidate scoped key.
- Storage failure degrades to the current-session graph without blocking World boot.
- The persisted graph contains NPC IDs and simulation counters only. It contains no player/account identifiers.

## Player-facing slice

- NG1 profiles expose a small set of strongest current ties.
- Conversation may mention one sufficiently established simulated relationship.
- The relationship sentence appears only after enough simulated evidence exists: persistent meetup bond, repeated encounters, or high affinity.

## Acceptance

1. All 48 NPCs can participate in the graph.
2. Same-department and same-residence context changes initial affinity deterministically.
3. Completed regular meetup reinforces every attendee pair exactly once per reported outcome.
4. Postponed/failed meetup does not create negative affinity.
5. Durable bonds survive browser reload when local storage is available.
6. Storage corruption/failure never prevents the World from booting.
7. NG1/NG1.5 existing group and physical-meetup behavior remains compatible.
8. Population sources and the reviewed A-R1 candidate/hash are not mutated.


## P2-B2 · Relationship-Routed Groups

- Candidate order: dynamic encounter affinity + bounded persistent/structural relationship preference.
- Eligibility remains encounter-based: relationship metadata alone cannot create a group.
- Formation searches a bounded top-six relationship candidate pool for a route-valid three-person seed, then adds more members only while the entire group remains route-valid.
- Joining an existing group is also route-gated before membership mutates.
- The route validator checks the canonical recurring venue for the interest cluster first, then the existing NG1.5 fallback anchors.
- A candidate containing an off-zone, interrupted, paused, or otherwise unavailable Purposeful NPC is rejected.
- P2-B2 does not enable NG1.5 physical detours in Production; it makes NG1 membership safe for the existing movement topology and future physical-meeting activation.
