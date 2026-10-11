# WoodFloor051 1K Color texture

Source: https://ambientcg.com/view?id=WoodFloor051
License: CC0 1.0 (https://ambientcg.com/info/license/)

File: `WoodFloor051_Color_1K_Q30.webp`
- 1024 × 1024 pixels, RGB image.
- Derived by WebP quality 30, Pillow/libwebp method 6 from the user-provided official `WoodFloor051_1K-JPG_Color.jpg`.
- Source SHA-256: `ffbe4de8765619f278c5f819cd751e003808fa671eb99603abdf82b94ca85e9a`
- Derived WebP SHA-256: `a6994b489025e4a0314b663fafd5f2805e64e48b26bc101cc9ce81ee905bbb38`
- Derived size: 28,570 bytes; source JPEG: 1,047,153 bytes.
- This repo includes only the re-encoded color map, not original texture/normal/roughness files.

Default personal-room floor: Wood Floor 051 (B). For A/B comparison or immediate opt-out, use `?woodFloor051=0`; omitting the query uses B.
If loading or decoding fails, the existing `#b99168` floor remains visible. No change to collision, saved layout, or server.
Mobile GPU frame-time, FPS and memory verification remains a separate post-deployment task.

## Fixed personal-room oak / linen chair

`fixed-chair-oak-linen.glb` is original procedural geometry authored for INHAGAME.
It contains no downloaded mesh, third-party texture, image or external dependency.
The repository `LICENSE` applies; no additional third-party license is required.

- Source shapes and layout: `apps/world/src/rooms/personal-room-chair-design.js`
- Generator: `tools/world-assets/generate-personal-room-chair.mjs`
- Regenerate: `node tools/world-assets/generate-personal-room-chair.mjs`
- Verify determinism without writing: append `--check`
- Asset format: self-contained glTF 2.0 binary; 3 shared shapes, 17 semantic parts
- Model-space floor pivot: Y = 0; back: +Z; seat support top: Y = 0.27 m
- Runtime fixed anchor yaw: 180° toward the desk; owned-chair yaw is unchanged
- Visual bounds: X ±0.25 m, Z -0.2485..0.248 m, Y 0..0.5975 m
- Fixed anchor and 0.55 × 0.55 m gameplay footprint remain unchanged

The production loader binds each new instance's four material slots to the
room-owned `woodOak`, `woodOakDark`, `fabricLinen`, and `fabricLinenSeam` palette.
It does not mutate shared GLB materials. The visible loading/offline fallback
uses the exact same source shapes and slots. Ground contact shading is owned by
the room and remains visible in both paths. Collection-owned chairs are unrelated.

This new asset replaces only the fixed chair's old KayKit `chair_A` URL. Existing
KayKit files and their attribution remain intact for other references.
