# Codex Astra continuation checkpoint — P2.1

**Resume from [Draft PR #440](https://github.com/aldol2678/inhagame/pull/440). Read its current head and final checkpoint first.** This committed snapshot records the tested implementation revision before this evidence-only documentation commit. The PR body records the later full branch HEAD and exact-head CI after they exist; do not treat a source file as containing its own commit hash. Re-read live GitHub on every session.

```yaml
project: ALDOL 3D Studio
agent: Codex Astra
status_as_of_kst: '2026-10-21T08:51:00+09:00'
repo: aldol2678/inhagame
starting_pr: 439
working_branch: feat/aldol-3d-studio-p2-1-glb-rendering-20261021
exact_head: bdfb417236772b3bd852b24dbc6d4300da7c32be
head_scope: tested implementation; subsequent checkpoint/evidence commit resolved from PR 440
stacked_base: feat/aldol-3d-studio-p2-asset-factory-v51-20261021
stacked_base_head: bdaa5e68f3cbfe6096a9ad29da3b20203d7f9399
draft_pr_url: https://github.com/aldol2678/inhagame/pull/440
latest_final_checkpoint: https://github.com/aldol2678/inhagame/pull/440
code_changes:
  - 'web/model-viewport.mjs: pinned PlayCanvas container loading, meshes/materials/textures, lifecycle, hierarchy, transforms and diagnostics'
  - 'web/glb-contract.mjs: shared bounded GLB geometry and resource validation before engine parsing'
  - 'web/studio.js, studio.css, factory-panel.mjs: model placement, common camera/input/gizmos, explicit failure display and inherited visibility'
  - 'src/world-scene-adapter.mjs: expose core.renderable asset reference in read snapshot'
  - 'src/asset-factory-bridge.mjs: validate actual geometry at import and restore hash-verified archive bytes'
  - 'src/asset-archive.mjs: bounded in-memory stored-ZIP reader, CRC/path/size/offset/duplicate verification'
  - 'src/bootstrap.mjs, bin/dev-server.mjs: new --package session, fixed pinned-engine route; loopback only'
  - 'tests/glb-fixture.mjs, glb-render.test.mjs, browser-glb-p21.mjs: real geometry, security, new-session and browser evidence'
  - 'tests/browser-factory-p2.mjs: updated placement-button label; existing P2 test remains a byte handoff test'
  - 'package.json, .github/workflows/aldol-3d-studio-p2-1.yml: reproducible checks and exact-head CI/artifact'
  - 'docs/P21-glb-rendering.md, docs/evidence/p21/: reproduction, compatibility bounds and execution evidence'
verified_tests:
  - gate: P2 existing unit/HTTP/MCP + P2.1 security
    state: PASS
    counts: '43 PASS / 0 FAIL (existing 36 + new 7)'
    evidence_url: ./evidence/p21/unit.log
  - gate: real editor classes + Factory roundtrip + world runtime adapter
    state: PASS
    counts: '8 PASS / 2 historical SKIP; 1 PASS; 4 PASS'
  - gate: P2.1 actual GLB rendering
    state: PASS
    counts: '11 browser groups PASS / 0 FAIL'
    mesh_and_pixel_evidence: '2 mesh instances, 18 vertices/18 indices each; 2 materials, embedded 2x2 PNG; 43475 changed pixels, 17602 red material pixels; SHA256 08606df88f864f950d43266a676742d4f8438e784544d0ee068bc36b8414a51b'
    browser_gpu: Chromium 153.0.8010.12 / PlayCanvas 2.22.4 / WebGL2 SwiftShader
    evidence_url: ./evidence/p21/report.json
  - gate: archive reopen
    state: PASS
    counts: new server process + new browser context; identical hash/world/reference/material/hierarchy/transform within 1e-6
  - gate: mobile Chromium emulation
    state: PASS
    counts: '320x568, 390x844, 740x360, 844x390; GLB pinch/selection/move/rotate/scale/Undo; existing 17 P1.2 groups'
  - gate: existing browser/runtime regressions
    state: PASS
    counts: 'P1.1 2 groups; P1.2 actual campus 5 groups / 22896 pixels; P2 local byte handoff PASS'
  - gate: CI on final branch HEAD
    state: NOT_RUN
    blocked_reason: snapshot written before final evidence commit and CI completion; read final PR body and live checks
    evidence_url: https://github.com/aldol2678/inhagame/pull/440/checks
  - gate: Android/iOS physical devices
    state: BLOCKED
    blocked_reason: no connected device or device-provider access; Chromium emulation is not physical-device/Safari certification
open_issues:
  - 'Compatibility: static triangles + embedded PNG only. Extensions/JPEG/compression/skins/animations/morphs/sparse/data URI/external URI explicitly rejected; representative artist asset QA remains open.'
  - 'Campus production asset-cache plumbing is unchanged. GLB portable reopening verified in a fresh Studio PlayCanvas session; P1.2 campus runtime is a separate regression.'
  - 'Node picking uses existing origin proximity; mesh-accurate picking and model auto-framing not implemented.'
  - 'Metadata provenance and rights_qa/visual_qa/engine_import_qa remain UNKNOWN. Fixture render success is not Factory-wide QA.'
  - 'C14 Android/iOS/Safari physical device and hardware GPU validation BLOCKED; next session needs actual device access.'
next_action: Re-read PR 440 HEAD and CI, then evaluate a representative user-provided GLB against the static embedded-PNG profile and add focused compatibility tests.
requires_explicit_approval: 'None for continuing local implementation/tests/Draft PR; credentials, permissions, costs, remote writes, production/main deployment require separate approval.'
main_changed: false
main_observed_head: 81b3fa793b6155d50e1bb30bb3611732b8c79f9f
factory_production_changed: false
existing_prs_changed: false
```

Start-of-session evidence: PR #436 → #437 → #438 → #439 all OPEN/DRAFT with unchanged heads; P2 baseline's 5 CI workflows SUCCESS. Live Factory capabilities still adapter 0.2.1, metadata-only, no upload/storage/network calls; separate installed plugin 0.3.4 unchanged. No other agent was active in this workspace.

For each next task, copy this checkpoint schema into the new branch/PR, record actual PASS/FAIL/BLOCKED/NOT_RUN and current immutable hashes/CI URLs, then update the PR's final checkpoint after the last commit. Preserve the stacked chain and existing PRs.
