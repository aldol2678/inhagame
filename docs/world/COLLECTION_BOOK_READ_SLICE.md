# Collection Book · small read-only slice

This candidate extends the existing Inventory modal with **수집도감**. It does not grant items,
write discoveries, settle rewards, or add SQL/grants. It has not established Production availability.

## Authority and request path

- `GET /api/world-collection-book` accepts no body, actor selector or query parameters
- The existing server Auth verifier resolves a permanent account from its Bearer token
- The only permitted service RPC is `world_collection_list_v1({ p_user: verifiedActor })`
- The raw service-role result stays server-side. Its `userId` must match the verified actor
- Both code Registry and server mirror must agree on ACTIVE status, category, persistence mode
  and definition version before an entry is visible
- PUBLIC/SILHOUETTE are supported. SECRET/HIDDEN, future/disabled and unknown entries fail closed,
  including totals. An undiscovered SILHOUETTE carries no original ID, title, category or source
- All responses use `private, no-store`; sensitive error details are never returned

The code Registry and current migrations take precedence over the historical status notes in
`COLLECTION_DISCOVERY_P0.md`. Carp is ACTIVE in current code; this does not establish that Fishing
or this API is operationally enabled. The server runtime needs its existing service configuration.

## Three different facts

1. **DISCOVERED / UNKNOWN:** only the server discovery ledger projection provides the date and
   verified count. The denominator includes only the entries actually shown and trackable here
2. **OWNER_DERIVED:** Biryong is labeled as separately owned/unresolved. No discovery boolean,
   timestamp or percentage is invented. This slice does not resolve Biryong state
3. **Currently owned badges/mementos:** the existing self-only inventory client supplies current
   holdings for `badge.main_gate`, `badge.mcm_2026_landlord` and `memorabilia.mcm_2026_wristband`.
   Their acquisition metadata describes the current ownership row. It is explicitly not a complete
   historical acquisition record and never contributes to discovery totals. Missing ownership is
   never interpreted as “never acquired.” No new catalog item or reward is created

The existing discovery list RPC does **not** return first-source provenance. Discovered entries
therefore show **출처 기록 미제공**, rather than infer an acquisition source from a catalog rule or
inventory quantity. A future source field needs a separately reviewed read-model SQL change.

## UI and lifecycle

- Entry: existing Inventory → 수집도감; no additional HUD button or input owner
- Uses the existing inventory modal's exclusive-panel, Escape/close, focus-return and input gate
- Lazy reads, loading, empty, unavailable/retry and ready states; retries coalesce
- Account switches immediately clear the book and ignore stale token retrieval/network completion
- No local persistence of account records. No public or other-player Collection view
- Current holdings are also withheld if book and inventory account bindings disagree

## Verification

`node --test apps/world/tests/collection-book.test.mjs` covers the server projection, malformed
records, identity filtering, forbidden requests, deployment handler, lazy client, retries, account
races, current-holdings separation and modal closure. Existing inventory tests remain applicable.

`apps/world/tests/browser/collection-book-harness.html` uses synthetic records with the real clients
and view. Optional native acceptance: `node apps/world/tests/browser/collection-book-smoke.mjs`
with Playwright installed in a permitted browser/server environment and
`EXPECTED_COLLECTION_BOOK_HEAD` set to the exact candidate SHA. The scoped hosted workflow records
three viewport screenshots and served-source/screenshot hashes using read-only permissions. Local DOM unit tests are not
native browser or live-account observation. Hosted QA uses synthetic reads only; it does not prove live availability or historical acquisition completeness.

Canonical context: Collection Framework CURRENT DESIGN, `COLLECTION_DISCOVERY_P0.md`, and
`docs/architecture/AUTHORITY_MAP.md` (Collection/Inventory authority boundaries).

## Explicit server module format

The CJS deployment entrypoint imports only explicit `.mjs` server dependencies. Public Supabase
configuration and the Collection discovery registry are canonical `.mjs` modules; their existing
`.js` paths are compatibility re-exports for browser consumers. There is no duplicate configuration
or registry, and no global package-type change.

`collection-book-server-runtime.test.mjs` runs the actual API entrypoint with Node's automatic
`.js` ESM detection disabled. It covers unauthenticated 401 and a synthetic authenticated read,
with all HTTP calls stubbed. This matches the production loader failure that ordinary Node tests
did not expose; it does not prove live account history.
