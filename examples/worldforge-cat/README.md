# WorldForge Cat — Engine Patch E1

**Implementation candidate, not Production.** Original primitive geometry, no school marks/assets.

## Quick start (from the repository root)

Requirements: Node >= 22, npm, browser with WebGL2.

```bash
npm ci --prefix packages/worldforge-schema
npm install --prefix examples/worldforge-cat
npm test --prefix packages/worldforge-runtime-core
npm run build --prefix examples/worldforge-cat
npm run check:dist --prefix examples/worldforge-cat
python3 -m http.server 4173 -d examples/worldforge-cat/dist
# open http://localhost:4173/
```

The sample bundles PlayCanvas, engine core, manifest validator, and the world into static `dist/app.js`. Once built, no Studio, Campus, MCP service, external runtime CDN, or production API is required. The static server is required because `file://` restrictions vary by browser.

## Controls

- WASD / arrow keys: horizontal movement on the lawn (no physics yet).
- Shift: running toggle.
- Touch direction buttons and RUN: experimental E1 input. Mobile device QA is **not** claimed.
- Focused form controls do not trigger keyboard movement. Input is cleared when focus leaves the tab.

## Boundaries

E1 includes a world load lifecycle, fixed-timestep update, primitive rendering, parent-child transforms, camera tracking, keyboard/mobile button input, idempotent disposal, diagnostics and a static bundle. E1 does **not** include physics/collision, terrain navigation, GLB imports, native binaries, server-authoritative multiplayer, general script execution, or a full world editor.

The baseline v0.1 schema remains unchanged. The `@worldforge/runtime-core` package requires an injected validator; the example explicitly provides `validateWorldManifest()` from the existing WorldForge schema. Only `core.primitive` is rendered. Other components are preserved and diagnosed, never executed as arbitrary code.

### Licensing

The repository remains All Rights Reserved and these new packages are `UNLICENSED` until a separate licensing decision. No existing INHA WORLD assets were copied into this example. The example build includes PlayCanvas and Zod, whose own license notices must be retained for external redistribution.
