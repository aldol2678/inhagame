# ALDOL World Controls | candidate contract P0

Status: **candidate / non-production**. First implementation source: INHA WORLD, `apps/world/src/input/world-control-standard.js`. No other game is migrated by this patch.

## Authority and scope
- INHA WORLD's `PlayerController` and `OrbitCameraController` are the observed baseline, not transferable as whole classes. Preserve mounts, collision, and custom modes in the owning game.
- Shared math owns **ground intent**, **camera-relative XZ transform**, and **camera look signs / pitch clamping** only. Focus ownership and pointer capture remain in the existing runtime modules.
- Gameplay axes: +X right, +Y up, +Z forward. At yaw=0, W is +Z, D is +X.
- Gameplay yaw is in **radians**; `x = right*cos(yaw)-forward*sin(yaw)`, `z = right*sin(yaw)+forward*cos(yaw)`.
- Touch joystick: positive screen Y points down, therefore `forward = -touchY`.
- A rightward screen drag subtracts camera yaw; a downward drag increases pitch unless the mouse invert-Y setting is enabled.
- INHA WORLD's rendered PlayCanvas scene reflects gameplay Z (`renderZ = -gameplayZ`); do **not** reflect the gameplay movement vector twice. Other engines must supply their own render adapter.
- Any UI/chat/photo/gameplay focus policy continues to be enforced by `input-focus-manager.js`. Canvas look and joystick must not share pointer ownership.
- This patch does not introduce a production deployment or broaden repo redistribution rights.

## Acceptance / regression
Run `node --test apps/world/tests/world-control-standard.test.mjs`.
The test covers yaw 0/90/180/270, WASD/joystick parity, diagonals, non-finite inputs, horizontal drag sign, invert Y and pitch bounds.
Existing INHA WORLD browser movement/collision tests are still required before merge and before claiming runtime QA PASS.

## Adoption path
1. Verify INHA WORLD remains behavior-identical for walking, balloon, kickboard, and orbit look.
2. Expose an engine adapter for PlayCanvas and Three.js without copying campus/world logic.
3. Pilot one other 3D game in a non-production environment, verifying touch and desktop movement before further adoption.
4. Only after cross-game verification choose a stable shared-package home and release version. Avoid duplicating divergent controller copies.
