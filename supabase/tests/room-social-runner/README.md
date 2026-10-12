# Room social database verification

Local synthetic SQL checks, with an exact dev-only dependency:

```sh
npm ci --ignore-scripts --prefix supabase/tests/room-social-runner
npm test --prefix supabase/tests/room-social-runner
```

This runs harness unit tests and PGlite 0.3.14 against the actual room migrations,
with synthetic auth/provider objects. It proves neither a full Supabase replay nor
multiple PostgreSQL backends nor WebSocket delivery.

The existing required `Public CI / database` job runs `scripts/public-db.sh` on a
fresh GitHub-hosted runner. Supabase CLI starts the disposable local stack, replays
the complete migration lineage, runs all pgTAP files, then automatically discovers
`supabase/tests/integration/room-social.integration.test.mjs`. No separate remote
database URL, project credentials, migration push, or production connection is used.

The real integration runner accepts only loopback port 54322 and the checked-in
local database. Every race uses independent psql processes. A held row lock is
released only after `pg_stat_activity` proves each distinct contender backend is
waiting for a lock; the returned backend PIDs must match that evidence. Tests cover
seven-way capacity, two contenders for the final slot, two-account races for all
six chairs, account replacement/old leave, expired leases, four-way chat rate
limiting, and production numeric actions through actual provider SQL insertion.

pgTAP uses the real provider table and publisher without replacing protected
Realtime functions. Missing-publisher fault injection is confined to PGlite's
synthetic schema. The two pre-existing exact policy-list assertions now include
the six committed room policies when a real provider table exists; their stand-in
case retains exactly the original campus policies.

All identities are synthetic. pgTAP activation/data/policies are rolled back.
Integration fixtures restore the default CLOSED chat switch and remove their own
identities/topics. Supabase is stopped with `--no-backup` by the job's existing trap.

Supabase DB Broadcast retains messages in `realtime.messages` for up to three days
as documented by the provider. These short tests check private transport metadata
and lack of application transcript columns; they cannot verify a three-day cleanup
window. Real authenticated browser subscriptions, reconnect/authorization behavior,
provider retention disclosure approval, and explicit activation remain separate
release gates. A passing PGlite run must never be reported as passing those gates.

Provider references:
- https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database
- https://supabase.com/docs/guides/realtime/authorization
