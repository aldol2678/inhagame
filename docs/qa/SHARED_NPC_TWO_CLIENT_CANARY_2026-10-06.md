# Shared NPC Two-Client Canary · 2026-10-06

Status: **CONSUMER-LEVEL TWO-BROWSER CANARY PASS · FULL CAMPUS END-TO-END CANARY BLOCKED IN SANDBOX**

## Scope

Exact tested repository head:

`be8b60c263caed8b7fc3c4b0ca24c99a4fced78c`

The canary intentionally kept Production activation OFF. It started the committed local World dev server with:

`NPC_SHARED_AUTHORITY_P0=1`

and used the real committed:

- `npc-shared-authority-server.mjs`
- `npc-shared-authority-p0.mjs`
- `npc-shared-authority-consumer-p0.mjs`
- `npc-shared-replica-p0.mjs`
- `/api/npc-shared-state`

A temporary, uncommitted sandbox harness imported the real consumer module and created two independent Chrome sessions against the same authority endpoint. The harness itself is not product code and was not committed.

## Environment

- Vercel Sandbox, Seoul region
- 2 vCPU / 4 GiB
- two independent agent-browser Chrome sessions
- authority Place Zone: `AREA_INKYUNG_STUDENT_CENTER`
- pilot NPCs: `INKYUNG-NPC-003`, `INKYUNG-NPC-012`

## Results

### 1. Two clients consume the same authoritative state

Both sessions reported:

- `enabled: true`
- `placeZoneId: AREA_INKYUNG_STUDENT_CENTER`
- both pilot NPC IDs present
- `lastError: null`
- NPC 003 and 012 `ready: true`, `visible: true`

Sequential reads naturally landed on nearby 250 ms revisions while preserving identical world facts.

### 2. Same-revision convergence

Five concurrent forced-sync attempts were made from the two independent browser sessions.

Attempt 4 converged exactly on:

- revision: `96141087`
- authoritativeTimeMs: `1791260871750`

Both clients returned identical shared facts for both pilot NPCs.

NPC 003:

- position: `x=135.57811485298305, z=48.524485871442536`
- heading: `-54.02470186435246`
- activity: `READING`
- moving: `false`
- destination: `c04.inkyung_waterfront.INKYUNG-NPC-003`

NPC 012:

- position: `x=136.73949149179194, z=48.062204244261665`
- heading: `-51.62150036045552`
- activity: `READING`
- moving: `false`
- destination: `c04.inkyung_waterfront.INKYUNG-NPC-012`

**PASS:** two independent browser consumers can observe the same revision and the same NPC shared state.

### 3. Reload / late-join recovery

Session B was navigated away to `about:blank` and then reopened on the authority consumer harness.

After re-entry it independently acquired a fresh current snapshot at revision `96141189`, with both pilot NPCs ready and visible.

The two sessions were then forced to sync concurrently again and both converged on:

- revision: `96141194`
- authoritativeTimeMs: `1791260898500`

with identical NPC 003/012 position, heading, visibility, activity and destination.

**PASS:** a newly created/reloaded consumer does not depend on the previous browser replica and converges to the current authoritative snapshot.

## Full Campus limitation

An attempt was also made to load the exact-head full Campus URL:

`/campus/?npcTest=a-r1&npcAuthority=p0&npcSync=ng2`

in two browser sessions.

Both reached the real Campus UI but remained at the existing World loading state around 98% in this isolated sandbox. The NPC development runtime API was therefore not exposed in time for a renderer-level two-client readback.

This is recorded as:

**BLOCKED in sandbox, not FAIL for Shared NPC Authority.**

The renderer wiring itself was already validated in PR #232 by repository Gates:

- Public local checks PASS
- World stability PASS
- Quest journal PASS
- World asset optimizer PASS
- Student center integrated Campus PASS
- Room transition recovery PASS
- Biryong map/NPC guidance PASS

## Acceptance impact

The following minimum acceptance items now have direct browser evidence:

- two clients observing the same NPC state: **PASS at consumer layer**
- late join / reload snapshot recovery: **PASS at consumer layer**
- same-revision shared fact convergence: **PASS**
- stale/duplicate revision rejection: covered by committed contract tests
- renderer ownership: covered by PR #232 automated Gates

Still pending before Production activation:

1. full Campus end-to-end two-browser renderer observation in an environment where World boot completes;
2. explicit Production activation decision;
3. post-activation rollback/kill-switch observation if Production is ever enabled.

Production environment was not changed by this canary.
