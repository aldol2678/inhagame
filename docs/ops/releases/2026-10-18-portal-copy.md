# Release 2026-10-18 · Portal introduction

Release branch: `release/2026-10-18-portal-copy`
Base main: `e32d85a85a2fc7bea16b19e8322a6615e4ab5524`

## Candidate set

| PR | Scope | Admitted exact head | Candidate merge |
| --- | --- | --- | --- |
| #424 | Homepage introduction; no fixed game-count wording | `7b6c076c9b1bf0837f78aa4f1b023443c8f64d0e` | `178a9dc5023e3e8f84c38d7f817f5b9bbda32f38` |

Candidate admission evidence: required verify, full source, database and portal-browser checks succeeded in [run 39083722112](https://github.com/aldol2678/inhagame/actions/runs/39083722112). The exact-head portal screenshots and assertions cover widths 320, 390, 700, 768 and 1440. Mobile and desktop Hero/discover screenshots were inspected.

Application change: `apps/world/index.html` only. Preserve head metadata, PWA references, existing catalog cards, play URLs, CSS, JS, robots and sitemap.

## Explicit exclusions

- Old SEO Draft #370 is not included or modified.
- Other candidates are not implicitly admitted.
- The existing Vercel status failure for the independent induck-grow project at base main is not treated as a campus-portal release success or as a regression caused by this copy change.

## Production / DB boundary

No Production SQL, schema changes, environment or credential changes, backend traffic changes, feature activation, account/social changes or Search Console operations.

The sole Production target for this release is the existing campus portal at `https://inhagame.app/`. Other game deployments are outside the rollout scope.

## Integration and completion gates

The final release PR to main must pass required CI on its integrated release head before merging. Do not weaken scope detection, required checks or branch protections.

After merge, verify the expected main commit, a matching READY Vercel Production deployment, the custom-domain alias, the new public copy and preserved canonical/robots/sitemap responses. GitHub merge success alone is not Production completion. Record actual completion evidence in the release PR and its linked deployment.

## Rollback target

The previously verified READY Production serving base main `e32d85a85a2fc7bea16b19e8322a6615e4ab5524` is the rollback target until the new release is verified.
