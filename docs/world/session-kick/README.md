# INHA WORLD 세션 강제퇴장 격리 수정안

> 상태: **격리된 로컬 검증 완료 · 미배포 · 미병합.** 운영 DB, 배포, 설정, 권한, `main`, 기존 PR은 변경하지 않았다.
> 이 브랜치의 변경은 함수 정의와 클라이언트 코드뿐이다. 계정·캐릭터·인벤토리·보상·개인방 데이터는 생성·수정·삭제하지 않는다.

## 0. 먼저 읽을 것 (정직한 한계)

| 항목 | 상태 |
|---|---|
| 감사서 **F01~F09 원문** | 저장소와 요청에 없어 **번호 대응은 UNKNOWN**. 아래 D1~D9는 코드에서 직접 재현·확인한 결함이며, 감사서와 대조해 매핑해야 한다. |
| 실제 서버의 **이미 열린 Realtime 연결 강제 종료** | **UNKNOWN (증명하지 못함).** 지원되는 서버 철회 API를 가정하지 않았다. §5 참고. |
| 실제 Supabase 스택(PostgREST·Realtime·Auth·PG17) | 이 환경에는 Docker·`supabase` CLI가 없어 **돌리지 못했다.** 일반 PostgreSQL 16 임시 클러스터 + 스텁으로 검증했다. §6 참고. |
| 진짜 pgTAP | 설치 불가(패키지 없음). **자체 제작 shim**으로 돌렸으므로 CI의 `supabase test db`는 **미실행**이다. |
| 기존 34개 회귀 조건 | 32개는 **수정 없이 그대로 통과**, **2개는 요청 4번(timeout 종료 처리)과 직접 충돌해 의도적으로 계약을 바꿨다.** §4.2, §7 참고. 결정이 필요하다. |

## 1. 기준선 (작업 시작 시 재확인)

- 공개 `main` HEAD: `acd54a70d969120b7f7401d83c99845ee7921d88` (PR #324 병합), 로컬 HEAD와 일치.
- 열린 PR 9건(#305, #308~#315)의 변경 파일을 직접 비교했다. 이 수정이 건드리는 파일과 **겹침 없음**, 마이그레이션 추가 PR도 **없음**.
- 세션 강제퇴장 관련 병합 이력: #320(긴급 차단·kick/restore), #321(관리자 로스터 UI). 이 수정은 둘 위에 쌓인다.
- 새 마이그레이션 버전 `20261010120000`은 main 최신(`20261009142600`)보다 뒤이며 append-only 린트를 통과한다.

## 2. 결함과 수정 (D1~D9)

“재현”은 수정 전(main 계보) DB 또는 수정 전 코드에서 실제로 실패/오동작을 확인했다는 뜻이다.

| # | 결함 | 증거 | 수정 |
|---|---|---|---|
| D1 | `touch_world_online_session_v1`에 차단 판정이 **아예 없음**. 캐시된 구버전 클라이언트나 직접 호출로 재등록 가능 | 재현(통합 테스트 1·8) | v1/v2가 하나의 `private` 코어를 공유 |
| D2 | heartbeat가 차단 검사를 통과한 뒤 kick이 먼저 커밋되면 **kick 후 유령 세션** 생성 | 재현(통합 2) | 사용자별 advisory lock |
| D3 | kick 트랜잭션이 열려 있는 동안 도착한 heartbeat가 **수락됨** | 재현(통합 3) | 동일 lock |
| D4 | 세션 UUID **탈취·강등**: 다른 계정이 같은 UUID로 행을 가져가거나, 로그아웃 호출로 계정 행을 게스트로 바꿔 차단/로스터를 회피 | 재현(통합 5) | 소유권 검사 `WORLD_SESSION_OWNER_MISMATCH` |
| D5 | 차단 응답 직전의 “방어적 cleanup”(`delete` 후 `raise`)은 **예외로 롤백되어 한 번도 반영되지 않음** | 재현(v1 우회로 만든 행이 v2 거절 후에도 1행 유지) | 제거 + lock으로 대체 |
| D6 | 클라이언트: 요청 10초 지연 한 번에 heartbeat가 **영구 종료**. 로스터에서 사라져 관리자가 kick도 못 함 | 기존 테스트가 이 동작을 명세로 고정 | 비종료 처리 |
| D7 | 클라이언트: 인증 세대 없음(계정 전환 후에도 같은 UUID), 늦은 REVOKED 응답이 일시정지(BFCache)/timeout 때문에 버려짐 | 코드 확인 + 신규 단위 테스트 | 인증 세대, UUID 회전, 늦은 REVOKED 처리 |
| D8 | 관리자 UI: RPC 성공 직후 “퇴장 처리 완료” 한 가지로 뭉뚱그림. restore가 `false`면 오류로 표시. 응답 유실 시 실제 상태를 읽지 않음 | 코드 확인 + 신규 단위 테스트 | 3단계 분리, 재조회 |
| D9 | Realtime 정책(`realtime.messages`)에 차단 조건이 없어 **차단된 계정도 새로 join 가능** | 스텁 테이블로 재현 | 별도 초안(§5) |

## 3. DB 설계 (`supabase/migrations/20261010120000_world_session_kick_hardening.sql`)

함수만 바꾼다. 테이블·컬럼·인덱스·데이터 변경 없음. `CREATE OR REPLACE`라 재적용해도 안전하다(검증함).

### 3.1 사용자별 직렬화

kick, restore, heartbeat가 같은 키를 잡는다. 저장소가 이미 쓰는 패턴(`world_activity:`)을 따른다.

```
pg_advisory_xact_lock(hashtextextended('world_session:' || <user_id>, 0))
```

| 순서 | 결과 |
|---|---|
| heartbeat가 먼저 lock | kick이 대기 → heartbeat 커밋 후 kick이 그 행을 삭제 → **유령 없음** |
| kick이 먼저 lock | heartbeat가 대기 → 커밋 후 차단을 보고 `WORLD_SESSION_REVOKED` → **행 생성 없음** |
| 서로 다른 계정 | lock 키가 달라 **서로 지연시키지 않음**(통합 4: 1초 미만) |
| restore | 같은 lock. kick/heartbeat와 순서가 결정적 |

- 만료 판정은 lock을 잡은 **뒤** `clock_timestamp()`로 한다(트랜잭션 시작 시각 `now()` 아님).
- 오래된 행 정리는 `limit 200 … for update skip locked`로 제한했다. 서로 다른 계정의 동시 heartbeat가 같은 만료 행을 반대 순서로 잠가 교착되는 경로를 없앴다.
- 해시 충돌은 무관한 두 계정을 잠깐 직렬화할 뿐 정확성에는 영향이 없다.

### 3.2 v1/v2 정합과 EXECUTE

- `private.touch_world_online_session_core(uuid,uuid,text,text)`가 검증·차단·소유권·upsert를 한 곳에서 한다. v1/v2는 얇은 래퍼.
- 코어는 `anon`/`authenticated` **실행 불가**(ACL 확인). v1/v2 EXECUTE는 `anon`·`authenticated`로 **명시 재선언**했고, `public` 함수 223개의 ACL이 수정 전과 **완전히 동일**함을 대조했다. 그란트 계약(공개 API 표면)은 변하지 않는다.
- v1은 **유지**한다(캐시된 구버전 클라이언트 호환). 호출이 사라진 것을 확인한 뒤 별도 마이그레이션으로 EXECUTE를 회수하는 것을 권한다.

### 3.3 세션 UUID 소유권

| 기존 행 소유자 | 호출자 | 결과 |
|---|---|---|
| 없음(게스트) | 게스트 | 갱신 |
| 없음(게스트) | 로그인 계정 | **승계 허용**(같은 탭에서 로그인) |
| 계정 A | 계정 A | 갱신 |
| 계정 A | 계정 B | `WORLD_SESSION_OWNER_MISMATCH` |
| 계정 A | 로그아웃 호출 | `WORLD_SESSION_OWNER_MISMATCH` (강등 차단) |

차단된 계정이 게스트 행을 승계해 우회하는 경로도 막혔다(차단 판정이 먼저 실행됨, 통합 7).

### 3.4 kick/restore 응답

`kick_world_user_v1`은 기존 키를 유지하고 `serverTime`을 추가했다. 반환 형태는 하위 호환이다. 관리자 계정이 다른 관리자를 kick할 수 있고 차단 중인 관리자도 관리자 RPC를 쓸 수 있는 기존 정책은 **바꾸지 않았다**(§8).

## 4. 클라이언트

### 4.1 heartbeat (`apps/world/src/online/world-population-heartbeat.js`)

- **종료 상태는 셋뿐**: 운영자 철회(`WORLD_SESSION_REVOKED`), 비-BFCache `pagehide`, 명시 `stop()`.
- **timeout은 비종료**: 요청을 abort하고 `lastError=WORLD_HEARTBEAT_TIMEOUT`, `consecutiveFailures` 증가, 20초 주기는 계속. 서버가 계정별로 직렬화하고 세션 UUID 소유권을 검사하므로 재시도/지연 도착 쓰기가 안전하다(예전의 “서버 취소 여부가 불확실하니 영구 정지” 전제가 사라졌다).
- **인증 세대**: `client.auth.onAuthStateChange`로 계정이 바뀌면 새 UUID로 회전하고, 이전 계정의 요청은 abort, 한 번만 새로 쓴다. 처음 받은 인증 이벤트(보통 `INITIAL_SESSION`)는 계정을 식별만 하고 회전하지 않으며 같은 계정의 `TOKEN_REFRESHED`도 회전하지 않는다. 로그아웃도 회전한다(게스트가 계정 행을 강등하지 못하게).
- **서버가 OWNER_MISMATCH를 주면** UUID를 회전하고 즉시 한 번 재시도, 이후엔 정상 주기(루프 없음).
- **늦은 응답**: 같은 계정의 `WORLD_SESSION_REVOKED`는 timeout·일시정지·세대 교체 뒤에 도착해도 **권위적**이라 종료시킨다. 이전 계정의 REVOKED나 일반 오류는 무시한다. 이전 계정 응답이 새 계정 상태를 덮어쓰지 못한다.
- 한계: 실제 fetch를 abort하면 응답 자체가 사라지므로 “늦은 REVOKED”는 abort를 지원하지 않는 전송/응답이 abort 전에 도착한 경우에 의미가 있다. 어느 쪽이든 다음 heartbeat(≤20초)가 다시 REVOKED를 받는다.

### 4.2 기존 테스트 계약 변경 (결정 필요)

수정 전 원본 테스트 4파일(34개)을 새 코드에 **그대로** 돌린 결과: **32 통과 / 2 실패**.

| 원본 테스트 | 원래 명세 | 변경 |
|---|---|---|
| `a never-settling pre-cache request fails closed after 10s without a replacement write` | timeout이면 영구 종료 | timeout은 복구 가능, 다음 주기에 재전송 |
| `a pending request without abortSignal still has a terminal deadline` | 〃 | 〃 |

요청 4번이 “terminal stop, timeout 수정”이라 이 두 개를 새 계약으로 **교체**했다(이유를 테스트 주석에 남김). 영구 종료 쪽 안전성이 더 중요하다고 판단하시면 timeout 분기만 되돌리면 되며, 나머지 변경과 독립적이다.

### 4.3 관리자 UI (`apps/world/hub-world-sessions.mjs`)

결과를 한 문장으로 뭉뚱그리지 않고 서로 다른 사실로 나눈다.

| 사실 | 판정 근거 |
|---|---|
| **명령 수락** | RPC가 성공 응답을 반환 |
| **차단 확인** | 독립된 로스터 재조회의 `blocked` 목록에 있고, 약속된 `blockedUntil` 이상 |
| **집계 세션 종료 확인** | 같은 재조회에서 해당 계정이 `accounts`에 없음 |
| **Realtime 연결 종료** | 항상 `UNKNOWN` — 문구에 “확인할 수 없습니다”를 명시 |

표시 상태: 확인 완료 / 수락됐지만 차단 미확인 / 차단 확인됐으나 집계 세션 잔존 / 수락됐지만 재조회 실패 / 응답 유실 후 실제 상태 재조회. restore는 `true`(제거)·`false`(이미 해제)를 구분하고, 해제 후에도 차단이 남아 있으면 그렇게 표시한다.

## 5. Realtime: 신규 연결 차단과 기존 연결 철회를 분리

| 구분 | 이 수정 | 상태 |
|---|---|---|
| 신규 heartbeat 등록 | v1/v2 모두 차단 | **검증됨(로컬 DB)** |
| 클라이언트 자발 종료 | REVOKED 수신 시 heartbeat 종료 + `online.stop()`(기존 `main.js` 콜백 유지) | 단위 테스트. 변조된 클라이언트는 무시 가능 |
| **신규 Realtime join 차단** | `docs/world/session-kick/drafts/realtime_join_gate.sql` — `realtime.messages` 정책에 차단 조건 추가 | **초안.** 스텁 테이블로 정책 의미만 확인: 차단 계정 SELECT 0행·INSERT 거부, 타 계정·만료 후 정상. 실제 Realtime에서의 join 거부는 **UNKNOWN** |
| **이미 열린 소켓 철회** | 없음. Supabase Realtime에 서버가 특정 사용자의 열린 연결을 끊는 공식 API를 가정하지 않았다 | **UNKNOWN / 미해결** |
| 토큰 갱신 시 정책 재평가로 인한 철회 | 가능 여부 미확인 | **UNKNOWN** |

초안을 마이그레이션 디렉터리가 아니라 `docs/`에 둔 이유: 모든 온라인 플레이어가 의존하는 정책을 건드리므로 스테이징 Realtime에서 입증되기 전에는 자동 적용 경로에 두지 않는다. 승격 시 새 `authenticated` EXECUTE 함수(`world_session_join_allowed_v1`)를 그란트 계약에 추가해야 한다.

## 6. 검증 결과

### 6.1 환경 (한계를 먼저)

- PostgreSQL **16.15** 임시 클러스터(postgres 홈 하위, 검증 후 삭제), `127.0.0.1`/소켓만 사용.
- Supabase 스텁: roles(`anon`/`authenticated`/`service_role`), `auth.users`·`auth.uid()`·`auth.jwt()`, `realtime.messages`·`realtime.topic()`. 하네스는 `docs/world/session-kick/local-harness/`에 있다(**운영/CI용 아님**).
- main의 실제 baseline + 이후 마이그레이션 전체(42개, 오류 없음)를 먼저 적용해 수정 전 상태를 만들고, 그 위에 신규 마이그레이션 1개를 적용했다. PG17 전용 문법(`transaction_timeout`, `MAINTAIN` 권한)과 `supabase_realtime` publication 오류는 로컬 PG16 한정이며 이 변경과 무관하다.
- 없는 것: PostgREST, 실제 JWT, Realtime 서비스, Auth, PG17, 진짜 pgTAP.

### 6.2 결과표

| 검증 | 결과 |
|---|---|
| 통합 테스트(2개 psql 세션을 겹쳐 실제 동시성 재현) — **수정 전** | 9개 중 **5 실패**(D1·D2·D3·D4 + 데이터 보존 테스트의 v1 우회 지점) |
| 같은 테스트 — **수정 후** | **9/9 통과**, 3회 반복 안정, 잔여 행 0 |
| 변이 시험: advisory lock 제거 | 경쟁 테스트 2·3만 실패(테스트가 lock을 실제로 검증함) |
| 변이 시험: 소유권 조건 제거 | 테스트 5 실패 |
| pgTAP `61_world_online_population` (shim) | main 계보 53/53 → 수정 후 **63/63** (신규 10개 단언 추가). 수정 전 DB에서는 신규 단언이 코어 함수 부재로 중단 |
| `public` 함수 ACL 대조 | 223개 **동일** |
| 롤백 SQL 적용 후 4개 함수 정의 | main과 `pg_get_functiondef` md5 **일치**, 코어 함수 제거, 재적용 가능 |
| 마이그레이션 재적용(idempotent) | 통과 |
| `migration-lint` / `migration-contract-lint` | 통과 |
| 데이터 보존 | public·private·auth 전 테이블의 행 지문(md5)이 kick/restore/거절된 heartbeat 전후로 **동일**(제외: `world_online_sessions`, `world_session_kick_blocks` 두 테이블만). 시드: 프로필·인벤토리 기본 아이템·개인방 |
| Node: 관련 4파일 | 34 → **51**(heartbeat 28, hub-world-sessions 14, online-connection-state 7, population-count 2) 전부 통과 |
| Node: `apps/world/tests/*.test.mjs` 전체 | **3927 pass / 0 fail** |
| `supabase/tests/edge` / `.github/ci` / `apps/world/qa.mjs` | 35 / 74 / 통과 |
| 열린 PR 9건과 파일 겹침 | 없음 |

### 6.3 재현 방법

```bash
# 1) 임시 PG16 클러스터를 띄우고(예: initdb -A trust, 소켓/포트 직접 지정)
# 2) 스텁 → baseline → 이후 마이그레이션 → (선택) shim 순서로 적용
psql -d scratch -f docs/world/session-kick/local-harness/bootstrap.sql
for f in $(ls supabase/migrations | sort); do psql -d scratch -f supabase/migrations/$f; done
# 3) 통합 테스트: 루프백 DB만 허용(정규식 검사)
DB_URL=postgresql://postgres@127.0.0.1:<port>/scratch \
  node --test supabase/tests/integration/world-session-kick.integration.test.mjs
# 4) pgTAP 파일은 shim으로(진짜 pgTAP이 있으면 shim 불필요; create extension 줄만 제외)
psql -d scratch -f docs/world/session-kick/local-harness/pgtap_shim.sql
```

## 7. 적용 설계 (이 작업에서는 실행하지 않음)

1. **스테이징 선행.** 실제 Supabase 스택에서 `supabase test db`와 `scripts/public-db.sh`(통합 포함)를 먼저 통과시킨다. 이 문서의 검증은 그 대체가 아니다.
2. **DB 먼저**: 마이그레이션 적용(함수 교체뿐, 테이블 락 없음). 구 클라이언트 + 새 DB는 정상 동작한다. 예외: 구 클라이언트가 같은 탭에서 계정을 전환하면 `OWNER_MISMATCH`를 받아 리로드 전까지 집계에서 빠진다(드묾, 데이터 영향 없음).
3. **클라이언트 배포.** 새 클라이언트 + 구 DB도 정상(OWNER_MISMATCH가 오지 않을 뿐, 비종료 timeout은 그대로 동작).
4. **검증(읽기 전용)**: `v1`로 차단 계정 호출이 거절되는지, 거절 후 `world_online_sessions`에 행이 없는지를 테스트 계정으로 확인.
5. **(선택) Realtime join 게이트**는 스테이징에서 차단 계정의 신규 join 거부를 먼저 관찰한 뒤에만 승격.
6. 모니터링: `WORLD_SESSION_OWNER_MISMATCH` 비율 급증은 계정 전환 회전 로직 이상 신호, `WORLD_HEARTBEAT_TIMEOUT` 증가는 네트워크 문제 신호.

### 롤백

- **DB**: `docs/world/session-kick/rollback.sql`(main의 정확한 함수 본문을 `pg_get_functiondef`로 추출해 생성, 적용 후 정의 일치 검증됨). 함수 전용이라 **데이터 복구 불필요**. 이미 기록된 차단 행은 그대로 유효. 롤백하면 D1~D5가 다시 열린다.
- **클라이언트**: 해당 커밋 revert. DB 롤백과 독립적이다.
- **Realtime 게이트(적용했다면)**: 초안 하단의 롤백 절차.
- 앞으로 가는 수정(forward-fix)이 기본이며, 마이그레이션 디렉터리는 append-only라 파일을 지우지 않는다.

## 8. 미해결 위험

1. **[UNKNOWN] 열린 Realtime 소켓 강제 철회.** 증명 못 함. 현재 보장은 “신규 heartbeat 등록 차단 + 정직한 클라이언트의 자발 종료(≤20초)”까지이며, 변조 클라이언트는 이미 열린 채널에 남을 수 있다.
2. **[UNKNOWN] Realtime join 게이트와 토큰 갱신 시 재평가의 실제 동작.** 스텁 정책 의미만 검증.
3. **게스트 우회.** 차단은 `auth.uid()` 단위다. 월드는 익명 Supabase 세션으로 게스트 접속을 허용하고, kick한 계정이 로그아웃 후 게스트로 같은 존에 들어오는 것을 막지 않는다. 로스터는 게스트를 노출하지 않는다(개인정보 정책). 기기/IP 차단은 범위 밖이며 정책 결정이 필요하다.
4. **관리자 정책.** 활성 `world_admin`이 다른 관리자를 kick할 수 있고, 차단된 관리자도 관리자 RPC를 쓴다(자기 restore 가능). 감사 로그가 없다(`operator_id`는 마지막 차단 행에만, restore 시 삭제). 변경하지 않았다.
5. **기존 2개 회귀 조건의 계약 변경**(§4.2) — 소유자 결정 필요.
6. **v1 잔존.** 호출이 0임을 확인한 뒤 회수 권장.
7. **검증 환경 차이**(PG16·스텁·shim). CI의 진짜 pgTAP, 그란트 계약, 로컬 Supabase 통합은 **미실행**. 그란트 계약 테스트는 스텁 환경의 기본 권한 차이로 로컬에서 신뢰할 수 없어 대신 함수 ACL을 직접 대조했다.
8. **F01~F09 대응 UNKNOWN**(§0). 감사서가 D1~D9 밖의 결함을 포함한다면 이 수정은 그 부분을 다루지 않는다.
