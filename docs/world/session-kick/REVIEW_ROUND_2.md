# 2차 독립 검토 보완 (E1~E5)

> 상태: 격리 로컬 검증 완료 · 미배포 · 미병합 · **PR 미생성**. 운영 DB·배포·권한·설정·`main`·기존 PR은 변경하지 않았다.
> 1차 수정안(`5882ce2`)은 유지하고 그 위에 쌓았다. 1차 내용은 [README.md](README.md).

## 0. 전제 정정 — 감사 F01~F09 원문

요청에는 “이 대화에 제공된 기존 감사의 F01~F09”라고 되어 있으나, **이 대화에는 F01~F09 원문이 제공된 적이 없다.** 요청 본문이 내용을 설명한 **F06, F08, F09만** 대응시켰다. 나머지(F01~F05, F07)는 어떤 결함인지 알 수 없으므로 **대응 UNKNOWN**으로 두었다. 번호를 추측해서 채우지 않았다. 원문을 주시면 아래 표의 “감사 ID” 열만 채우면 된다.

## 1. D1~D9 ↔ F 대응표와 상태

| 내부 ID | 결함 | 감사 ID | 상태 |
|---|---|---|---|
| D1 | v1 heartbeat에 차단 판정 없음 | UNKNOWN | 수정·로컬 검증 (1차) |
| D2 | heartbeat 검사 통과 후 kick이 먼저 커밋 → 유령 세션 | UNKNOWN | 수정·로컬 검증 (1차) |
| D3 | kick 트랜잭션이 열린 동안 heartbeat 수락 | UNKNOWN | 수정·로컬 검증 (1차) |
| D4 | 계정 소유 세션 UUID 탈취·게스트 강등 | UNKNOWN (F09와 인접) | 수정·로컬 검증 (1차) |
| D5 | 예외로 롤백되는 “방어적 cleanup” | UNKNOWN | 제거 (1차) |
| D6 | 클라이언트 timeout 한 번에 영구 종료 | UNKNOWN | 수정 (1차). **원본 테스트 2개 계약 변경 — 소유자 결정 필요** |
| D7 | 인증 세대·늦은 REVOKED | UNKNOWN | 수정 (1차) |
| D8 | 관리자 UI가 수락/확인/종료를 뭉뚱그림 | UNKNOWN | 수정 (1차), **E4로 보강** |
| D9 | Realtime 정책에 차단 조건 없음 | UNKNOWN | 초안만. **실제 Realtime 검증 전 UNKNOWN** |
| **E1** | `PostgrestBuilder`가 thenable → 한 pulse에 HTTP 2회 | (번호 없음) | **수정·실물 라이브러리로 검증.** 1차 커밋(`5882ce2`)이 도입한 회귀 |
| **E2** | 종료 후 `getSession` 응답·예약 콜백이 새 Realtime 채널 생성 | **F06** | 수정·fake Realtime으로 검증 |
| **E3** | 허용 상태를 확인 못 한 연결이 무기한 유지 | (번호 없음) | 계약 설계·구현·검증 |
| **E4** | roster 100개 상한 → 부재를 종료 증명으로 오판 | **F08** | 수정·실제 DB/UI 검증 |
| **E5** | 게스트 행은 소유자가 없어 UUID만 알면 변경·승계 가능 | **F09** | **잔여 결함 재현 → 방어 심화 수정.** 인증 경계는 아님 |

## 2. 항목별 RED → GREEN

“RED”는 변경 전 코드/DB에서 실패를 직접 확인한 것, “GREEN”은 변경 후 통과다.

### E1 — thenable 이중 실행 (요청 1)

- **원인**: `PostgrestBuilder.then()`은 호출될 때마다 새 `fetch`를 실행한다(postgrest-js 1.21.4 소스 확인). 1차 코드는 `Promise.resolve(request)`와 `Promise.race([request, …])`에 같은 빌더를 넘겨 **같은 쓰기를 두 번** 보냈다. “한 계정의 쓰기는 한 번에 하나”라는 직렬화 가정도 깨는 결함이다.
- **RED (실물)**: 실제 `@supabase/postgrest-js` + 요청 수를 세는 `fetch`로 현재 heartbeat를 돌려 **pulse 1회 = HTTP 요청 2회**. 저장소 테스트(정확한 더블)도 이전 커밋 코드에서 3건 실패.
- **수정**: 빌더를 **한 번만** Promise로 바꾸고 모든 관찰자가 그 하나를 공유.
- **GREEN**: 실물 라이브러리 **HTTP 1회**. 신규 테스트 3건(성공 / timeout·abort / REVOKED 응답 모두 실행 1회) 통과.
- 한계: CI에 postgrest-js를 추가하지 않았으므로 저장소 테스트는 “then마다 실행”을 재현한 더블이다. 실물 확인은 scratch 스크립트로 했고 커밋하지 않았다.

### E2 — 종료 후 연결 생성, F06 (요청 2)

- **원인**: `refreshAuth → startFor`가 `getSession` **응답 후에** `++startEpoch`로 새 세대를 받아, `stop()`이 올린 세대 검사를 우회했다. `stop()` 전에 예약된 `onAuthStateChange`의 `setTimeout(0)` 콜백도 `stop()` 이후 `refreshAuth`를 호출했다.
- **RED**: 5개 시나리오 중 3건 실패 — (a) 지연된 `getSession`이 stop 후 도착, (b) stop 직전 예약된 인증 콜백, (c) stop 후 명시적 `refreshAuth()`. (게스트 로그인 지연·프로필 조회 지연 경로는 원래 안전했고 회귀 방지용으로 포함.)
- **수정**: 연결 생성 경계를 한 곳으로 제한.
  - `stopped`(terminal) · `suspended`(복구 가능 보류) · `startEpoch`(세대)로 `mayConnect(epoch)` 판정.
  - 세대는 `getSession`을 **기다리기 전에** 발급한다. `startFor`·`startGuest`는 모든 await 뒤에 재검사.
  - `openSession()`이 최후 방어선: stop/suspend 상태면 transport를 만들지 않는다(`false` 반환, 호출부가 처리).
  - 예약된 인증 콜백, `pageshow`, `refreshAuth`는 `stopped`면 아무것도 하지 않는다.
- **GREEN**: 5/5. 기존 online 관련 테스트 72건(`world-resume-auth-lifecycle` 포함) 모두 통과.

### E3 — 허용 상태 미확인 연결의 유예·종료·복귀 (요청 3)

heartbeat timeout은 계속 **복구 가능**하다(1차 계약 유지). 대신 “성공한 heartbeat = 서버가 아직 이 계정을 허용한다는 유일한 증거”로 보고 유예를 둔다.

| 상황 | 동작 |
|---|---|
| 성공 heartbeat | 증거 갱신, 유예 창(60초 = heartbeat 3회) 재시작 |
| 60초간 성공 없음 (timeout·네트워크·RPC 오류) | `onUnverified` **한 번** → Realtime **보류**(`online.suspend()`): 세션·채널 해제, 어떤 경로로도 새 연결 불가 |
| 보류 중 heartbeat는 계속 시도 | 반복 알림 없음 |
| 보류 중 성공 | `onVerified` → `online.resume()` → 일반 인증 경로로 재연결 |
| 서버가 `WORLD_SESSION_REVOKED` | **terminal**(`stop()`), 어떤 경우에도 복귀 불가. 보류 중이어도 동일 |
| 로그아웃 방문자 | 차단될 수 없으므로 보류 대상 아님 |
| BFCache 캐시 중 | 유예 정지, 복원 시 새 유예 창 |
| 계정 전환 | 새 계정은 아직 미검증 → 새 유예 창 |

- “서버에 닿지 않음”은 **절대 철회로 간주하지 않는다.** 보류만 하고, 철회는 서버가 REVOKED라고 답했을 때만 terminal이다.
- 유예는 **opt-in**(콜백 제공 시에만 타이머 생성)이라 기존 heartbeat 계약·테스트는 변하지 않는다. `main.js`는 `world-session-guard.js`로 연결한다.
- **RED**: 이전 커밋 코드에서 heartbeat가 10분(30회) 연속 실패해도 **Realtime 채널 1개가 그대로 유지**, `suspend` API 없음.
- **GREEN**: 단위 8건(유예 갱신, 1회 알림, 복귀, timeout 후 미확인, 게스트 제외, 철회 후 terminal, BFCache, 계정 전환) + 실제 `world-online`·heartbeat·가드를 함께 쓰는 합성 7건(보류 중 인증 이벤트·`refreshAuth`로도 채널 0, 복귀, 철회 terminal, 진행 중 시작과 suspend 경쟁).
- **한계(정직하게)**: 첫 heartbeat 성공 전에도 Realtime은 연결된다(최대 유예 시간). 이 구간의 신규 join 차단은 서버 정책의 몫이며 **UNKNOWN**이다(§4).

### E4 — roster 100개 상한, F08 (요청 4)

- **원인**: `get_world_session_admin_v1`은 계정 100개·차단 100개로 자른다. UI는 “목록에 없음”을 “세션 종료/차단 해제”의 증거로 썼다. 차단 목록은 `blocked_until` 오름차순이라 방금 건 **긴 차단이 오히려 잘릴 수 있었다.**
- **RED (DB)**: 계정 130개를 활성 상태로 만들고 roster 호출 → **100개만 반환, 접속 중인 계정 #2 누락, 잘림 신호 없음.** (UI) 같은 시나리오에서 이전 UI 테스트 9건 실패.
- **수정** (`20261010130000_world_session_admin_readback.sql`, 함수만):
  1. roster에 `accountsTotal`·`accountsTruncated`·`blockedTotal`·`blockedTruncated` 추가(기존 키 불변).
  2. 차단 목록을 `created_at desc`로: 방금 건 차단이 상한에 잘리지 않음.
  3. `get_world_session_admin_target_v1(uuid)`: **상한 없는 한 계정 정확 조회**(`sessionRows`·`activeSessions`·`blockedUntil`). `sessionRows`는 오래된 행도 센다 — kick이 전부 삭제하고 차단 계정은 새로 만들 수 없으므로, **0이어야만 “종료” 증명**이다. 같은 관리자 권한 검사, `authenticated`에만 EXECUTE.
- **UI**: 명령 후 정확 조회를 먼저 하고 그 결과를 증거로 쓴다. 정확 조회가 없을 때(구서버)는 목록이 **잘리지 않았다고 확인되는 경우에만** 부재를 증거로 인정한다. 그 외는 “확인할 수 없음”(`*Unknown`)이며, `*Confirmed`는 **증명될 때만 true**(기존 불리언 계약 유지). 요약에 “목록은 상한 100개만 표시” 안내.
- **GREEN**: SQL 통합 6/6(105계정 실제 행, 상한·총계·정확 조회·최신 차단 우선·권한·읽기 전용 지문), UI 10/10, pgTAP 보강.
- 한계: **100명 넘는 계정은 UI에서 kick 버튼 자체가 없다**(페이징 미구현). 조회만 정확해졌다. 미해결로 분류.

### E5 — 게스트 UUID 소유권과 로그인 승계, F09 (요청 5)

동시성을 포함한 공격 매트릭스 8개를 실제 DB에서 돌렸다.

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 두 계정이 같은 게스트 행을 동시에 승계 | 정확히 한 명만 성공, 다른 쪽 거절 — **안전** |
| 2 | 게스트 쓰기가 승계와 경쟁 | 승계가 지워지지 않음 — **안전** |
| 3 | 승계 중 같은 계정 kick (승계 먼저) | 행이 남지 않음 — **안전** |
| 4 | kick 트랜잭션이 열린 동안 승계 시도 | `WORLD_SESSION_REVOKED`, 게스트 행 불변 — **안전** |
| 5 | 차단된 익명 인증 신원 (v1·v2) | 둘 다 거절 — **안전** |
| 6 | 승계된 행의 강등/타 계정 이전 | 모든 순서에서 거절 — **안전** |
| 7 | 거절된 탈취가 피해 행을 건드리는지 | 방문자 ID·존·공간·시작 시각 불변 — **안전** |
| 8 | **다른 브라우저가 UUID만 알고 게스트 행을 덮어쓰기/승계** | **재현됨(RED)** |

- **결론: F09는 남아 있었다.** 게스트 행은 소유 계정이 없어, UUID를 가진 누구든 방문자 ID·존·공간을 바꾸거나 로그인 승계로 가로챌 수 있었다(1~7의 소유권 검사는 *계정이 있는 행*만 보호).
- **수정** (`20261010140000_world_session_guest_binding.sql`, 코어 함수 재정의): 행에 방문자 ID가 있으면 **같은 ID를 제시한 호출만** 접근한다(ID가 다르거나 없으면 `WORLD_SESSION_OWNER_MISMATCH`, 클라이언트는 이미 UUID를 회전해 재시도). 같은 페이지의 정상 로그인은 같은 방문자 ID를 제시하므로 영향 없음.
- **GREEN**: 8/8.
- **정직한 한계**: 방문자 ID는 분석용이라 “인증”이 아니다. 방문자 ID가 한 번도 없던 행(v1 클라이언트, 저장소 없는 브라우저)은 **여전히 미바인딩**이다. 122비트 난수 UUID에 기대는 방어 심화이며 인증 경계가 아니다.

## 3. 기존 회귀 결과 — 약화 여부

| 비교 | 결과 |
|---|---|
| 원본(main `acd54a7`) 관련 4파일 34건을 **새 코드에 그대로** | **32 통과 / 2 실패.** 실패 2건은 1차에서 이미 고지한 timeout 영구 종료 계약(D6). 소유자 결정 대기 |
| 1차 커밋 `5882ce2`의 관련 4파일 51건을 새 코드에 그대로 | **50 통과 / 1 실패.** 실패 1건은 분류 객체 단언 `deepEqual`: 이번에 **필드가 추가**(`blockUnknown`·`heartbeatUnknown`·`evidence`)되어 형태가 바뀜. 기존 불리언 값의 의미는 그대로 |
| 1차 커밋의 pgTAP `61_*` 63건을 최종 DB에 | 63/63 통과 |
| 최종 Node 관련 파일 | heartbeat 39 · hub-world-sessions 14 · online-connection-state 7 · population-count 2 · 신규 terminal 5 · 신규 합성 7 · 신규 roster 10 — 전부 통과 |
| `apps/world/tests/*.test.mjs` 전체 | **3960 통과 / 0 실패** (1차 3927) |
| `supabase/tests/edge` / `.github/ci` / `apps/world/qa.mjs` / 마이그레이션 린트(2종) | 35 / 74 / 통과 / 통과 |
| SQL 통합(3종) | kick 9 · admin-readback 6 · guest-claim 8 — 전부 통과, 잔여 행 0 |
| pgTAP `61_*` (shim) | **81/81** (1차 63) |
| `public` 함수 ACL | main 대비 **새 함수 1개(`get_world_session_admin_target_v1`, authenticated 전용)만 추가**, 나머지 223개 동일 |

**1차 문서의 정정**
- 1차 pgTAP의 “로그아웃 호출이 계정 행을 강등하지 못한다” 단언은 `set local role anon` 뒤에도 직전 구간의 `request.jwt.claims`(운영자)가 남아 있어 **실제 로그아웃 호출이 아니었다.** claims를 비우고 `auth.uid() is null`을 단언하도록 고쳤다. (통합 테스트의 게스트 호출은 처음부터 올바랐다.)
- 1차는 “timeout 후 재시도가 안전하다”를 근거로 삼았지만, 그 시점의 코드는 E1 때문에 한 요청이 HTTP 2회로 나갔다. 지금은 1회이므로 근거가 성립한다.

## 4. Realtime — UNKNOWN 유지

| 항목 | 상태 |
|---|---|
| 실제 Supabase Realtime의 **신규 연결 차단** | **UNKNOWN.** `drafts/realtime_join_gate.sql`은 스텁 `realtime.messages`로 정책 의미만 검증(차단 계정 SELECT 0행·INSERT 거부, 타 계정·만료 후 정상). 실제 서비스에서 join이 거부되는지는 검증하지 않았다 |
| **열린 소켓 철회** | **UNKNOWN / 미해결.** 지원되지 않는 서버 철회 API를 가정하지 않았다. 현재 보장은 “정직한 클라이언트의 자발 종료(REVOKED 또는 유예 만료)”뿐이다 |
| 토큰 갱신 시 정책 재평가 | UNKNOWN |

E3의 유예 보류는 **클라이언트 협조 기반**이다. 변조된 클라이언트는 무시할 수 있으므로 서버 철회의 대체가 아니다.

## 5. 적용·롤백 (실행하지 않음)

- **순서**: `20261010120000` → `20261010130000` → `20261010140000`(전부 함수 전용, 테이블 락 없음). 이후 클라이언트 배포. 스테이징의 진짜 `supabase test db`·`scripts/public-db.sh` 선행 필수.
- **호환성**: 새 UI + 옛 DB(정확 조회 RPC 없음)는 목록이 잘리지 않았다고 확인될 때만 확정하고 그 외는 “확인할 수 없음”으로 표시. 옛 UI + 새 DB는 정상(추가 키는 무시). 새 클라이언트 + 옛 DB의 heartbeat는 정상(유예·보류는 클라이언트 측).
- **롤백**(함수 정의가 해당 시점과 일치함을 각각 검증):
  - `rollback/undo-3-guest-binding.sql` → 2단계 후 상태
  - `rollback/undo-2-admin-readback.sql` → 1단계 후 상태
  - `rollback.sql` → main(`acd54a7`) 상태. 적용 후 재순방향 적용과 ACL까지 최종 상태와 일치.
  - 데이터 복구는 필요 없다(함수 전용). 클라이언트는 커밋 revert.

## 6. 잔여 위험 — 미해결 결함과 UNKNOWN을 분리

### UNKNOWN (증명하지 못함)
1. 열린 Realtime 소켓의 서버 측 강제 종료.
2. 신규 Realtime join 차단(정책 초안)의 실제 동작, 토큰 갱신 시 재평가.
3. 실제 Supabase 스택(PostgREST·JWT·Auth·PG17)에서의 전체 동작. 진짜 pgTAP·그란트 계약·`public-db.sh`는 **미실행**.
4. F01~F05, F07의 내용.

### 미해결 결함 (인지했고 수정하지 않음)
1. **게스트 우회**: 차단은 `auth.uid()` 단위라 kick된 계정이 로그아웃 후 게스트로 같은 존에 들어오는 것을 막지 못한다. 기기/IP 차단은 범위 밖이며 정책 결정이 필요하다.
2. **100명 초과 계정은 UI에서 kick 버튼이 없다**(조회는 정확해졌으나 페이징 미구현).
3. 방문자 ID 없는 게스트 행은 미바인딩(E5 한계).
4. 관리자 정책: 관리자가 다른 관리자를 kick 가능, 차단된 관리자도 관리자 RPC 사용 가능, kick·restore 감사 로그 없음.
5. v1 heartbeat 잔존(호출 0 확인 후 EXECUTE 회수 권장).
6. 최초 heartbeat 성공 전 연결 가능 구간(최대 60초).
7. 원본 테스트 2건의 계약 변경(D6) — 결정 필요.

### 이번 수정이 만든 새 위험
1. **유예 보류의 폭발 반경**: heartbeat RPC 자체가 장애면 **로그인 멤버의 멀티플레이가 60초 후 보류**된다(게스트는 제외). 의도된 fail-closed지만 가용성과 맞바꾼 결정이다. 임계는 `graceMs`로 조정 가능.
2. 보류·복귀는 로그아웃과 같은 경로로 신원 콜백을 비운다(UI 상태 초기화 churn). 서버 데이터에는 영향 없음.
3. 계정 전환·OWNER_MISMATCH로 UUID를 회전하면 이전 행이 최대 70초 동안 이중 집계된다.
4. E1은 1차 커밋이 만든 회귀였다. 이 수정이 같은 종류의 오류를 만들지 않도록 thenable 테스트 더블을 남겼으나, 실물 postgrest-js를 CI에서 돌리지는 않는다.

## 7. PR 생성 가능 여부

- **가능(기술적)**: 브랜치 `ccr-e692442b-0uetz5`는 main(`acd54a7`) 위에 있고 main은 이 기간에 변하지 않았다. 열린 PR 9건과 마이그레이션 충돌 없음. 파일 겹침은 PR #309의 `apps/world/src/main.js` 한 곳이며 **병합 시뮬레이션에서 충돌 없음**(#309는 다른 4줄).
- **병합 전 선행 조건**: (a) 스테이징의 진짜 `supabase test db` / `scripts/public-db.sh`, (b) D6 계약 결정, (c) 스테이징 Realtime에서 신규 join·열린 소켓 동작 관찰, (d) F01~F05·F07 대응 확인.
- **PR 생성·병합은 하지 않았다.** 요청이 있을 때만 진행한다.
