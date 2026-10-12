# Phone Messages UI change: selective CI impact policy

## Purpose
A change to the World entrypoint `apps/world/src/main.js` triggers many unrelated
browser suites. Keep their existing workflow and job/check names but avoid costly
browser installs and full-scene runs for an **unambiguously isolated** member
Messages UI change.

This is a narrow, fail-closed optimization, not a blanket removal of
`main.js` from path filters.

## Scope
The guard `.github/ci/phone-surface-scope.mjs` is used by exactly eleven
independent browser workflows:

- Graphics integration
- Biryong cloud-save recovery
- World Main 2 recovery
- NPC shop routing
- Cooking candidate
- Room transition recovery
- Quest journal controls
- Asset runtime
- Player activity audio
- Student center integrated campus
- Biryong map and NPC guidance

The following remain **unconditionally gated by their current triggers**:
required Public `verify` (including scope/source/database decisions),
Smartphone Chromium, Photo Mode, Housing, Life Housing, Mounted Photo + Maps,
Private Character, World stability, and the World asset optimizer. This keeps
cross-domain Phone ownership and safety regressions visible.

Each guarded workflow still creates its existing GitHub check. When the guard
reports `skip=true`, its checkout + lightweight impact evaluation succeed
without installing a browser or uploading a non-existent evidence artifact.
`skip=false` performs the **complete existing** tests and retains failure
artifacts. A skipped expensive step must never be reported as having passed
its underlying browser assertions.

**Important:** GitHub may still display all workflow cards because `on.pull_request.paths`
still observes `main.js`. The benefit is lower browser-compute use, not
necessarily fewer workflow names.

## Only permitted fast path
- Exact PR head equals the checked-out commit.
- Base SHA exists locally and is an ancestor of the head; checkout fetch depth
  is bounded to 20. Older branches, divergent bases and incomplete history
  run full checks.
- PR title is known and is not a release, hotfix or `[full-ci]` override.
- Every changed path is one of the explicitly reviewed Phone member-Messages
  implementation, styling or test files.
- If `src/main.js` changed, its **entire** diff must consist of exactly the
  reviewed two *additions* in player-card message handoff:
  `playerCard.close();` and
  `if (smartphone?.openMessages?.(userId)) return true;`.
- Renames, deletes, type changes, other application code, migrations, shared
  shell/input, changed workflows and CI policy itself force full checks.

Generic Phone changes are *not* automatically considered safe. This includes
changes to the Phone shell, input focus, Photo Mode, map ownership, Room or
server permissions.

The first PR that introduces or changes the guard/workflow definitions
itself exercises the full affected suites. The pre-existing #357 included a
Phone browser workflow edit, so the same classifier would conservatively run
its full QA even if applied to that unchanged diff. It never retroactively
changes #357's recorded CI result.

## Required verification
- `node --test .github/ci/public-ci-scope.test.mjs .github/ci/phone-surface-scope.test.mjs .github/ci/phone-surface-scope-contract.test.mjs`
- Full exact-head PR checks, workflow YAML validation, all existing check
  contexts and optional artifact handling remain healthy.
- Reproduce a *future* Messages-only PR without a workflow change: validate
  guard log `skip=true` for only these 11 workflows, their completed success
  job status, and the full non-scoped safety gates.
- Add a changed gameplay, SQL or arbitrary `main.js` hunk: all eleven
  guards must return `skip=false` and run unchanged QA.
- Before merging any release/hotfix, use the full check set; `[full-ci]`
  in the PR title provides an explicit opt-out of this fast path.

No Production, permissions, deployment, release, or existing feature PR is
modified by this policy without an independently reviewed merge.
