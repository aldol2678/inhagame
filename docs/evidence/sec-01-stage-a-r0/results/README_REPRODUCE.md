# SEC-01 Stage A — reproduction (isolated lab only)

These scripts run **only against a disposable local Supabase stack** on `127.0.0.1`. They refuse any
non-local target (`lib.mjs` guards `API_URL`/`DB_URL`). They never touch Production, and the chat
feature flags stay `false` in the real migrations — the lab RPCs live in a separate `sec01_lab`
schema / `public.sec01_*` functions created by `sql/10_sec01_campus_chat_lab.sql`, which is **not a
migration** and is never added to `supabase/migrations/`.

## Prerequisites
- Docker running (`dockerd`), ~6 GB free disk for images.
- Node 22, `psql` client, `npx supabase` CLI (v2.120.0 used).

## 1. Base the lab on current main + PR #353
```bash
# fresh worktree at current origin/main, then overlay PR #353's three new migrations only
git fetch origin main && git fetch origin pull/353/head:pr353
WT=$(mktemp -d); git worktree add -f "$WT" origin/main
for f in 20261012023000_world_club_room_multiplayer \
         20261012023100_world_room_chat_candidate \
         20261012025000_world_room_h3_authority_retention_candidate; do
  git show pr353:supabase/migrations/$f.sql > "$WT/supabase/migrations/$f.sql"
done
```

## 2. Start the isolated stack (Postgres 17 + Realtime + GoTrue + PostgREST)
```bash
cd "$WT"
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io \
  npx supabase@2.120.0 start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,storage-api,postgres-meta,supavisor
# enable commit-timestamp ordering used by the concurrency invariants:
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres \
  -c "alter system set track_commit_timestamp=on" -c "alter system set pg_stat_statements.track='all'"
docker restart supabase_db_* supabase_realtime_* supabase_rest_* supabase_auth_*
```
The CLI prints the local demo keys. `lib.mjs` already contains the well-known local defaults; override
with `SEC01_API_URL`, `SEC01_DB_URL`, `SEC01_ANON_KEY`, `SEC01_SERVICE_KEY` if your ports differ.

## 3. Apply the lab SQL (isolated, non-migration)
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f docs/evidence/sec-01-stage-a-r0/sql/10_sec01_campus_chat_lab.sql
```

## 4. Run the experiments
```bash
cd docs/evidence/sec-01-stage-a-r0/harness && npm install
node 00-smoke.mjs                     # sanity: one server-approved message delivered over real Realtime
node 10-atomicity.mjs                 # A1–A8
node 15-pr353-provider-probe.mjs      # unmodified PR #353 send under provider fault + block lock probe
node 20-concurrency.mjs               # B1–B9  (B8_OPS env to scale the random mix)
node 30-inbox.mjs                     # C1–C10
node 40-idempotency-normalization.mjs # D1–D8
node 50-scale.mjs                     # E (E_SCENARIOS, E_MESSAGES env to scale)
node 60-avatar-binding.mjs            # F1–F5 (real client stack vs a second account)
```
Each writes `../results/<SUITE>.json` with per-case `verdict`, `level` (evidence tier), `observed`,
`expected`, and `note`. Console prints `PASS/FAIL/BLOCKED/NOT MEASURED  <id>`.

## 5. Tear down
```bash
cd "$WT" && npx supabase@2.120.0 stop --no-backup
git worktree remove "$WT" --force
```

## Notes / limits
- All clients run in one Node process; delivery-completeness at N=100 is bounded by that (the server
  wrote every `realtime.messages` row — see `E-scale.json` DB-insert columns). Use one process per
  session for a clean multi-process receive measurement.
- `40-…mjs` imports the repo's real `apps/world/src/network/protocol.js`; `60-…mjs` imports the real
  `SupabaseRealtimeTransport`/`NetworkManager`/`RemotePlayerManager`.
- Fault injection in A3/C uses `supabase_admin` only to detach/re-attach a `realtime.messages`
  partition in the **local** DB; it is always re-attached in a `finally`.
- The lab's SEC-01 contract (requestId=UUIDv7 at submit, 10min/30min windows) is reconstructed from the
  Stage A brief because the "SEC-01 v0.4" design document was not found in the repository.
