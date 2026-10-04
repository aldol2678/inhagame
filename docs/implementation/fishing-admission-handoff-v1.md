# Fishing admission, exit and client handoff — v1 design contract

Status: selected design for implementation, recorded on the prototype PR. Not a deployed
protocol, Production admission policy or completed movement integration. There is no new
network route, migration, paid infrastructure or browser/main import in this change.

Authority: the current public repository's PlayerController/main, F3 SQL/issuer contract and
isolated position producer prototype. Existing DB Activity → settlement → Inventory/Collection/
Life Skill ownership remains unchanged. This contract narrows the future pond producer; it
does not make the browser-authoritative campus trusted.

## Admission decision

Use one logical **server-controlled pond zone** with the two existing canonical banks.
Do not create separate reward-bearing copies of either bank: F3's one lease per source/account
remains global. Entry does not reserve a bank; competing accounts may enter, but casting still
requires F3 occupancy and range checks. Never infer admission or reward eligibility from the
client's F prompt or Realtime coordinates.

The player explicitly selects transfer into the pond zone. The future UI must disclose:
“낚시 구역으로 이동할까요? 입장하면 서버가 정한 기슭 시작점으로 이동합니다.”
The current near-bank F prompt may remain a presentation entry point. Because campus movement
is not authoritative, that proximity is not a server admission condition. This design permits
explicit transfer without proof of campus arrival; production adoption of that gameplay rule
is a separate exposure decision. Do not label it server-verified travel to the pond.

The request contains only `protocol`, `requestId`, an allowlisted `sourceRef`, `mapVersion`
and a positive safe-integer client `generation` used only to correlate replies.
The selected source is a destination choice, not position evidence. The authenticated transport
derives actor; server ownership supplies admission/session identity, revision and clocks. The
server chooses the actual spawn from the allowlist: six local units outward from the bank,
outside the three-unit fishing radius. Browser spawn/return XYZ, speed, state and timestamps
are refused. Same account/request replays the same admission or its terminal tombstone;
conflicting destination/map reuse fails. Rate/capacity limits bound new admissions. No new fee,
travel XP, admission reward or item consumption is introduced by this contract.

The client generation is not an ownership epoch or DB revision. The authenticated server
echoes it in the response envelope. Admission idempotency fingerprints protocol/destination/map,
not delivery generation: a freshly authenticated status/recovery query may bind the same
durable admission to a new client generation without allocating a new session or resetting
its revision. Retired-channel responses retain their old envelope and cannot cross this bind.

The prototype factory currently chooses a bank through server configuration. Its fixed points
are reused by the executable handoff reference; player destination dispatch, durable admissions
and the server transport are future implementations, not existing prototype capabilities.
The producer prototype itself does not implement OFFERED/READY gating: its test connection
can publish eligible proof immediately. It must be adapted before any live admission.

## Server and client sequence

| Stage | Server obligation | Client obligation |
| --- | --- | --- |
| ENTERING | Verify permanent account, profile eligibility, protocol/map compatibility; acquire durable fenced account ownership before allocation | Advance account/request generation; stop local movement and position-writing features; show transfer pending |
| OFFERED / READY_PENDING | Persist admission/session/spawn, keep evidence INELIGIBLE; return a bound initial snapshot | Check account/request/generation/map/bank/session; load matching geometry, apply root snapshot, clear old inputs; send READY only after exclusive handoff |
| ACTIVE | Accept READY only on its bound authenticated connection; recover Activity state; publish eligible server position and obtain F3 acknowledgement before sending ACTIVE | Unlock direction-command capture after ACTIVE; do not restart local root simulation; casting remains a separate player action |
| EXITING | Stop new movement/start/hook, fence producer work, invalidate evidence and finalize/recover the account's Activity | Freeze root/input, retain identical exitRequestId for retry; show recovery state on unknown response |
| EXITED / LOCAL | Persist terminal receipt after exit postconditions; send fixed return snapshot | Apply return root, clear movement state, retire generation/socket, then release only this feature's ownership locks |
| RECOVERING | Resolve durable admission/exit/Activity status with fresh authentication; no automatic eligibility restoration | Disable direction/start/hook; retain read/cancel/earned settlement recovery; no timer-based local fallback |

Admission IDs and session UUIDs are server-owned. Snapshot sequence, simulation tick and
last accepted input sequence are separate from the DB position revision. The DB revision must
continue across sessions and process ownership changes. The initial reference prototype's
memory Map is insufficient for this protocol.

READY is a client's handoff acknowledgement, not evidence of real-world location or a reward
grant. ACTIVE is emitted by the server only after required server/DB postconditions. A client
boolean such as `proofAck=true`, `ownerFenced=true` or `exited=true` never satisfies those
conditions. The reference reducer assumes an authenticated server channel; it implements
message binding/ordering and cannot authenticate a JSON object on its own.

READY/exit/status carry protocol, the current delivery generation, requestId and the server
admission/session IDs when known; READY also acknowledges mapVersion and exit carries its
stable exitRequestId. Status before the offer is known uses requestId instead. IDs are lookup
and correlation fields only. The server independently verifies account ownership on its bound
authenticated channel; there is no client actor, position, clock, proof or completion flag.

## Exit postconditions and recovery

V1 returns to the fixed staging point for the admitted bank. Do not restore a browser-supplied
pre-entry position. The UI must disclose the same return point before admission. Server-owned
saved campus locations may be added only after the campus has an authoritative source.

Before emitting EXITED, the server must confirm all of:

1. Ownership fencing prevents any old/in-flight worker from publishing newer eligible proof.
   A process-local flag or closed socket does not fence another worker.
2. A newer INELIGIBLE F3 observation is acknowledged, or DB-clock proof establishes that all
   possible previously eligible evidence has passed the five-second TTL. The latter also
   requires a durable bound on the last possible eligible publication, not a browser timer.
3. The active attempt is cancelled/expired through existing Activity commands and its lease
   is released/expired, or it is already terminal. A success that won the HOOK/exit race keeps
   its earned outcome and settlement. Never turn a committed success into cancellation.
4. The durable exit tombstone and canonical return snapshot are saved. An unknown commit is
   recovered by the same account/exitRequestId, not by starting a new exit operation.

Use the existing account Activity lock and F3 transaction contracts for attempt/cancellation
serialization. Starting and exiting need future admission-level serialization as well. F3
alone does not atomically revoke movement ownership. Do not hold DB transactions open while
waiting on network or client READY. No new Inventory, XP, Discovery or direct lease writer is
authorized by this design.

On transport failure, disconnect, scheduler loss, map mismatch, indoor/vehicle/seat/combat
request, tab suspend or authentication change: stop accepting input, request ineligibility and
enter recovery/exit. V1 does not auto-resume an active cast on reconnect; read/cancel its old
attempt, recover earned settlement and complete exit before a new admission. A fresh socket
must not restart its account's DB revision at 1.

If entry response is lost before the client knows admission/session IDs, recover by the bound
account/requestId. Server status must distinguish “no allocation” from an existing durable
admission; silence is not proof of either. Bind the recovered session on a fresh authenticated
channel and finish exit, or confirm no allocation and return to the canonical staging point.
This admission lookup/recovery and the reference reducer's reconstruction are not implemented.
Account switch retires the old generation and disconnects its input capability; new-account
UI/settlement cannot consume old replies. Old evidence still has the documented TTL window
if invalidation is unavailable.

## Client root and visual correction

V1 has **no gameplay position prediction**. It captures finite world-space direction axes
only, transforms keyboard/touch intent using view yaw locally, and sends the existing strict
`{seq, moveX, moveZ}` command shape. Magnitude normalization, time, speed and collision belong
to the server. Emit a stop command on release and modal opening. Automatic walking, jumping,
sprint, mounts, seating, doors/interiors and external teleports are unavailable in the admitted
zone. Presentation yaw/animation cannot authorize movement or eligibility.

Each server snapshot contains the bound protocol/account/request/generation/source/map/
admission/session plus `{snapshotSeq, simulationTick, lastAcceptedInputSeq, x, y, z, mode}`.
Map version is a pinned authoritative geometry build identity; the fixture string is not that
production identity. Reject wrong bindings/nonfinite or out-of-zone coordinates. Ignore
snapshot sequence, tick or accepted-input acknowledgement regression. Acknowledgement means
**accepted direction command**, not client-authored displacement; never replay acknowledged
movement locally. A newer valid snapshot replaces the accepted root position directly.

Optional avatar/mesh smoothing may ease a presentation-only offset for at most 100 ms. It must
not change collision, F3 evidence, distance checks or the root. Snap on entry/exit, session/map
change, large correction or recovery. Camera updates may follow accepted root, and Realtime
pose publication may represent that root; neither becomes an issuer.

The current `setGroundMovementLock` does not stop jump/gravity or all pose writes.
`setInputEnabled(false)` clears keys/touch/assist, but PlayerController's shuttle path runs
before the disabled-input branch. Therefore the future handoff adapter must suspend the local
PlayerController root update entirely and gate every other writer (seat/transport, automatic
movement, doors/space changes, wardrobe/account resets). Reuse named transport/modal locks,
release only owned locks, and preserve unrelated locks. `setLocalPosition` writes from the
accepted snapshot/return are owned by that adapter while admitted. This writer audit is a
required integration test, not something the reference reducer currently enforces.

Panel close does not mean zone exit. Existing panel close currently releases its input lock;
the future zone ownership lock remains independent until EXITED. Panel opening suppresses
direction input by sending stop, while retaining zone authority. “그만두기” remains attempt
CANCEL; “낚시 구역 나가기” is a separate explicit operation. Read and earned settlement stay
recoverable outside the zone, as F3 already permits. Input/auth binding must use current
account generations in the existing Fishing client and prevent late refresh/UI adoption.

## Budgets and acceptance boundary

Proposed v1 budgets: server simulation 50 ms; snapshots every 50–100 ms; direction input TTL
250 ms; producer scheduler gap over 250 ms revokes the prototype connection; F3 observations
every 250 ms; independent client/socket liveness watchdog 500 ms; READY timeout five seconds
aborts admission. These are design limits, not provisioned-runtime measurements. A watchdog
locks client UX and initiates recovery; it does not prove DB invalidation or unlock exit.
Coordinate server/DB clocks and persist outbox/ownership before any live admission.

The executable reference `apps/world/prototypes/fishing-handoff-contract.mjs` and its tests
cover fixed spawn parity with the real producer, READY/ACTIVE gates, account/session/map/
generation isolation, ordering/ack bounds, malformed snapshots, lost connections and matching
exit receipt/return point. They do **not** implement transport authentication, durable fencing,
DB exit atomicity, timeouts, root-writer integration, recovery lookup or visual smoothing.

Production acceptance requires a disposable Production-schema rehearsal plus a simulated
loss/reorder/duplicate transport connected to the actual controller/visual adapter. Exercise
READY loss, admission lookup, input/snapshot loss, unknown observation commit, old worker after
exit, HOOK/exit race, account switch, late replies, live modal locks, pause/disconnect, and
reload before/after tombstone persistence. Verify no double root writer, no refreshed retry
proof, no reward loss/duplication, and no local fallback before resolved server exit.

See [producer prototype](fishing-position-authority-prototype.md),
[F3 contract](../../apps/world/server/fishing-f3.md) and
[Production migration plan](fishing-production-migration-plan.md).
