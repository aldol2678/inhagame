# Personal-room furniture release candidate

Base: main `2507ed687d7f7c5e788d968442c19afcfe55ed39` (#414).
This combines strict GLB loading, personal-room preparation/loading UI, and
per-placement compatibility for the latest character furniture. Existing main
Analytics and showroom integration are preserved; historical #362/#392 are not
reintegrated. No catalog, saved-layout, ownership, SQL or RPC changes are included.

## Current release boundary

All replacement metadata is disabled. The intended five deliveries are character
chair R2, character nightstand R1, character bookshelf R3, official rug R1 and
fixed bed R2. The old sticker chair/nightstand/bookshelf are not in the API
allowlist. Their disabled metadata remains for historical local test evidence.

Private payload total: 23,217,408 bytes. Do not put GLB/PNG/PDF or base64 into Git.
The previous inline-base64 function bundle contains superseded furniture and must
not be deployed. Embedding all current payloads exceeds the function upload limit.
The current buffered Vercel proxy also cannot carry the two largest files within
its response-size limit. API allowlisting alone is not delivery readiness.

Before enabling any replacement:
1. Establish an authorized private asset upload/delivery route and verify exact
   SHA/size readback for all five immutable objects.
2. Replace only furniture delivery with a narrowly validated signed redirect
   contract (exact project, approved bucket and immutable object path). Handle
   upstream redirects manually and send signed redirects with no-store caching.
   Do not invent a bucket, expose credentials, or add an admin upload endpoint.
3. Verify CORS, redirect expiry/cache behavior, cancellation and bounded actual-byte
   progress from the browser transport. Existing five character/accessory routes
   must remain unchanged.
4. Obtain exact-head mandatory CI and real-screen/GPU evidence. Current Null
   results do not establish pixel appearance, mobile FPS or avatar-mesh contact.

The independent local compatibility result preserves old saved placements and
falls back per object when the enlarged silhouette cannot fit. It does not prove
arbitrary room route connectivity. No production asset delivery or activation is
claimed by this code-only candidate.

## Signed redirect follow-up (still inactive)

The code-only API candidate now requests new furniture with `redirect: manual`
and accepts only HTTP 307 carrying the exact manifest SHA and byte length. Its
Location must be HTTPS on the configured Supabase project, bucket
`inhagame-furniture-private`, and the exact immutable filename at the bucket root.
Only a single nonempty token query is accepted; other origins, paths, credentials,
fragments and extra queries fail closed. Every admitted furniture response,
including upstream failure, uses `Cache-Control: no-store`. The Vercel function
never downloads or buffers these furniture payloads. Existing five brand asset
canonical/optimized response behavior is preserved.

The separately retained private canonical source preserves the five original
inline assets, and may use the existing server-injected Supabase service role to
request a 300-second signed object URL for the five fixed filenames only. No
credential was read or copied, no upload/admin endpoint was added, and no new
persistent credential is required by this design. Signed capabilities must never
be logged or committed. The public client still validates full SHA, byte count,
structure and bounds after receiving the actual object bytes.

This local contract test does not establish that the bucket or objects exist,
that a canonical function has been deployed, or that real CORS/redirect transport
works. Asset upload/readback and operational verification remain activation gates.
