# 인하 오리 잡기 Classic

공식 릴리스: **v1.0.0**

- App directory: `apps/classic`
- Ruleset: 2.2
- Online ruleset: secret-2.2-r1

## Development

```bash
npm install
npm test
npm run check
npm run test:e2e
npm run serve
```

## Module layout

Static site, no build step. `index.html` holds the markup only (~22 KB) and loads, in this order:

| File | Contents |
|---|---|
| `classic.css` | all Classic styles (was the inline `<style>`), before `secret-session.css` |
| `secret-session.css` | Secret stage (월식 · 승천) styles |
| `badge-system.js` | badge tiers (`BadgeSystem`); injects the hub `game-entry.js` on the Classic hub host (`duck.inhagame.example` here) |
| `secret-run.js` | Secret run reducer (`SecretRun`), also unit-tested from Node |
| supabase-js (CDN) | `window.supabase` |
| `js/dom.js` | every `getElementById` the app keeps a handle to |
| `js/online.js` | Supabase client, account/auth, cloud progress sync, telemetry, ranked runs and recovery, leaderboard, event ranking |
| `js/game.js` | stages, save/migration, badges, QA tooling, the game (spawn, input, timers, Secret run, result) |
| `js/boot.js` | UI handler wiring and startup (account auth, event countdown, focus refresh) |
| `assets/annyongi.png`, `assets/indeoki.png` | character sprites (were inline data URIs) |

The four `js/*.js` files are **classic scripts, not ES modules**: they share one global scope
exactly like the former inline script, so tests and other scripts still see globals such as
`secretRun`, `runResult`, `STAGE_CONFIGS` and `progress`. Their order is part of the contract
(`tests/check.cjs` enforces it and compiles them as one program). Code that runs while a file
loads may only use what earlier files declare; later files are used only after load, from
handlers, timers and callbacks. Keep that rule when moving code between them.

### Contracts that must not change

- Storage: `inhaDuckProgressV2` (save), `inhaDuckStageProgressV8` (legacy, migrated),
  `inhaDuckAccountProgressV2:<userId>`, `inhaDuckSoundEnabled`, `inhaDuckRankedRecoveryQueueV1`,
  `inhaDuckRecoverySubmitted:<incident>:<userId>`,
  `inhaDuckBalanceQARunsV93`, `inhaDuckBalanceQATesterV1`, `inhaDuckTelemetryVisitorV1`;
  session: `inhaDuckTelemetrySessionV1`, `inhaDuckTelemetrySessionStartedV1`.
- Network: Supabase RPCs and `ranked-run-start` / `ranked-run-finish` / `verify-inha-mail`
  (all in `js/online.js`); hub attribution through the hub's `game-entry.js` (`https://inhagame.example/game-entry.js` here).
- DOM ids used by `game-entry.js`: `startBtn`, `countdownOverlay`, `homeGameBtn`,
  `endOverlay`, `resultState`, `restartBtn`.

### Remaining monolith

- `js/game.js` (~1,350 lines): stage/progress code and the game core cannot be split yet: the
  initial `renderStageGrid()` / `applyStage()` and the QA bypass run while the file loads and
  reach core functions (`showToast`, `setType`, ...) declared further down.
- `js/online.js` (~1,250 lines): account, telemetry, ranked and leaderboard code still share
  mutable state (`onlineUser`, `rankedSession`, `rankingMode`); splitting it needs the same
  load-time reachability check.
- `classic.css` (~76 KB) is one stylesheet; `index.html` still has a few inline `style=""`
  attributes in the footer.

## Tests

- `npm test`: Secret run and badge rules.
- `npm run check`: script order, one-program compile, DOM ids, sprite files, hub host and
  account contracts.
- `npm run test:e2e`: `game.spec.cjs` (full runs, migration, UX, account, four stages) and
  `characterization.spec.cjs` (hub entry, modals, restart, storage keys, page assets), desktop
  and 360 px mobile.

인하대학교 공식 서비스가 아닌 개인 제작 웹게임입니다.
