# INHA WORLD Lobby P2 · 오늘의 캠퍼스 (Daily Loop card)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Frontend presentation only. No new RPC, table, migration, Reward, localStorage or timer. It reads the two
existing member clients (P1e Campus Daily Quiz, P1f Campus Attendance) that `main.js` already binds to the
signed-in account, and opens their existing panels.

## Where

`world-lobby-entry-slot`, under the Main Gate CTA (quest highlight → Main Gate → **오늘의 캠퍼스** → resume →
Back Gate), so the quest highlight stays attached to the CTA it describes.

- ≤ 959 px: one compact row (~50 px at 360×740): title column + two launcher buttons.
- ≥ 960 px: out of flow, beside the entry column, so the avatar / Main Gate stack is pixel-identical to the
  lobby without the card.

## State mapping (`src/lobby/lobby-daily-loop.js`, `selectLobbyDailyLoop`)

Hidden when either client is `SIGNED_OUT` (guests never bind an account) or both are `UNAVAILABLE`.

| client | server snapshot | row |
| --- | --- | --- |
| Attendance | `LOADING` | `불러오는 중…` |
| Attendance | `READY`, `claimedToday=false` | `오늘 출석 전` (ACTIONABLE) |
| Attendance | `READY`, `claimedToday=true` | `오늘 완료 · 이번 달 {attendedDays}일` (COMPLETE) |
| Quiz | `READY`, `AVAILABLE` | `오늘 퀴즈 가능` (ACTIONABLE) |
| Quiz | `READY`, `ACTIVE` | `진행 중 · {answered}/{total}` (IN_PROGRESS) |
| Quiz | `READY`, `PASSED` | `오늘 완료` (COMPLETE) |
| Quiz | `READY`, `FAILED` | `오늘 종료` (CLOSED, never worded as success) |
| either | `UNAVAILABLE` / unusable snapshot | `확인하지 못했어요` (the other row still shows) |

Both rows loading → `오늘 상태 불러오는 중…`; both terminal (COMPLETE / CLOSED) → `오늘 할 일 확인 완료`
(wide layouts; no score).

## Behaviour

- Re-renders only from `attendance.onChange` / `dailyQuiz.onChange`. An account switch or sign-out drops the
  clients' snapshots (LOADING / SIGNED_OUT), so no previous account's text can remain.
- A button press calls `attendancePanel.setOpen(true)` / `dailyQuizPanel.setOpen(true)` and nothing else. The
  claim (`오늘 출석하기`) and the quiz start (`퀴즈 시작`) stay inside the panels. Opening a panel performs
  the panel's existing read-only refresh.
- `aria-controls` points at `attendance-panel` / `daily-quiz-panel`; `aria-expanded` mirrors the panel's own
  open state (`lobbyDailyLoop.setPanelOpen` from the panels' existing `onOpenChange`). No new InputFocus owner.

## Lobby panel visibility

The lobby shell hides Shop / Inventory / Wardrobe (`visibility: hidden !important`). Daily Quiz and Attendance
were never in that list and sit above the lobby (`z-index` 70, later in the DOM), so they open in the lobby
with no CSS change; the three hidden panels stay hidden. While a panel is open on a phone it covers the Main
Gate; close it (× / Escape) to continue.

## Tests

`apps/world/tests/lobby-daily-loop.test.mjs`: selector table, DOM card with the real clients over a fake rpc
(account switch / sign-out), launcher = no RPC, module has no RPC / Supabase / storage / timer / date, HTML +
`main.js` wiring.
