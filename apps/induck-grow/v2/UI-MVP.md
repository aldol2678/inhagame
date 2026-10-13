# INDUCK-GROW-V2-UI-MVP-01

Status: **Draft-only standalone preview**. This PR stacks on #372, which stacks on #369. No merge, Production deployment, account changes, DB migration, or INHA WORLD grant is authorized.

## What is implemented

- Static preview route candidate: `apps/induck-grow/v2/index.html` served from the Grow app's own public asset root (actual deploy path/rewrites must be verified independently before release).
- `ui.mjs`, `ui.css`: mobile-first view with accessible academic progress bar, temporary CSS duck avatar, policy menu, 1x/2x/4x/8x time controls, one-week advance, native-modal life event choices, 8-term GPA view, chronicle, memories, and graduation summary.
- Local `session.mjs` adapter runs the proven pure Life Engine from #372. Actions are turn-based, safely paused at choices and semester boundaries. Event choices only apply to offered options.
- Local saves are intentionally isolated under `induck-grow-v2-local-0.1`, envelope schema `grow2.local.preview.1`. No existing `induck-grow-p0`, cloud sync, account data, or WORLD wallet is read or changed. Invalid saves are preserved for possible recovery rather than deleted; new game explicitly requests confirmation before overwriting a detected save.
- The page is noindexed and has no navigation link from the live v1 app. It only becomes accessible if separately released later.
- The 36-major registry remains *provisional*: only 12 foundation majors are selectable. A four-year game is not advertised for unsupported medical/special curricula.
- `tests/ui-mvp.test.mjs`: headless session end-to-end runs across 12 majors, per-event pauses, 8 semester boundaries, save/resume, invalid saves, storage failures, protected namespace, and HTML/CSS semantics.

## Manual local smoke checklist (no Production)

1. Open `apps/induck-grow/v2/index.html` through a static HTTP dev server, not file://; test on phone width 360px and desktop >1024px.
2. Enter a valid uint32 seed and pick one of 12 majors, then start. Verify all controls are keyboard and touch accessible.
3. Advance to week 5: the event must pause at **4 completed weeks**. Select a valid option; the chosen memory must appear once.
4. Continue to week 6: major signature event, pause before week advancement.
5. Set 8x, check no background-tab progress, verify automatic stop on semester completion and academic summary modal.
6. Reach week 120, verify 8 semester summaries and graduation tab. Reload: page must remain paused at setup; click Continue to restore the same snapshot without autoplay.
7. Test stored JSON corruption and blocked storage; old v1 save remains unchanged.
8. Test focus visibility, tab selection, native-dialog keyboard behavior, reduced motion, portrait and landscape, and screenreader names.

## Explicit exclusions / gates

- No official art, audio, avatar rig, production route link, INHA WORLD sync, currency, rewards, DB, analytics, authentication, 36-major playable content, or real curriculum.
- Life Engine GPA, money and events are prototype abstraction only. This is not the final game design balance or realistic academic experience.
- Do not merge #372 or this PR solely because source CI passes. Stacked review order: #369 -> #372 -> UI-MVP PR, with retarget/review after each prior merge.
- Keep CI-SCOPE, required checks, and v1 regression suite as-is. One source CI on the final PR head is preferred; avoid repeated synchronization or unneeded reruns.
