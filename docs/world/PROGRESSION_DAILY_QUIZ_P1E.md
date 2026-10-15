# Progression / Economy P1e · Campus Daily Quiz (first repeatable reward loop)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| `reward.daily.campus_quiz` (+50 인덕코인, +25 EXP) | **IMPLEMENTED** |
| Server-owned daily session (Asia/Seoul day, 3 questions, 2+ correct = PASSED) | **IMPLEMENTED** |
| ☰ menu entry + panel + reward toast (client) | **IMPLEMENTED** |
| Question bank | 16 ACTIVE questions |
| Streaks, retries, leaderboards, a world building for the quiz | NOT DONE (out of scope) |

## Loop

Once per **Asia/Seoul** day, a permanent signed-in account can play one session of 3 distinct
questions. With 2 or 3 correct answers the session is **PASSED** and runs
`reward.daily.campus_quiz`. With 0 or 1 correct it is **FAILED** and gives nothing. There is no retry
on the same day; the next KST day opens a new session.

| Position | Grant | Target | Amount |
| --- | --- | --- | --- |
| 0 | CURRENCY | `currency.induck_coin` | 50 |
| 1 | EXP | `exp.campus` | 25 |

Balance, starting from the end of onboarding (200 EXP, Lv.2, 180 coins):

- Day 1 → 225, Day 2 → 250, Day 3 → 275, and Day 4 → 300 EXP, which is **Lv.3**. On that day the reward
  toast is followed 150 ms later by `LEVEL UP · Lv.3`.
- Coins grow by 50 per passed day. Shop prices run from 120 (mug) to 650 (mini 인덕이), so one daily
  reward does not flood the shop economy.

## Authority

The server owns everything that decides value.

| Decision | Owner |
| --- | --- |
| Which day it is | `private.world_daily_quiz_today_v1()` = `(now() at time zone 'Asia/Seoul')::date` (DB clock) |
| One session per day | `private.world_daily_quiz_runs`, unique `(user_id, reward_date)` |
| Which 3 questions | the start RPC picks 3 distinct ACTIVE questions (`order by gen_random_uuid()`) and stores them on the run |
| Correct answers | `private.world_daily_quiz_questions.correct_index`, never returned and not readable by anon / authenticated |
| Scoring, PASSED / FAILED | the answer RPC |
| Reward | `private.world_reward_grant_v1` in the same transaction as the final answer |

The browser can send only:

- a start request, with no arguments;
- for each question, `(p_run_id, p_question_id, p_answer_index 0..3)`.

No public RPC takes a date, time, timestamp, user, score, success flag, reward id or amount. A browser
clock or timezone change cannot open a new session. Browser QA confirmed this with `Date` moved
3 days ahead and the timezone set to `Pacific/Kiritimati` (UTC+14): the page still received the same
PASSED run.

Unlike Main1 / Main2 (client-originated place and movement events, soft evidence), no client
evidence decides this reward. That is why it can repeat daily.

## Schema (`20261001213132_public_baseline.sql` (private `20260929113253_world_daily_quiz_p1e`))

- `private.world_daily_quiz_questions`
  - Columns: `question_id`, `status` (ACTIVE / DISABLED), `position`, `category`, `prompt`, `options`,
    `correct_index` (0..3), `version`, `created_at`.
  - `options` must be a JSON array of exactly 4 strings.
- `private.world_daily_quiz_runs`
  - Columns: `run_id`, `user_id` (cascade on account delete), `reward_date`, `status`
    (ACTIVE / PASSED / FAILED), `question_ids` (exactly 3), `answered_count`, `correct_count`,
    `started_at`, `completed_at`, `reward_transaction_id`.
  - A check constraint ties `status` to the counts. For example, PASSED requires 3 answers,
    `correct_count >= 2` and a reward transaction; FAILED requires fewer than 2 correct and no reward.
- `private.world_daily_quiz_answers`
  - Columns: `(run_id, question_index)` as the primary key, `question_id`, `selected_index`, `correct`,
    `answered_at`.
  - The primary key allows exactly one answer per question.
- All three tables have RLS enabled and every grant revoked from public / anon / authenticated.

## Player RPCs (authenticated only; caller = `auth.uid()`)

| RPC | Does |
| --- | --- |
| `get_my_world_daily_quiz_v1()` | Today's state: `AVAILABLE` / `ACTIVE` (with the current question) / `PASSED` / `FAILED`. Never creates a run. |
| `start_my_world_daily_quiz_v1()` | Creates today's run if none exists, otherwise returns the existing one. Concurrent starts share one run. |
| `answer_my_world_daily_quiz_v1(p_run_id, p_question_id, p_answer_index)` | Answers the current question of the caller's ACTIVE run for today. |

Every call requires a permanent account (the JWT is not anonymous and `auth.users.is_anonymous` is
not true) that is not banned. Every write takes the per-account advisory lock
`world_daily_quiz:<uid>`.

The answer RPC refuses with these codes:

- `QUIZ_RUN_NOT_FOUND`: the run is unknown or belongs to another account (the two cases look the same).
- `QUIZ_RUN_EXPIRED`: the run is dated another day.
- `QUIZ_ALREADY_ANSWERED`: the question was already answered, including with a different index, or the
  run is closed.
- `QUIZ_QUESTION_MISMATCH`: the question is not the current one.
- `INVALID_ANSWER`: the index is not 0..3.

Response shape:

```json
{ "status": "ACTIVE", "rewardDate": "2026-09-29", "runId": "…",
  "progress": { "answered": 1, "total": 3, "correct": 1 },
  "question": { "questionId": "quiz.campus.mount_key", "index": 1, "prompt": "…", "options": ["F", "V", "Space", "M"] },
  "lastAnswer": { "questionId": "…", "index": 0, "selectedIndex": 3, "correct": true },
  "rewardPreview": [ { "grantType": "CURRENCY", "targetId": "currency.induck_coin", "amount": 50 },
                     { "grantType": "EXP", "targetId": "exp.campus", "amount": 25 } ] }
```

- `correctIndex` is never present. `lastAnswer` says only whether the submitted answer was right.
- `rewardPreview` is read from the server RewardDefinition, so the panel shows server amounts.
- Only the answer that makes the run PASSED adds `reward`: the Reward core result without server-only
  fields, the same shape as the P1c / P1d quest rewards.

## Atomicity and idempotency

- The third answer, `PASSED` and the Reward run in one transaction. If the Reward is not `SUCCESS` or
  `PARTIAL_SUCCESS`, `QUIZ_REWARD_FAILED` rolls all three back. The run stays ACTIVE with question 3
  open, and the answer can be submitted again. A run cannot be PASSED without its reward, and the
  table constraint also forbids it.
- A FAILED run never calls the Reward core.
- Reward key: `daily:campus_quiz:<user uuid>:<YYYY-MM-DD>`, where the date is the run's `reward_date`
  from the DB clock. Source is `MINIGAME` / `daily.campus_quiz`.
- Because the key contains the date, even a second run on the same KST date cannot pay twice: the
  Reward core replays the stored result. The DB test covers this.
- Concurrency, tested through PostgREST:
  - 8 simultaneous starts give 1 run.
  - The same answer sent 8 times gives 1 answer row.
  - The correct final answer sent 8 times gives 1 PASSED, 1 RewardTransaction, 1 coin ledger row and
    1 EXP ledger row.

## Question bank

The 16 questions use only facts that the current code and UI state:

- the currency name (`world_currencies`);
- the key help panel: F interact, E emote, M mount, V view;
- Main 1 objectives: 나나율 at the gate, 본관 앞 → 인경호, 가유담 at 인경호;
- Main 2 objectives: 5호관, pause/resume, return to 후문;
- the Shop panel title "학생회관 상점";
- the First Campus badge name, the cap's HEAD slot label ("머리"), Lv.2 = 100 EXP;
- the ☰ menu entries.

If one of these changes in the product, update or `DISABLED` the question.

## Client

- `apps/world/src/daily-quiz/daily-quiz-client.js`
  - Account-scoped with a generation counter.
  - Validates the state shape and reuses `npc-factory/quest-reward-shape.mjs` for the reward.
  - Allows one write at a time, so a duplicate click returns `BUSY` and is never sent.
  - After a refusal it re-reads the server state.
  - It uses no date, `Date.now`, `localStorage` or `Intl`.
- `apps/world/src/daily-quiz/daily-quiz-panel.js` reuses the shop / inventory panel styles:
  - AVAILABLE: 오늘의 퀴즈 · 3문제 중 2개 정답 시 보상 · 🪙 50 인덕코인 · ✨ 25 EXP · 퀴즈 시작
  - ACTIVE: 문제 N / 3 · four options · 정답이에요! / 아쉽지만 오답이에요.
  - PASSED: 오늘의 퀴즈 완료! · +50 인덕코인 · +25 EXP
  - FAILED: 오늘의 퀴즈 종료 · 내일 다시 도전할 수 있어요
- `main.js` wiring:
  - ☰ → 📚 오늘의 퀴즈, with its own BLOCKING_UI input owner (`daily-quiz`) and one modal at a time
    with Shop / Inventory / Wardrobe.
  - On reward it uses the existing Reward Toast Queue ("🎁 보상 획득 / +50 인덕코인 / +25 EXP"), then
    `progression.refresh("reward")` and `wallet.refresh("reward")`; there is no inventory re-read
    because the reward has no item.
  - LEVEL UP comes from the progression authority.
  - The Shop is not involved.

## Current acquisition summary (production RewardDefinitions)

| Source | Reward | EXP | 인덕코인 | Items | Frequency |
| --- | --- | --- | --- | --- | --- |
| First Campus (Main 1) | `reward.quest.first_campus` v2 | +100 | 0 | 정문 첫걸음 배지 | once / account |
| Main2 navigation | `reward.quest.navigation_intro` v1 | +100 | +180 | — | once / account |
| **Campus Daily Quiz** | `reward.daily.campus_quiz` v1 | +25 | +50 | — | **once / KST day** (PASSED) |
| 캠퍼스 출석부 (P1f) | `reward.attendance.daily` + `reward.attendance.monthly_{3,7,14,21}` v1 | — | +10 / day; +30 / +50 / +100 / +150 at 3 / 7 / 14 / 21 days | — | once / KST day; milestones once / month ([PROGRESSION_ATTENDANCE_P1F.md](PROGRESSION_ATTENDANCE_P1F.md)) |
| MCM landlord first clear | `reward.minigame.landlord_first_clear` v2 | +50 | 0 | 건물주 챌린지 배지 | event / once |
| MCM main clear | `reward.event.mcm_2026_main_clear` v2 | +150 | +80 | 생존자 상의, 일일호프 포스터 | event / once |

## Tests

- `supabase/tests/database/80_world_daily_quiz_p1e.test.sql` (68 assertions):
  - bank shape and privacy; the definition and grants;
  - the KST boundary (14:59:59Z / 15:00:00Z);
  - anonymous / banned / permanent accounts;
  - start, same-day start, three distinct questions;
  - correct / wrong, double answer, changed index, wrong question / run / account;
  - PASSED +50 / +25 (200 → 225); FAILED without a reward call; replay;
  - the same-date second run replays; yesterday's run expires and a new day opens;
  - reward failure rolls back and the retry pays once;
  - the stable key, one row in each ledger, direct abuse, account-delete cascade.
- `01_grants_contract` lists the three new authenticated RPCs.
- `supabase/tests/integration/daily-quiz.integration.test.mjs` runs the real PostgREST path:
  - PASS 200 → 225 EXP and 0 → 50 coins, then replay;
  - FAIL; account and abuse checks (bank read, direct Reward RPC, foreign run, a `p_date` argument);
  - start ×8, the same answer ×8, and the correct final answer ×8.
- `apps/world/tests/daily-quiz.test.mjs` covers:
  - start, resume, correct / wrong, PASS / FAIL, the single reward callback;
  - the duplicate-click lock, stale generation / logout, malformed responses, refusal re-read;
  - panel rendering and `main.js` wiring.

`[REDACTED: production rollout and rollback procedure — maintained privately]`
