# ALDOL 3D Studio P2.Motion: MCP motion clip submodule

Status: Draft implementation. This lives **inside the existing** `tools/aldol-3d-studio-p1/` codebase and MCP stdio entrypoint, not a new plugin/service. It is stacked on Studio P2.1 (PR #440). Existing INHA WORLD runtime, world schema, Asset Factory bridge, static GLB renderer and deployments are unchanged.

## What it actually supports

Six tools in the existing local MCP process:

| Tool | Permission | Implemented result |
| --- | --- | --- |
| `motion_library` | read-only | Session's clip names, frame counts and content hashes |
| `motion_validate` | read-only | Validate a supplied JSON keyframe clip or registered clip |
| `motion_import` | `--allow-write` | Register an **ALDOL JSON** keyframe clip in process memory |
| `motion_retarget` | `--allow-write` | New clip with explicit **joint-name mapping only** |
| `motion_blend` | read-only | Sample compatible clips at a time and blend into a pose |
| `motion_export` | read-only | Return JSON clip and SHA-256; no disk writes |

This does **not** import animated GLB/FBX/BVH, read files or network URLs, solve IK, compensate for bone length or retarget rest-pose axes, persist clips after process exit, edit the canonical WorldDocument, show an animation timeline, play animated models in the viewport, or export animated GLB. `web/glb-contract.mjs` still rejects skins and animations by design. The tool results explicitly report the boundary. Do not label the feature as animated-GLB rendering support.

## Schema: `aldol.motion.clip/1`

```json
{
  "id": "walk",
  "name": "Walk",
  "duration": 1,
  "fps": 30,
  "skeleton": ["root", "leftArm"],
  "tracks": [
    {"joint":"root","channel":"translation","frames":[{"time":0,"value":[0,0,0]},{"time":1,"value":[2,0,0]}]},
    {"joint":"leftArm","channel":"rotation","frames":[{"time":0,"value":[0,0,0,1]},{"time":1,"value":[0,0,0.7071067811865476,0.7071067811865476]}]}
  ]
}
```

Time is seconds. Translation is in the source skeleton's coordinates; no conversion is assumed. Rotation is a normalized quaternion `[x,y,z,w]`. Scale is a positive `[x,y,z]`. Frames must be strictly increasing within `[0,duration]`. Interpolation: linear for translation/scale and normalized shortest-path linear interpolation (nlerp) for rotation. Blending requires identical bone/channel key sets and compatible skeleton names. Both source clips are sampled at the same requested time, clamped independently to their duration. The output is a **pose**, not a generated animation clip.

### Example calls

```json
{"name":"motion_import","arguments":{"clip":{"id":"idle","name":"Idle","duration":1,"fps":30,"skeleton":["root"],"tracks":[{"joint":"root","channel":"translation","frames":[{"time":0,"value":[0,0,0]},{"time":1,"value":[0,0,0]}]}]}}}
{"name":"motion_retarget","arguments":{"sourceId":"idle","id":"idle.hero","targetSkeleton":["hips"],"mapping":{"root":"hips"}}}
{"name":"motion_blend","arguments":{"aId":"idle","bId":"idle","time":0.5,"alpha":0.5}}
{"name":"motion_export","arguments":{"id":"idle.hero"}}
```

The read-only default registers four safe queries; `--allow-write` exposes the two session-mutating tools plus the pre-existing Studio scene write tools. Import/retarget enforce clip-count, text-size, frame-count, joint-count and memory budgets, and reject collisions or malformed data instead of silently overwriting.

Run local checks within `tools/aldol-3d-studio-p1`:

```sh
npm run check
npm run test:motion
npm test
```

Real runtime/WebGL, animation GLB rendering, physical Android/iOS devices and cross-project end-to-end animation handoff are not covered by these motion-data tests. Existing static-GLB browser tests remain independent.

## Next compatibility increment

To ingest glTF 2.0 skins + animations in P2.3, add a **separate bounded animated-GLB validator/decoder** to avoid weakening P2.1's fail-closed static GLB path. Follow with pinned PlayCanvas skeleton playback, asset archive migration, mobile playback performance tests and actual artist-authored rigs. FBX/BVH conversion and human retargeting need dedicated format and rest-pose handling, not a file-extension shortcut.
