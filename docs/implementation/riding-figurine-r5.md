# R5 riding figurine: local integration candidate

The user approved R5 as a separate shop furniture item, unlocked at level 6 for
500 Induck Coins. This candidate does not publish assets, apply SQL, grant items,
create a PR, or deploy. Production availability is **not complete**.

## Identity and authority

- Item: `furniture.dual_mascot_riding_figurine`
- Listing: `offer.dorm_furniture.dual_mascot_riding_figurine`
- Shop: `shop.dorm_furniture`; presentation category: decor
- Unique/account-bound, quantity 1; price 500 `currency.induck_coin`; required level 6
- Desk/floor geometry: width .32 m, height .42 m, depth .34 m
- Existing item IDs, owners, saved layouts and prices are unchanged.
- Existing server purchase v2 derives level, charges its own listing price, checks
  ownership and preserves retry/receipt behavior. No client-side grant is added.
- The forward local migration prepares COMING_SOON + LOCKED stock. COMING_SOON
  alone does not block buying; LOCKED is the explicit purchase gate.

## Private delivery and provenance

The approved project-authored R5 reconstruction is not an official university 3D
asset. User design approval does not imply university endorsement or a new license.
No official reference PDF, reference image, source blend or GLB is included here.
The existing private furniture delivery policy remains in effect.

Source SHA-256: `187b5ef18edb12f3b26c95f77a290d6fc2e0a3a386320d544ffcd17de5dd1b1b`.
Its node translations are incompatible with the strict static furniture validator.
`tools/bake-riding-figurine-r5.py` bakes only translations into POSITION data,
leaving topology, materials, normals and world-space appearance unchanged. Each
vertex differs by less than 1e-7 m after float32 encoding. The script accepts only
the pinned source and produces the pinned output; inputs/outputs stay outside Git.

Delivery: `dual-mascot-riding-figurine-r5-52f2746b48ee.glb`

- SHA-256: `52f2746b48eeffb02e35e468a7fef65a847543c9be3f7cf8b22c9e192e6a77c6`
- 2,508,836 bytes; 124,350 triangles; 52 primitives; 11 materials; no textures
- Y-up bounds: min [-.1550000012, 0, -.1689999998], max [.1550000012, .4189999998, .1410000026]

The descriptor is registered but disabled until private delivery is verified.
The proxy candidate admits only the exact immutable filename, digest and size,
using the existing signed redirect/no-store policy. No new public asset path or
caller-controlled URL is accepted. Shop preview and room placement share the same
renderer, loading progress, strict payload validation, failure fallback and pool.

## Remaining release steps (separate permission required)

1. Upload the pinned finished derivative to the existing authorized private
   furniture storage, and extend the private canonical signer allowlist with its
   exact filename, hash and length. No credentials or signed URL belong in Git.
2. Verify canonical and application GET/HEAD, exact full download digest/length,
   CORS, bounded progress/cancellation, cache policy and invalid-route rejection.
3. Enable only this descriptor after readback. Test actual shop preview and room
   views, including desk/floor placement, rotation, removal, re-entry, load failure
   and repeat purchase. The Null harness uses test-only activation and does not
   change the committed false gate.
4. Review/apply the bounded catalog/listing/placement migration through the proper
   production lineage. Activate only this listing after model/render verification.
   Production DB replay is not authorized by this local candidate.
5. Publish the reviewed code through the approved PR/merge/deployment workflow.

## Performance and verification scope

The asset belongs to the separate personal-room budget, not the outdoor cap.
Its static single-pass estimate is 124,350 triangles and 52 primitive submissions,
plus room, avatars, shadows and UI. No texture memory is added. Shared placements
reuse a source but each still incurs its own draw cost. These are estimates,
not mobile GPU or FPS measurements. Actual pixels, GPU timings and performance
acceptance remain UNKNOWN.

Tests:
- `node --test apps/world/tests/*.test.mjs`
- `node apps/world/qa.mjs`
- `node .github/ci/migration-lint.mjs origin/main`
- `node .github/ci/migration-contract-lint.mjs`
- Optional exact private payload: set `RIDING_FIGURINE_GLB` and run
  `node --test apps/world/tests/riding-figurine.test.mjs`
- Optional PlayCanvas 2.22.4 CPU/entity lifecycle: with the same variable, run
  `node apps/world/tests/browser/riding-figurine-null.mjs`.
- The new pgTAP purchase/ownership tests require a separately authorized disposable
  DB replay; writing them does not establish a database execution pass.
