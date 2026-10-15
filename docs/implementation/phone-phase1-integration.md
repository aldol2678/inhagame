# Phone phase 1 integration

Local implementation candidate, 2026-10-15. Not merged or deployed.

## Source receipts

- Repository: `aldol2678/inhagame`
- Main: `139b9916e45defa4d611079f3d2d1e61445ce30d`
- Main tree: `277556ae86ca051e6a3f675126de0af916fc761d`
- PR #415: `41f040d4a86b0c27256172157343a4c5e7d5bb5e`
- PR #418: `1f70c11314829d0bbd8fdfb6549e0c231557a33f`
- PR #419: `68586603940289ef48adb0d5e49cd58227f84904`

The isolated local baseline was verified against every blob in the non-truncated main Git tree, including modes. Its `git write-tree` exactly matched the main tree above. Local snapshot commits are not the upstream commit ancestry. The integration patch is based on that exact main content. The three PR patches applied without conflicts; their heads were read back again before completion.

## Implemented

- Settings categories and a single Phone-owned vertical scroller, PWA shortcut icon declarations, and a responsive HUD drawer.
- Real Store catalog/Phone install and Home/Dock state from #418, preserving source/origin checks, save/readback acknowledgments and explicit failure.
- Visual motion on newly active surfaces, home paging, edit wiggle and wallpaper blur.
- Free-space exit from edit mode; keyboard/pointer hide confirmation and restore; verified save/readback before shrink; failed mutation rollback.
- Dock removal moves the existing shortcut to an available Home slot, creating a page only if needed. It does not hide or uninstall it.
- Explicit notification open/close handles with bounded gestures; ordinary app content scrolling does not trigger notification navigation.
- Reduced-motion handling and close, account, pagehide, visibility and destroy cancellation. App teardown and input release stay synchronous; no live iframe is retained for outgoing animation.

No folder persistence, mock runtime catalog, schema changes, database work, remote publication or deployment is included. Folder design remains phase 2; v1 preference normalization and Store page projection are unchanged in that respect.

## Regression diagnoses

#415 appended base styles and another landscape block after the final `LANDSCAPE-HUD` authority. Base rules now precede that authority, and the new nested layout is integrated into its existing landscape block. Exact two-block and final-authority guards remain enforced. Standalone settings positioning explicitly excludes Phone-hosted settings.

Old source and aggregate tests expected flat button-label text; they now verify the actual nested span labels, unique IDs and existing panel targets.

The original Graphics browser job reached a real UI failure: it attempted to select `#graphics-quality` while the new category home was visible. Browser samplers now navigate the real category button and assert visibility rather than forcing interaction with hidden controls. Runtime diagnostics, Daily focus and Boot jobs failed their preceding source checks, before their browser steps.

## Validation boundaries

Node behavior/source tests and aggregate World QA were run locally. Cross-app Classic/Grow/Survival tests, Induckup tests/typecheck/build, pinned Recast WASM integration, edge tests and migration static checks were also run. Existing dependencies were reused only after matching lockfiles; a fresh network install was not performed. No database migration or database service was started.

Final local results: World source/behavior **4,842/4,842**, including Phone **101** tests; aggregate `qa.mjs` passed. Recast **3/3**, Classic **11/11** plus static check, Grow **81/81**, Survival **17/17** plus static check, Induckup **91/91** plus TypeScript/Vite build, edge **35/35**, migration checker unit tests **18/18** and both static migration checks passed. Append-only comparison against upstream history was not available in the reconstructed local snapshot and was explicitly skipped by the migration linter; no migration files changed.

Browser samplers were syntax-checked and extended for new flows. Execution could not start: system Chromium failed with `socket() failed: Operation not permitted`, including an approved escalated attempt. No app page was reached. Browser visual, trusted-touch, physical Android/iOS PWA, safe-area and authenticated server integration results remain **UNKNOWN**. This is not a full required-CI pass or a merge-ready claim.

On a supported browser executor, run the exact-head Phone campus smoke plus Graphics, Runtime diagnostics, Daily focus and Boot suites. Check desktop, touch portrait/landscape, reduced/full motion, repeated interruption, account switch and pointer cancellation. Use offline fixtures; no production traffic is required.
