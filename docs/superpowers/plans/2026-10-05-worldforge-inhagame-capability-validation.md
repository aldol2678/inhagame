# WorldForge INHAGAME Capability Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Validate the INHAGAME-specific WorldForge payload used by the recovered 283-operation sync candidate, then project only preview-safe spatial data through the existing INHA WORLD Runtime Adapter without granting gameplay authority.

**Architecture:** Add a pure capability validator beside the current Runtime Adapter. It recognizes only extension keys and rule types actually present in the recovered WorldForge candidate, classifies them as preview, metadata, or external-authority, and fails closed on unknown `inhagame.*` capability. A separate preview projection converts safe building/path data into the existing WorldDocument 0.1 contract; gameplay rules remain descriptive and are never executed.

**Tech Stack:** Node.js ESM, existing INHA WORLD WorldDocument/Runtime Adapter, node:test, GitHub Actions.

**Spec:** Current INHA WORLD World Schema v0.1, Runtime Adapter P0 v0.1, World Pipeline Integrated Architecture v0.1, and the recovered WorldForge 283-op candidate.

## Global Constraints

- GitHub `aldol2678/inhagame` current `main` is implementation authority.
- Preserve stable IDs and unknown data; do not infer gameplay meaning.
- WorldForge does not own server progression, rewards, economy, quest completion, or account state.
- Unknown `inhagame.*` capability fails closed before preview.
- Preview uses the existing Runtime Adapter path, not a second renderer/runtime.
- Do not Apply/Publish WorldForge drafts or touch Production state in this task.

## Review Focus

- Unknown INHAGAME extension key must not silently preview.
- Known external-authority gameplay rules must validate but never execute.
- Building geometry with malformed/non-finite footprint must fail capability validation.
- Coordinate conversion must occur exactly once and preserve IDs.
- Metadata-only extensions must not create runtime behavior.

---

### Task 1: Capability validator

**Files:**
- Create: `apps/world/src/runtime-adapter/worldforge-capabilities.mjs`
- Test: `apps/world/tests/worldforge-capabilities.test.mjs`

**Interfaces:**
- Produces: `validateInhagameWorldForgeCandidate(candidate)`
- Produces: stable diagnostics and per-capability classifications.

- [ ] Write failing tests for all currently used extension keys/rule types, unknown INHAGAME rejection, malformed geometry, and external-authority classification.
- [ ] Run the focused test and confirm RED for missing implementation.
- [ ] Implement the minimal validator.
- [ ] Run focused test and confirm GREEN.

### Task 2: Preview-safe projection

**Files:**
- Create: `apps/world/src/runtime-adapter/worldforge-preview.mjs`
- Test: extend `apps/world/tests/worldforge-capabilities.test.mjs`

**Interfaces:**
- Consumes: successful capability validation.
- Produces: `projectWorldForgePreview(candidate)` returning a WorldDocument 0.1 snapshot consumable by `loadWorldDocument()`.

- [ ] Add failing tests proving building/path projection, one-time coordinate conversion, ID preservation, and exclusion of external-authority rules.
- [ ] Run focused test and confirm RED.
- [ ] Implement minimal projection using existing WorldDocument semantics.
- [ ] Run focused test and confirm GREEN.
- [ ] Exercise the projected fixture through the actual Runtime Adapter.

### Task 3: Verification and handoff

**Files:**
- Create: `docs/implementation/worldforge-inhagame-capability-validation.md`

- [ ] Run focused WorldForge/runtime tests.
- [ ] Run the repository's public CI workflow through the PR.
- [ ] Record the current connector limitation: WorldForge MCP exposes validate but no capability-validator registration or preview/apply action.
- [ ] Re-read PR head and workflow results before any completion claim.
