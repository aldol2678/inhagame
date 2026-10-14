# Campus Growth and Local Graduate Records
Base: 25783ea1958385dc133bce99b18d6cc5e7685ed0. Implementation candidate; no merge/deployment authorized by this change.

## Scope
- Browser new games explicitly request grow2-campus-growth-1. Prior saves stay unchanged: absent growth means legacy, unknown/malformed growth fails closed.
- Reuse each of 12 existing major action names. At the start of each term choose exploration (analysis), making (creative), or teamwork (collaboration). No extra event pauses. First completed week locks the plan; unselected plans default to exploration.
- Completed weeks 5/10/15 grant +1 to the selected competency, before semester GPA/ending calculation. No RNG draws added. Week count and term plan are the milestone ledger; rewards run only inside completeWeek, never render/load/pending-event handling.
- Six competency bars, 24 derived activity milestone cards per graduation, original choice memory cards, six record-derived traits. Cards/traits do not grant additional stats.
- Existing 120 weeks, eight terms, 19 expanded-story choices and 17 legacy choices retained.

## Local archive
- Separate key induck-grow-v2-graduates-1 / schema grow2-graduates-1. Stores completed summaries, semester GPAs, cards, traits, epilogue; never account/World/economy.
- Maximum 50 distinct summaries, 2 MiB encoded string guard. Identical summaries deduplicate; this is not a distinct-run counter.
- Completion and completed-save load attempt archival. Retry/refresh UI is available. Completed snapshots must be archived successfully before replacement.
- Primary malformed saves retain the existing explicit replacement-confirmation contract. A read-permission failure remains write-blocked temporary play. Malformed archives are always preserved.
- Archive is written and read back before a new game replaces the primary save. Existing valid save replacement writes and reads back before changing in-memory current. Failures show a warning; malformed archives are not repaired, filtered, deleted or overwritten.
- Re-read/compare guards reduce stale-tab loss but localStorage has no multi-key transactions or full simultaneous-tab concurrency guarantee. Use one active playing tab. Browser clearing/uninstalling storage still loses local records; no cloud backup. JSON export is a user-triggered browser download request; download completion is not observable and JSON import is not included.
- 50-record cap preserves all existing records and blocks unarchived completed-life replacement; no automatic eviction. User-triggered JSON backup and confirmed selective deletion allow freeing a past-record slot, then retrying current graduation archival.
- Ranking is ONLY locally stored completed records, grouped by engine/content/growth version and major. Equal displayed GPA ties at ranks 1,1,3. Different seeds/policies are not equal-difficulty proof. No online leaderboard or authority claim.

## Validation boundary
Development checks use an in-memory JS loader, structuredClone/assert shims, not Node or browser.
Node tests are included in the existing Grow test command; existing public CI runs them.
Required browser QA remains: desktop/mobile portrait/landscape, activity selector keyboard/touch, card overflow, archive details/ranks, storage denial warnings, reload, new-game cancellation and retention.
No CI scope/workflow changes, no Work/Codex executor, no Production/DB changes.

## Pre-merge refinements
- Next milestone countdown uses completed weeks, so pending week5/week10 events do not skip a reward. Shows maximum +1 and the100 cap.
- Recent competency deltas compare rendered snapshots; no stats/RNG changes. First game display resets the delta baseline.
- Six trait conditions/current progress use the same pure derivation as earnedTraits; legacy-only unavailability is explicit.
- JSON backup validates the whole archive, never silently exports only valid rows. No external uploads.
- Delete is initiated by the user and requires an explicit window.confirm warning about irreversibility and backup. Uses exact serialized record identity, rejects duplicate matches and stale reads, reads primary again before writing. Never deletes the primary save.
- Current in-memory or saved graduation cannot be deleted until a new game starts; this prevents auto-archival resurrecting a deleted current record. With50 full records, delete a past record, retry graduation archival, then start a new game.
- Concurrent-tab atomicity is still not guaranteed by localStorage; guards are best effort. Unknown write/readback outcomes are reported as unconfirmed, not retried automatically.
- Actual download, confirmation-dialog touch/keyboard/focus and mobile layout still require browser QA.


## 생활 활동 / 재화 소비 (grow2-life-spending-1)

신규 브라우저 게임만 opt-in. 기존 저장·기존 성장 기록은 그대로 유지한다.
주차별 여가 슬롯 하나: 선택/변경은 결제하지 않으며 completeWeek에서만 정산하고 none으로 초기화한다.
사건 대기 중에는 변경/결제하지 않는다. 사건 후 돈이 부족하면 자동 취소하고 기본 생활 방침으로 진행한다.
실제 화폐·월드 인덕코인·DB·계정·온라인 랭킹과 연결하지 않는다.

- 생활 방침 집중: 무료, 기존 주간 처리 그대로.
- 산책: 무료, 체력+5 스트레스-5 회복역량+1.
- 식사: 6,000원, 체력+14 스트레스-3.
- 휴식/생각 정리: 무료, 체력+10 스트레스-7.
- 전시/감상 정리: 10,000원, 체력-3 스트레스-8 창의+1.
- 친구와 식사/대화: 8,000원, 체력+3 스트레스-8 협업+1.
- 전공 작품: 15,000원, 체력-8 스트레스+4 실행+2.
  분석/창의/협업 평균50이상일 때 +3. 학과별 대표 활동과 함께 이용한다.

시간 비용은 같은 주 생활 방침의 기본 역량 성장을 50%로 줄이는 방식이다.
양수 주간 수입도 50%로 감소한다 (work18000→9000, balanced2000→1000). 음수 지출/기본생활비4000/기본 피로/전공보상은 유지한다. 이는 학습과 수입 기회비용이며 정확한 시간단위 시뮬레이션은 아니다. 역량이 상한이면 해당 역량의 기회비용은0이다.
최근2주 같은 활동 횟수에 따라 유익한 효과100/75/50%, 돈과 체력손실/스트레스증가 비용은 그대로.
체력30미만 또는스트레스75이상이면 관람/친구/제작 역량보상 절반.
산책/휴식은 회복역량25마다 체력+1 추가. 모든 수치0~100.
학점 직접구매 없음; 기존 분석/실행/스트레스 학점 계산식에 간접 반영.
관계 NPC/개별친밀도는 이번 범위에 추가하지 않았다. 친구 활동은 기존 협업 역량 사용.
각 활동 첫 경험만 기억카드(최대6장), 전체120주 ledger 검증.
졸업 요약 economy 버전으로 기존 기록과 순위그룹 분리. 이전 summary는 그대로 읽는다.

가격/효과는 초기 튜닝값. 최적전략/장기 경제 밸런스는 확정하지 않는다.
신규11개 테스트: opt-in, 주간원자처리, 사건/재로드/잔액부족, 무료/반복/회복,
프로젝트/피로/상한, 손상저장, 12학과120주 재로드, 기록실 버전격리.
메모리 JS 실행과 실제 Node CI를 구분한다. 실제 브라우저/모바일 QA는 별도 미검증.

활동효과 상한 적용 후 루틴 처리. 미리보기는 활동 단독 최대치이며 현재 잔액 기준. none 주도 최근2주 감쇠에 포함. 소수역량은 소수2자리 보존.
