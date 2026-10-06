# Collection Book · small read-only slice

This candidate extends the existing Inventory modal with **수집도감**. It does not grant items,
write discoveries, settle rewards, or add SQL/grants. It has not established Production availability.

## Authority and request path

- `GET /api/world-collection-book` accepts no body, actor selector or query parameters
- Vercel forwards only the Bearer token to the fixed `/collection-book` route on its existing
  `NPC_AI_CLOUD_RUN_URL`. It never receives a Supabase service credential
- The existing Cloud Run Auth verifier resolves a permanent account from that Bearer token
- The only permitted service RPC is `world_collection_list_v1({ p_user: verifiedActor })`
- The raw service-role result stays server-side. Its `userId` must match the verified actor
- Both code Registry and server mirror must agree on ACTIVE status, category, persistence mode
  and definition version before an entry is visible
- PUBLIC/SILHOUETTE are supported. SECRET/HIDDEN, future/disabled and unknown entries fail closed,
  including totals. An undiscovered SILHOUETTE carries no original ID, title, category or source
- The native Cloud Run GET rejects query/body selectors and nonempty/chunked request framing
  before Auth/RPC; `/quest` and default NPC routes retain their existing handlers
- Both credential-bearing read hops refuse redirects. The proxy bounds upstream JSON to 1 MiB,
  validates/reconstructs the projected wire schema and maps only known error/status pairs
- All responses use `private, no-store`; sensitive error details are never returned

The code Registry and current migrations take precedence over the historical status notes in
`COLLECTION_DISCOVERY_P0.md`. Carp is ACTIVE in current code; this does not establish that Fishing
or this API is operationally enabled. The existing Cloud Run runtime retains its server credential;
Vercel uses only its existing backend URL. No environment values or grants are changed by this slice.
The backend route must be available before the proxy is released; an older/missing backend fails
closed to the existing unavailable/retry UI. Current ownership remains an independent inventory read.
Local and disposable fixtures do not establish the deployed backend revision or live RPC availability.

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
with all HTTP calls stubbed. It verifies the CJS proxy without a Vercel service key and the new native
Collection module with `.js` detection disabled. A separate fixture copies the Dockerfile sources
and invokes the actual Cloud Run router without opening sockets, using Docker CMD module-detection
semantics for the existing AI/quest dependencies. This is not a built-container or live service test.

`collection-book-cloud-read.test.mjs` covers client → fixed proxy → native handler → existing Auth
verifier/read RPC with synthetic identities only, account separation, anonymous refusal, redaction,
query/body rejection, redirect/error/response-size guards and retry recovery. The shared projected
wire parser is canonical `.mjs` and is also used by the browser; it contains no registry/ledger data.
The proxy waits 18 seconds for the existing 5-second Auth + 10-second RPC budgets; the client waits
20 seconds so the proxy can return a stable error before the UI timeout.

Run the standalone quest/NPC regressions explicitly alongside `scripts/public-ci.sh`:
`node apps/world/npc-factory/tests-quest.mjs`, `tests-main2-quest.mjs`, `tests-main3-quest.mjs`, and
`tests-npc-ai-pilot.mjs` (all under the same npc-factory directory). Hosted browser/static hash checks
include the shared `.mjs` wire parser. None of these tests proves live authenticated history.

The separate `collection-book-container.yml` gate builds the actual `node:22-alpine` Dockerfile
at the exact PR head. Its read-only, network-disabled container runs the packaged entrypoint
with test-only synthetic Auth/read-RPC responses and real loopback HTTP. It compares every
packaged source hash with the checkout and records the built image ID, actual parent/child
Node 22 versions, platform and 16 route checks. The Dockerfile base reference is recorded as
such, not claimed to be a separately resolved base digest. A successful hosted artifact is
required before treating this as real-image proof; it still does not establish live backend
availability or account history.
