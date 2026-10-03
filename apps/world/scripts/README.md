# Public build and runtime configuration

Run from `apps/world`: `node scripts/build-public-config.mjs`. Output defaults to
`dist/`; `--out <path>` may also select an external or nested output directory.
Sources are not rewritten in place.

## One deployment mode in both environments

The builder and `api/hub-entry.js` use the same `resolveMode` policy in
`public-hosts.cjs`. Configure these **same public values in the build and the
serverless function runtime**, scoped separately to Preview and Production:

- `INHAGAME_BUILD_MODE=preview` or `production`
- `INHAGAME_PUBLIC_HOST_CAMPUS`, `_CLASSIC`, `_INDUCKUP`, `_SURVIVAL`, `_GROW`

`VERCEL_ENV=preview|production` can supply the mode if `INHAGAME_BUILD_MODE` is
absent. When `VERCEL_ENV` is unavailable, set `INHAGAME_BUILD_MODE` in both places.
A build-only `--mode` argument is not a runtime environment variable. Without a
runtime mode, a hosted function rejects every origin, even with valid hosts.

Invalid modes, invalid `VERCEL_ENV`, or conflicts between `--mode`,
`INHAGAME_BUILD_MODE`, and `VERCEL_ENV` are rejected. Preview allows explicitly
configured `*.vercel.app` hosts; Production requires custom domains. No mode is
derived from the incoming request or its origin. Host input must contain five
valid, distinct bare DNS names; partial or invalid runtime input rejects all
origins. A configured Preview origin receives a 204 CORS preflight even when only
`VERCEL=1` and `INHAGAME_BUILD_MODE=preview` are present.

For local fixture builds, explicitly choose `INHAGAME_BUILD_MODE=local` or
`--mode local`. Vercel only permits this with `VERCEL_ENV=development`. Existing
unconfigured, unhosted local API fixtures retain inert template-origin fallback.
Hosted runtimes never fall back to template origins.

The browser config additionally requires `INHAGAME_PUBLIC_SUPABASE_URL` and
`INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Preview/Production. Those are
public browser values; server secrets are not build inputs. Configuring this
builder does not configure the API's separate server-side Supabase/NPC settings.

## Staged output and retry

The generator validates input, copies into a sibling `.NAME.staging-SUFFIX`,
verifies its file set and content, then swaps it into place. A failed swap restores
the old output; if restoration also fails, the error names the preserved backup.
A backup that cannot be cleaned up remains in `.NAME.previous-SUFFIX` and is
never automatically removed by a later build.

Nested output paths are supported. At nested levels, temporary-name directories
are excluded only if they contain a regular build marker
(`.inhagame-public-build` or `.inhagame-public-build-staging`). This includes both
staging phases and mixed-case `mkdtemp` suffixes. Similar user directories without
those markers are ordinary source content and remain included. As before, the
top-level `.NAME.staging-SUFFIX`/`.NAME.previous-SUFFIX` namespace is reserved for
build artifacts and excluded even without a marker. Exclusion is separate from
cleanup: only matching stale staging directories with their staging marker are
eligible for automatic cleanup, never retained backups.

No live Vercel deployment, function bundling, backend connection, domain, `/ops`
routing decision, or database change is implied by this local build contract.
