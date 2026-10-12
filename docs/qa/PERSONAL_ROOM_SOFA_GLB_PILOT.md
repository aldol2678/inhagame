# INHA-WORLD-PERSONAL-ROOM-GLB-PILOT-01

Independent Draft, baseline `5b0bf8746c1a1f361125319b5a884213a3014109`.
Only `furniture.dorm_single_sofa` changes its optional visual. No merge, Production,
DB, price/ownership/RPC/RLS, schema, room UUID, 32-placement limit, collision,
surface, or seat interaction change is part of this work. #329/#334/#362 untouched.

## Asset and coordinate contract

Blender 4.3.2 source: `tools/world-assets/source/dorm-single-sofa-v1.blend`.
Rebuild: `blender -b --python scripts/assets/build-dorm-single-sofa.py` (see script CLI).
GLB: 35,492 bytes, 1,784 triangles, 912 exported vertices, 3 materials/primitives.
No texture/download/Draco/meshopt decoder: raw GLB is already below the temporary
150KB compressed transfer target. Do not add compression dependencies just to
label this tiny self-contained file compressed. Blender readback and exact SHA:
`docs/evidence/sofa-glb-pilot/asset-validation.json`.

X width=1.10, Y height=.72, Z depth=.78; floor center origin; front=-Z; seat top=.36.
Personal-room root already reflects Z. GLB inherits precisely the same placed
entity/root matrix as the old sofa, including this existing reflection, and never
adds another reflection or changes seat transforms.

## Lifetime / failure behavior

The old procedural sofa is created synchronously and retained as fallback.
A code-owned URL is loaded once per app while references remain. Instances have
separate entities; meshes/materials belong to the reference-counted container.
Before parsing, SHA-256 must match the code-registered known-good static GLB.
This also prevents the pinned engine parser from seeing truncated/untrusted bytes.
Validation rejects empty, skinned, oversized, off-origin, non-triangle or overbudget
models. The fallback remains available until successful loading and one postrender.
A loader/instantiation/bounds failure or 8s load/render timeout restores fallback.
Context loss returns to fallback; no automatic retry loop. Device restoration and
shader-driver errors beyond signaled context loss require real device acceptance.

Remove/rebuild releases the old generation before asynchronous completion can attach.
Room deactivate removes candidate instances and releases their GPU resources;
reactivation rebuilds only visuals using the retained authoritative objects.
Root/preview destruction cancels readiness. A final in-flight release aborts its bounded fetch and evicts the pending pool entry,
so a hung transfer cannot poison future room/preview requests. Late completion
after an abort is still cleaned. Last release clears the loader cache
before removing the asset. Simultaneous room/preview references share within one
Application; different graphics devices necessarily have separate GPU resources.

## #362 compatibility, not integration

Read-only reference #362 head `69cd248fd147b351e3e4814e9fda25c76ef16105`.
Its `furniture-shop-preview.js` currently registers TextureHandler only; therefore
it cannot load a container, and our optional renderer correctly stays fallback.
Its immediate first-frame capture can also cache loading geometry. Before eventual
integration, add ContainerHandler to that preview's existing app initialization,
await `layer.whenVisualsReady()`, and call `captureFurnitureVisual(layer,capture,{viewKey})`.
That helper binds generation + revision before/after capture, returns null on stale
capture, and distinguishes final GLB versus final fallback in a versioned cache key.
Invalidate on `layer.root` visualchange. Never reuse a pending fallback thumbnail
as GLB. Include camera/angle/light/quality in viewKey; without it cacheKey is null.
Empty or suspended layers cannot produce a thumbnail. Keep #362 offer/price/purchase code completely unchanged. The pilot browser
uses this exact shared renderer/capture helper, not a duplicated showroom model.
Current #362 branch has NOT been integrated or tested with these future changes.

## Evidence / acceptance

- World tests and real pinned PlayCanvas NullGraphicsDevice parsing are run locally.
- Housing workflow is extended; no new CI workflow. Existing housing save/reload/
  chair/room tests remain. Dedicated fixture uses actual room + furniture renderer,
  identical camera/light/placements for A/B and low/medium/high profile pixel caps.
  Room's established non-shadowed practicals stay unchanged at every tier.
- Matrix: desktop1280×800,portrait390×844,landscape844×390 × three quality tiers × A/B;
  intentional 404 fallback; shared two-sofa source; six remove/re-enter cycles;
  actual canvas thumbnail captured only after settled model generation.
- JSON records GL renderer, triangles, draw calls, loading time, CPU render duration,
  frame intervals, buffer memory, JS heap if available. GPU frame time remains
  UNKNOWN without validated timer-query evidence. CPU times are not GPU times.
- Local Chromium is blocked by socket() EPERM. Remote CI results must be read back
  on exact head. Blender/Null renders are never game pixel acceptance.
- Even green software WebGL2 CI leaves overall HOLD until physical GPU/mobile
  performance and actual visual improvement are accepted. No tolerance for a real
  hardware slowdown was agreed, so do not invent a percentage threshold.

Reproduce: node --test apps/world/tests/*.test.mjs; node apps/world/qa.mjs;
node apps/world/tests/browser/housing-sofa-glb-null.mjs;
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/housing-sofa-glb-smoke.mjs.
