# NPC shop compatibility and private Annyongi v13 release — 2026-10-11

## Release base and admitted candidates

- Release base: `03f4aafaedc4c3168a963a84d7a4a285f9f85985`.
- #336 head: `3a94339a324ea467eb4650d6951b1f6645e815a8`; tree: `c9ec134045a23529249f27f21260f5a4d90bf42c`.
- #338 head: `7e76291148efae48504d9402aee9669de6c0d24f`; tree: `ec9b99ab4e5b1320fd9ac679f60e86626b304d9d`.
- Branch: `release/2026-10-11-npc-shop-annyongi-v13`.
- Only these two candidates are included. All other open candidates, including original #315, are excluded and unchanged. Source PRs must not be independently merged to main.
- Candidate file sets are disjoint: 41 files from #336 and seven text files from #338. Integration preserves their exact blobs; no conflict-resolution or runtime delta is required. The only additional file is this manifest.

## Validation gates

#336 exact-head checks passed, including NPC routing/compatibility, disposable migration preservation and required verify. Its unchanged graphics first-frame threshold initially failed; one same-head failed-job rerun passed without threshold or source changes. #338 exact-head source/database/verify, private character acceptance, optimizer and independent safety canaries passed. Metadata-only private acceptance evidence contains no image/model payloads.

The integrated Release PR must pass its own exact-head CI, including public source and disposable database, NPC browser compatibility, private character acceptance and all applicable safety canaries. Review exact blob preservation and operating boundaries independently. Admit sources as Ready; make the Release PR Ready only after green CI. Recheck unchanged main, current reviewed head and mergeability, then use expected-head guarded squash merge without bypass. Any newly found unresolved P0/P1 incident blocks release.

## Production database and compatibility boundary

This is a client/runtime web release only. Public migration files are disposable-development lineage and are NOT Production migration authority. Do not apply them, install new Production RPCs, change grants, split/move the catalog, activate products, mutate player data or shift backend traffic. The cancelled Production catalog query is not retried. Earlier read-only evidence established v1 present/v2 absent; the actual catalog layout is not asserted.

The exact named no-argument PGRST202 capability miss preserves original combined shop UI and v1. API-prepared legacy capability uses original routing with v2. Only verified split plus v2 enables new NPC/dorm trading. Unknown, mixed, auth or network failures fail closed. Original uncertain purchases retain their original RPC/shop/idempotency key; a failed v2 buy is never retried through v1. This release does not claim split shops are activated on Production.

The Vercel build path is `build-recast-shadow.sh`: local dependency install, Recast artifact build, world-asset optimization and character checks, with no Production SQL or migration command. Public database CI explicitly starts/stops a disposable local Supabase stack, unsets remote credentials and generates types with `--local`. Main-only Git deployment remains the sole deployment path; no manual deployment, environment, credential or permission change is authorized.

## Private asset boundary

Preserve #338's existing private service routing and fixed revision. No private GLB, model/base64 payload, official manual or private image is added to GitHub or public CI artifacts. Private acceptance publishes only JSON metadata. Source SHA256: `5cc0bc54905da5b87314b81691c229bc583ad1980794239634008cd3f0d834fb`; optimized SHA256: `e285995845f126202ccf4372e81a571594af11259722114724a06dd33ee4f430`; unchanged Induck canonical SHA256: `8aede8fd595dd84fda5460e375a18df49f6a91ba813ab7a952f75e768e8964eb`.

## Rollback and completion

Rollback target: previous main `03f4aafaedc4c3168a963a84d7a4a285f9f85985`, READY Production deployment `dpl_62aP9sGqfw7962TQVAXRV3LYj9w6`, serving `inhagame.app`. Rollback execution needs separate approval.

After merge, verify main's expected release SHA/tree, one normal Git-triggered READY Production deployment with the same SHA, canonical alias and live `/api/dev-status`. Check campus HTTP entry, exact served shop-compatibility/character sources, actual canonical and optimized Annyongi route hashes, unchanged Induck hash, and deployment-scoped runtime errors. Until these checks pass report PENDING/HOLD, not COMPLETE. HTTP/source readback does not establish authenticated purchases or visual acceptance; software browser/viewport QA does not establish physical-mobile or GPU performance.
