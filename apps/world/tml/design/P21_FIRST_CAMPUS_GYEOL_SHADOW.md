# TML P21 · First Campus Gyeol Shadow Pilot

Status: LIVE QUEST INPUT · GYEOL TEST_MOCK POLICY · ADVISORY ONLY

## Goal

P21 is the first real INHA WORLD quest differential pilot on top of P19/P20.

The live authoritative quest remains `campus_first_walk_v1`. P21 observes only accepted server responses that the existing quest client already consumed.

```text
legacy quest server result
        ↓
TML Fact / Observation
        ↓
claim: quest.stage == 5
        ↓
TML Verification
        ↓
P19 request
        ↓
P20 TEST_MOCK policy
        ↓
Gyeol advisory verdict
        ↓
legacy completion parity
```

## Pilot policy

P21 deliberately defines a narrow, explicit test policy:

- `SATISFIED` completion verification → `VERIFIED`
- `UNSATISFIED` completion verification → `HOLD`
- unresolved verification → `UNKNOWN`

This is **not** a global TML→Gyeol mapping and is not a production Gyeol implementation. It is scoped only to the First Campus completion shadow pilot.

Policy ref:

`gyeol.inha-world.quest-first-campus-shadow@p21`

## Authority boundary

P21 cannot:

- advance or complete a quest;
- grant a reward;
- write Wallet, Inventory or EXP;
- persist a verdict;
- route the player;
- change quest authority;
- block the existing quest client.

The legacy quest server remains authoritative.

## Live wiring

`quest-client.mjs` emits a diagnostic `onServerResult` callback only after a server response has passed the existing quest response validation and account-generation guard.

The NPC runtime feeds that observation into P21 asynchronously. Any P21 failure is swallowed at the diagnostic boundary and cannot block gameplay.

P21 exposes status only through the existing NPC diagnostic snapshot as `tml_first_campus_gyeol_shadow`.

## Completion gate

1. stage < 5 produces TML `UNSATISFIED`, Gyeol `HOLD`, legacy incomplete, MATCH;
2. stage = 5 produces TML `SATISFIED`, Gyeol `VERIFIED`, legacy complete, MATCH;
3. malformed server results cannot become a positive verdict;
4. no network/storage/mutation API exists in the P21 module;
5. quest-client observer failure cannot block quest progress;
6. sign-in/account scope resets only diagnostic latest state;
7. public CI and DB regression gates pass.
