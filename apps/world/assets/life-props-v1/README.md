# Campus life props v1: local runtime integration

Seven original, unbranded GLBs from the approved 2026-10-07 Campus Life Props 01
pack. The GLB bytes are unchanged; `manifest.json` records their SHA-256 hashes.
Editable Blender files, original authoring scripts, studio previews and export/import
QA remain in the separately delivered asset pack. `attachment-spec.json` preserves authoring dimensions/anchors and records runtime
surface-contact revision 2. Its original centre-origin suggestion proved unsafe in
GPU review and is superseded by the explicit runtime contact fields.

## Runtime bindings

- `npc-factory/purposeful-activity-props.mjs` projects the existing READING,
  COFFEE, PHONE, PHOTO and EATING activities into one primary-hand instance
- Uses `createEquipmentModelLoader` and the existing PlayCanvas asset registry;
  registry-owned containers are shared, instantiated entities are per NPC
- Parents to `ArmPivot_-1`, never `Hand_-1`; the hand centre is only a reference
- Uniform local scale is `0.5 / visual.worldScale`, preserving world scale 0.5
  across NPC heights; fixed local quaternions preserve the existing shoulder sway
- Prop-local surface points meet the actual hand ellipsoid, allowing only 0.0006
  world units (1.2 mm physical) of shallow contact overlap. Book/phone/camera use
  side contact, cup its tapered sleeve, and sandwich its back bread face with a
  runtime-only -90° yaw so its face meets the lateral hand clear of the forearm
- Position compensates for both avatar height and the prop contact offset, preventing
  the prior solid-hand intersection while retaining a connected one-hand silhouette
- Moving, seated, hidden and unsupported activity states remove the prop
- Generation checks discard stale asynchronous loads; repeat frames do not reload;
  failure retains the pre-existing accessory and retries only after activity changes
- Successful attachment hides the old procedural HeldBook/BookSpine; removing the
  activity prop restores them, including when the NPC was constructed under a
  hidden campus root
- `src/rooms/club-room-life-props.js` reuses `createPersonalRoomFixtureModel` and
  `ensureVisualAssets`, loading only when the room is first activated
- Laptop, cup and stationery replace their matching table placeholders after each
  successful load; book is an additional tabletop decoration. Failure keeps the
  placeholder. Re-entering reuses instances; destruction rejects pending insertion
- Table scale 0.5 and inverse rotated rest-anchor offsets place each asset on the
  existing surface; the room root's Z mirror is unchanged

No NPC behavior, activity schedule, economy, inventory, rig, animation architecture,
collision, database, network message or room transition contract is changed.

## Verification

- `node --test apps/world/tests/life-props.test.mjs`: asset/hash contracts, fixture
  scene-graph lifecycle, visibility, transitions, failures, stale loads and ownership
- `npm ci --prefix apps/world/tests/browser --ignore-scripts`
- `node apps/world/tests/browser/life-props-engine.mjs`: actual pinned PlayCanvas
  2.22.4 AssetRegistry/ContainerHandler parsing of all seven local GLBs, mesh counts,
  bounds, anchors, actual avatar attachments at three heights/three motion phases,
  club-room scene instances and rest transforms, hidden-parent restoration and cleanup
- Every prop triangle is tested against the actual transformed Hand mesh envelope at
  heights 0.9/1/1.1 and phases 0/0.8/2. Maximum permitted conservative penetration is
  0.0015 world units and maximum surface gap is 0.002; model-root coincidence is not
  a contact acceptance criterion. Prop triangles also test against the actual
  Forearm capsule axis/radius with the same 0.0015-world penetration ceiling
- `bash .github/ci/world-tests.sh`, `bash .github/ci/npc-factory-tests.sh`,
  `bash scripts/public-ci.sh`: broader regressions

The engine test uses PlayCanvas's NullGraphicsDevice and in-memory file bytes. It
verifies real engine assets and scene transforms, not HTTP loading, GPU drawing,
lighting, visual hand contact or full interactive campus rendering. The existing
straight arms have no elbow/finger articulation; small book/camera assets remain
one-hand props, and the current PHOTO pose still holds the camera below the face.
The original hosted GPU screenshots exposed the centre-origin defect. Corrected
browser/GPU visual acceptance remains outstanding until new screenshots are reviewed. No publication is implied.
