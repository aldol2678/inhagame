# Fishing Production forward-migration plan

Status: **reviewable plan; not applied**. Player exposure remains HOLD.
Repository starting point: merged PR #182, `4a6bb098ae68d300bcbf9ec403b30b4ae197c863`.
Implementation reconciled with main after #184, `0fe95f09fe3e5f1a0f02851a95338e095483bf4f`.
Target identified from the deployed public config: GAMES `oosshdsthgpqabjmbkjo`.
Production reads were taken during the 2026-10-04 UTC / 2026-10-05 KST continuation.

## Reconciled Production state

Production has independently named/numbered migrations. Its latest observed entry is
`20261004040957 world_biryong_npc_relationship_p0_private_seed`. It is not the public baseline
history. A Vercel Git deploy and public disposable-DB CI do not apply Production SQL.

| Component | Production readback | Required forward change |
|---|---|---|
| `life.fishing`, `collection.fish.carp` | both `COMING_SOON` | separate activation after readiness review |
| `life.common.v1` | Lv1 only; no skill-curve `cumulative_sp` column | Lv1–20 and per-skill SP pool |
| Aggregate Life curve | `min_total_skill_xp`, `cumulative_sp` columns exist | remain display-only, SP stays zero |
| Shared Activity settlement | absent | append-only settlement receipt and domain orchestration |
| Fishing runtime/snapshots | absent | F2 owner-only server lifecycle |
| SP spend / acquired nodes / tree definitions | all zero rows | compatible empty-state precondition for pool/rank migration |
| Tree/reset schema | no pool/rank/epoch or reset table | ranks, nodes and free per-skill reset |
| Life Skill Book RPC | absent | self-only book/tree reads and actions |
| F3 trusted positions / leases | absent | required-by-default position consumer and atomic occupancy |
| Authoritative world position producer | not connected | separate integration before exposing Fishing |
| Production HTTP flag | `WORLD_FISHING_API_ENABLED` absent; endpoint 404 | remain OFF through this work |

Ten existing private function bodies were fetched from Production and compared to repository
definitions after removing line comments and normalizing whitespace. All matched their named
public foundation: Activity account/start/finalize (`20261002132000`), Inventory grant
(`20261002131000`), Collection discover (`20261002134000`), Life account/snapshot/XP apply
(`20261002135000`) and Life → Creature start/finalize (`20261004102000`). This is evidence for
those dependencies, not a claim that every Production function/constraint is identical.

[`fishing-production-preflight.sql`](fishing-production-preflight.sql) is read-only and repeats
the history, empty-state, columns, function signatures, raw body hashes and ACL checks. Re-run it
against the identified target immediately before preparing the final application. Drift,
nonempty SP/node state, unexpected published nodes, partially installed components or changed
function/column contracts require reconciliation; do not bypass the migration's guards.

## Forward payload and dependency order

Use only the listed repository payloads. Do not replay any public baseline migration or infer
installation from a version-number comparison. Do not run an indiscriminate `db push` against
this Production project. Main3 and live collection-item migrations are outside this Fishing
bundle. Record a new approved Production forward-migration name/history entry and the exact
source commit plus payload checksums; do not fabricate public baseline history rows.

### A. Foundation, with Fishing still closed

| Order | Repository migration payload | Purpose |
|---|---|---|
| 1 | `20261004130000_world_life_skill_curve_v1_sp_pools.sql` | skill curve, per-skill SP; requires empty spend ledger |
| 2 | `20261004131000_world_activity_settlement_p0.sql` | shared transactional settlement |
| 3 | `20261004132000_world_fishing_f2.sql` | disabled Fishing runtime, frozen attempts and RPCs |
| 4 | `20261004133000_world_creature_ledger_account_delete.sql` | account deletion after Fishing's Creature context |
| 5 | `20261004134000_world_account_delete_append_only_cascade.sql` | remaining account-deletion ledger triggers |
| 6 | `20261004135000_world_life_skill_tree_ranks.sql` | rank model; requires empty acquired/spend state |
| 7 | `20261004136000_world_life_skill_tree_nodes_v1.sql` | 18 still-hidden node definitions |
| 8 | `20261004137000_world_life_skill_tree_reset.sql` | per-skill epoch/reset ledger |
| 9 | `20261004138000_world_life_skill_book_p0.sql` | self-only Book/tree adapters |
| 10 | `20261005021000_world_fishing_f3_trusted_presence.sql` | trusted evidence consumer; default gate ON |

Rehearse this exact forward bundle on a disposable copy of the approved Production schema,
including its current functions/triggers/grants, before application. The full public replay CI
proves repository consistency; it does not replace a Production-schema rehearsal. No Production
copy or DDL has been created/applied by this task. Apply the foundation as one transactional
forward migration after explicit approval, so a failure leaves neither a partial tree schema
nor a partially replaced resolver. These payloads contain no concurrent index operations.

### B. Activation and exposure, separately held

`20261004161000_world_fishing_first_life_skill.sql` is the separate activation payload. It changes
the catalogs to ACTIVE and installs candidate timing (3–9 s, 1.5 s response, 30 s TTL, 20 XP,
2 s between casts). Owner acceptance of this policy and activation is still required. Activate
only after the foundation postconditions and trusted producer readiness are verified; keep the
HTTP flag OFF until the full player path passes its production-readiness review.

The runtime must retain `presence_required=true`. Do not turn it off to work around an absent
producer. A trusted credential proxy for browser-provided poses would not meet F3.

## Application postconditions

Read back the actual DB, not only the migration-history row:

- Skill curve has levels 1–20, level 2 XP=100/SP=1, level 20 XP=19000/SP=23; aggregate curve SP=0.
- Foundation leaves fishing/carp `COMING_SOON` and runtime disabled with no policy/cooldown;
  all 18 tree nodes and the Fishing Creature bridge stay `COMING_SOON`.
- Required settlement/F2/tree/reset/Book/F3 relations and exact RPC signatures exist. Compile
  current PL/pgSQL against the schema and verify primitive caller/writer guards on rehearsal.
- F3 spot coordinates match the current canonical world, `presence_required=true`, and no leases
  or position observations are fabricated by the migration. All F3 relations have RLS and no
  direct table grants to anon/authenticated/service roles.
- Fishing lifecycle and observer EXECUTE belong only to service_role, with server-claim/account
  guards. Book actions belong to the existing self-only permanent account contract. Internal
  helpers are not executable by player/service roles.
- After the separately approved activation, re-read ACTIVE catalogs, runtime candidate policy
  and cooldown; hidden nodes/bridge remain unchanged. A new cast with no trusted observation
  must fail without attempt/reward creation.
- A trusted producer must pass issuance, freshness, finite coordinate, monotonic revision,
  session ownership and ineligible-state tests. Then exercise both banks, simultaneous users,
  cancellation/recovery and exactly-one carp/Discovery/XP/receipt on a controlled test account.

Keep source revision, checksums, rehearsal output and before/after readback with the application
record. The existing 404 HTTP gate is a deploy boundary, not proof of installed DB readiness.

## Recovery

Keep the HTTP flag OFF on any discrepancy. Before commit, transaction failure rolls back the
entire forward bundle. After commit, use a reviewed forward fix; never delete settlement/XP/SP
ledgers, drop state tables or rewrite migration history to simulate rollback. Runtime/catalog
deactivation blocks new play but must preserve terminal replay, reads and earned settlement.
Do not change `presence_required` while attempts are active. This plan performs no Production
write, environment change, activation or player exposure.
