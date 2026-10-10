# Supabase (Public development lineage)

This directory holds the database schema, tests and Edge Functions for the public development
repository. It is not a mirror of Production: Production keeps its own migration history and
operational objects, which are maintained separately.

## Contents

- `migrations/`: the Public lineage. The first file, `20261001213132_public_baseline.sql`, is a
  data-free baseline of the game schema; every later file is a forward migration.
- `tests/database/`: pgTAP tests (`supabase test db`).
- `tests/integration/`: Node integration tests that run the unmodified API handlers against the
  local stack (`scripts/local-integration.mjs`).
- `functions/`: Edge Functions used by the games.
- `database.types.ts`: generated types; CI checks they cover the local schema.
- `config.toml`, `auth-email-templates/`: local stack configuration.

## Rules

1. Migrations are append-only. Do not edit, rename or delete a file that is already on `main`.
2. Every new migration is named `<14-digit version>_<snake_case>.sql` and its version is newer
   than every migration on `main`.
3. No Production-only (ops) objects in migrations. `.github/ci/migration-lint.mjs` enforces
   rules 1–3.
4. No player data, account identifiers or credentials in Git. Test fixtures use synthetic UUIDs.
5. Player-facing access goes through `SECURITY DEFINER` RPCs with `search_path = ''`. Tables that
   players must not read directly live in `private` with no grants; the authenticated `EXECUTE`
   surface is pinned by `tests/database/01_grants_contract.test.sql`.
6. Add or update the pgTAP test and `database.types.ts` in the same PR as the migration.

## Local verification

```bash
bash scripts/public-db.sh
```

This starts a disposable local stack, replays every migration, runs pgTAP and the integration
tests, and compares generated types with `database.types.ts`. It never targets a remote project:
`scripts/local-integration.mjs` refuses non-loopback endpoints, and the integration tests block
any request that is not addressed to the local API.
