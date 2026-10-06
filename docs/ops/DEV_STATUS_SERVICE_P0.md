# INHAGAME Dev Status Service P0

Status: implementation candidate · read-only

## Purpose

Provide one small CURRENT-status contract for INHA WORLD developer tooling without depending on the
legacy INHAGAME Status Lab snapshot. The service lives with the current public World repository and
uses explicit provenance instead of filling unavailable live values from an old snapshot.

## Canonical target

- Repository: `aldol2678/inhagame`
- Branch: `main`
- Production application: `inhagame-campus-p0`
- Production URL: `https://inhagame.app/campus/`
- Endpoint: `GET /api/dev-status`

The historical Status Lab snapshot is evidence only and is not a CURRENT source for repository,
release, deployment or recent-change status.

## Contract

`/api/dev-status` performs one bounded read of the public GitHub `main` commit and combines it
with Vercel's deployment commit/environment metadata available to the serving function.

It returns:

- live GitHub `main_sha`, or explicit `UNAVAILABLE`
- serving deployment commit SHA
- serving Vercel environment
- Production serving status
- `main_matches_production` only when both values are comparable
- source mode and fetch time

No database, GitHub, Vercel, account or game state mutation is exposed. A failed GitHub read never
falls back to `inha-duck` or a saved PASS; comparison becomes `UNAVAILABLE`.

## Next integration

The future Dev Center and MCP status reader should consume this contract rather than embedding
repository names or copied release snapshots. MCP remains read-only; wiring it to this endpoint is a
separate change.
