# Fishing position authority: isolated input-driven prototype

## Decision and delivery boundary

F3 has a trusted-position **consumer**, not a producer. The present PlayerController owns
the local entity and sends browser poses through Realtime. Population heartbeat is a coarse
player-callable session/zone update. Neither is evidence for F3, even if forwarded through a
service-role credential. The existing `verifyNpcAiUser` verifies a permanent Supabase account;
it establishes identity, not physical location.

This prototype establishes the missing causal chain in a bounded experiment:
authenticated connection → server-owned spawn/state → direction commands → server clock,
collision and ground simulation → immutable observation → existing F3 RPC.

`apps/world/prototypes/fishing-position-authority.mjs` is an in-process experiment. There is
no HTTP/WebSocket entry point, production import, environment setting, migration or browser
integration. It uses an injected RPC sink; unit tests use a recorder and the existing
disposable-loopback DB suite uses the actual service-role F3 function. It adds no reward
writer. Production DB application and player exposure remain separate, unapproved work.

## Concrete protocol

| Boundary | Accepted authority | Rejected client authority |
| --- | --- | --- |
| Connect | Server verifies authorization and binds the returned user to a connection capability | Body user ID, spawn, bank selection, session identity |
| Input | Exactly `{seq, moveX, moveZ}`; safe integer sequence starting at 1; finite axes in [-1,1] | Pose, y, speed, dt, timestamp, space, mode, teleport, jump, mount |
| Simulation | Server scheduler; 50 ms steps, walk speed 7 local units/s, normalized diagonal input | Extra movement from message count or late commands |
| Observation | Server session UUID, account revision, calculated XYZ and server wall timestamp | Reusing Realtime/browser pose as a trusted observation |
| Publication | Existing `world_fishing_observe_position_v1`, immutable single-flight outbox | Refreshing timestamps on transport retry |

The server transport would retain the connection capability and call its `input` method
only for that authenticated socket. `advance`, `flush` and `disconnect` are server control
methods, not player operations. The snapshot provides the resulting position and acknowledged
input sequence for a future client reconciliation protocol; this prototype has no client.

The bank is server configuration. Each canonical north/south bank has a spawn six local units
outward, initially outside F3's three-unit acceptance radius. The experiment permits walking
only inside an eight-unit disk around that bank. It reuses the real CampusCoordinateFrame
shore points, `WORLD_BOUNDS`, `WALK_SHAPE`, swept `moveAroundObstacles`, pond sweep constraint,
ground height and occupancy check. Candidate steps that violate the enclave, water, occupancy
or F3 height envelope are refused. This is not a complete campus simulation: student interiors,
stairs, jump, vehicles, seats, combat and teleport are unsupported. No unsupported player state
is converted into eligible evidence.

## Failure and ownership behavior

- Duplicate input with identical direction does not renew its 250 ms lifetime. A conflicting
  same sequence or a sequence gap is refused; older input is ignored. Inputs received after
  the previous simulation tick cannot authorize retroactive movement. Fractional time is
  retained across ticks; messages themselves buy no elapsed time.
- A scheduler gap greater than 250 ms or a backward/invalid monotonic clock closes the
  connection and publishes `INELIGIBLE` when the issuer can run. It never catches up a long
  pause as movement. Disconnect also closes input and requests an ineligible observation.
- Eligible observations are generated at a nominal 250 ms cadence. Only one pending tuple
  exists. A lost response retries the exact revision, XYZ, session and original timestamp.
  It cannot renew DB freshness. Outages eventually make F3 refuse evidence at its five-second
  TTL. Retained pending data may itself be refused by the DB; production recovery is not
  implemented here. There is no claim of instantaneous revocation during an issuer outage:
  previously accepted proof can remain usable until overwritten or its TTL expires.
- One process permits only one connection per account. Reconnect changes session, continues
  that process's account revision and fences the retired connection. F3 therefore invalidates
  an old session's active hook. A DB `STALE`/unexpected publication status fences the issuer
  instead of overriding another producer.
- Authentication must be renewed/revoked and socket liveness bounded by the future transport.
  A server scheduler heartbeat alone cannot prove a disconnected socket is alive. The module
  has no network transport and delegates disconnect detection to its server caller.

## Production design that remains necessary

These are readiness requirements, not changes delivered by this experiment:

1. **Durable ownership and revision allocation.** A single account writer needs a fenced
   owner/epoch lease, persisted high-water revision and recoverable outbox. The prototype's
   memory Map survives reconnect only within one process. Restart or multiple Vercel workers
   cannot safely initialize it at revision 1 against existing evidence. JavaScript revisions
   stop at the safe integer limit although DB revisions are bigint. Do not deploy this Map
   as a distributed owner. Add an explicitly reviewed service-only allocation/recovery
   contract if needed; do not grant direct access to F3 private tables.
2. **Server session admission and residence.** Decide between a dedicated pond instance with
   explicit server-owned admission/exit, and a wider authoritative campus server. A pond
   instance is the smaller plausible production scope, but still needs an owner-approved
   admission rule and client reconciliation. A browser-provided campus location cannot prove
   arrival. Do not silently reset a live player's position to this test spawn.
3. **Transport and client handoff.** Select a stateful runtime without provisioning one in
   this work. Bound authentication renewal, account ban/revocation, socket timeout, input rate,
   sequence/queue size and resource retention. Bind input to the authenticated connection;
   send authoritative snapshots and reconcile prediction. Client PlayerController must cease
   owning accepted movement while admitted; browser pose broadcasts stay presentation only.
4. **Geometry and state ownership.** Pin and validate the authoritative map/collision version.
   Reject or server-own all eligibility transitions, exits and teleports. Add swept terrain,
   dynamic obstacle and unsupported-state handling if scope grows. Two-bank tests do not prove
   whole-campus parity. Server output and client presentation must use the same local frame.
5. **Clock and publication budget.** Coordinate server and DB clocks; future observations are
   rejected. Measure skew/uncertainty and network/queue latency against the five-second budget.
   On unknown commit, persist and retry the original tuple. Provide a reviewed recovery path
   for expired outbox records and ownership conflicts. The DB integration test samples DB
   time minus 100 ms only as a disposable fixture; it is not a production clock solution.
6. **Rollout rehearsal.** Run the separately documented Production-schema disposable rehearsal,
   including authority restart, concurrent workers, lease recovery, disconnect/reconnect,
   slow publications and client prediction. Apply the closed migration bundle separately,
   then activate only after these readiness gates and policy approval. Keep Production
   `WORLD_FISHING_API_ENABLED` unset during this design/prototype work.

## Verification

- `node --test apps/world/tests/fishing-position-authority.test.mjs`: existing auth adapter,
  forged fields/nonfinite axes, input flooding, speed normalization, sequence/retry/expiry,
  no retroactive movement, both actual banks, water/collider/enclave safety, clock stalls,
  disconnect, immutable single-flight retry, reconnect revision and retired capability fencing.
- `node --test apps/world/tests/*.test.mjs`: existing world behavior plus prototype tests.
- `bash scripts/public-db.sh`: existing isolated loopback fixture includes real input-driven
  prototype → F3 observations → out-of-range spawn refusal → walk into range → cast → walk
  away and reject HOOK without reward → cancel → walk back and catch → exactly-once settlement
  replay → disconnect/ineligible observation. Fixtures restore runtime policy and delete users.

See [F3 contract](../../apps/world/server/fishing-f3.md) and
[Production migration plan](fishing-production-migration-plan.md).
