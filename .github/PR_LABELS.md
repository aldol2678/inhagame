# Pull request labels (conservative pilot)

## Scope and rollout

This repository uses a metadata-only GitHub Actions workflow at `.github/workflows/pr-metadata-labels.yml`.
It is proposed in a separate PR, and **does not activate until merged into the default branch**.
The job uses `pull_request_target` with the trusted default-branch workflow and **never checks out or runs PR head code**.
The default `GITHUB_TOKEN` is limited to `contents: read`, `pull-requests: write`, `issues: write`.
No production credentials, CI thresholds, branch protection, deployments, or merge permissions are changed.

On new or updated open PRs targeting the default branch, labels are **added** based on a Conventional Commit title prefix and changed filenames.
The labels are namespaced `type:*` (one intended type) and `area:*` (zero or more areas).
Existing labels, including manually applied labels, are **never deleted, renamed, or recolored**.
If a PR title/file scope changes, earlier labels are deliberately not removed; manually review stale classifications.

`priority:P0` through `priority:P3` and `status:triage`, `status:waiting-ci`, `status:blocked`, `status:review`, `status:ready` are **manual-only**.
Do not infer CI success, release approval, priority, ownership, or safe-to-merge from a PR title.
A green label is not a substitute for the protected `verify` check, code review, or release admission.

## Operating the pilot

* After reviewing/merging the workflow PR, use **Actions → PR metadata labels → Run workflow** without a PR number to initialize any missing catalog labels.
* To classify an older open PR, run it again with its numeric `pr_number` (one at a time; no unreviewed bulk backfill).
* Opened/reopened/synchronized/edited/ready-for-review PRs are automatically classified thereafter.
* If an existing label has the same name, it is preserved as-is. Label descriptions/colors are only set for **new** labels.
* Manual `status:*` and `priority:*` values require human review and may be amended independently.
* Existing `verify` and world-specific CI workflows remain authoritative and unchanged.

## Examples

| PR metadata | Auto-added labels (examples) |
|---|---|
| `fix(world): adjust mascot shape`, `apps/world/src/character-model.js` | `type:bug`, `area:world`, `area:3d-assets` |
| `perf(world): reduce collision checks`, `apps/world/src/polygon-collision.js` | `type:performance`, `area:world` |
| `ci: improve browser gate`, `.github/workflows/foo.yml` | `type:ci` |

## Limits

The GitHub connector could not enumerate the existing repository label catalog during this change. This feature avoids collisions by checking names via the GitHub API at runtime and creating only missing entries. The workflow's first real execution and `GITHUB_TOKEN` label-creation permission require verification after merging. Do not bulk-label existing PRs until the pilot's first run passes.
