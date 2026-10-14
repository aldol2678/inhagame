# SEC-01-STAGE-A-ISOLATED-VALIDATION-R0

INHA WORLD · 캠퍼스 근거리 채팅 보안 설계 "INHAGAME-SEC-01" Stage A 격리 실증 보고서.

> **상태: STAGE A CONDITIONAL** (최종 판정은 §11). 운영 환경(Production DB·Realtime·배포)은 일절 변경하지 않았다.
> 모든 실험은 일회용 로컬 Supabase 스택에서만 수행했다.

---

## 1. Executive Summary

Stage A의 목적은 SEC-01 캠퍼스 채팅의 **서버 권한·발행 원자성·권한 동시성·수신자별 inbox 보안·멱등성/정규화·규모 성능**을 가정이 아니라 실제 실행 결과로 판정하는 것이다. 격리된 PostgreSQL 17.11 + Supabase Realtime v2.140.10 + PostgREST v16.4 스택을 `main`(`0dcae7b`) + PR #353(`83cb427`) 마이그레이션 전수 재생 위에 세우고, 합성 계정·세션으로 실 WebSocket 전달까지 측정했다.

**검증된 경계 (PASS)**
- **수신자별 private inbox 격리 (C1–C10 전부 PASS).** 비인가 계정·익명 키의 토픽 구독은 RLS가 실제로 거부했고(`CHANNEL_ERROR: Unauthorized`), 동명 공개 토픽·HTTP broadcast·provider 직접 호출·capability 재사용·이전 generation 재구독·제재 중 재연결이 모두 실제 수신 0 프레임으로 차단됐다. **"서버가 발행 자체를 거부"** 와 **"클라이언트가 버림"** 을 분리해 측정했고, 서버 행 수(`realtime.messages`)가 유일한 전달 경계임을 확인했다.
- **잠금 후 실시간 재검사로 닫히는 발행 (B1,B2,B5,B6-clock,B7 PASS).** 잠금 대기 중 차단·generation 변경·lease 만료·세션 종료가 확정되면, 잠금 획득 후 `clock_timestamp()` 재검사로 해당 발행이 중단되거나 해당 수신자가 제외됐다. 발행이 잠금을 선점하면 기존 `block_world_user`(배타적 pair 잠금)가 대기했고 커밋 순서(`pg_xact_commit_timestamp`)가 보존됐다.
- **원자적·fail-closed 발행이 가능함 (A1,A2,A4,A5,A6,A7,A8,A3-insert PASS).** 승인 기록 + 불변 Envelope + 수신자별 발행 행 + `realtime.messages` 행을 **단일 트랜잭션 직접 INSERT + 행수 검증**으로 묶으면, 롤백 시 전부 사라지고 Realtime도 커밋된 행만 전달했다. 동일 requestId 동시 12요청 및 잠금 관찰 2요청에서 승인은 정확히 1건, 나머지는 동일 Envelope replay였다.
- **서버 권한 멱등성·기간 창 (D1-server,D2-D4,D5-D6 PASS).** 최초 승인과 세션·generation·구역 변경 후 재조회가 바이트 동일 Envelope를 반환했고, 재시도/조회 기간 초과는 신규 발행 없이 거부됐다.
- **피드 전용 안전 경로 (F4,F5 PASS).** 서버 인증 Envelope는 서버 파생 `senderUserId`/`senderName`을 담아, 클라이언트 Presence를 신뢰하지 않고 피드 한 줄을 그릴 수 있다. 기존 Presence/Pose 패킷 형태는 변경되지 않았다.

**확인된 결함·미충족 (FAIL / 조건)**
- **F · 아바타 사칭 (F1,F2-F3 FAIL).** 기존 캠퍼스 Presence/Pose 전송에서, 두 번째 인증 계정이 **타인의 userId/sessionId를 선언한 Presence를 실제로 track**할 수 있었고(Realtime RLS는 소켓만 인가하고 Presence 메타를 `auth.uid()`에 묶지 않음), 더 늦은 `joinedAt`으로 **실제 플레이어의 아바타를 축출**하고 그 이름으로 **말풍선을 위조**할 수 있었다. 즉 Stage A의 피드 전용 구현은 안전하나, **아바타에 묶인 말풍선은 기존 전송만으로는 안전하지 않다.**
- **B · 운영자 제재 경로의 공유 잠금 미충족 (B3-existing,B9 FAIL).** 기존 `admin_review_world_user_report_v1`은 report 행만 잠그고 발행과 잠금을 공유하지 않아, 제재 확정 **이전에 권한을 통과한 발행이 제재 확정 이후에 커밋·전달**됐다. 제재 해제·ban RPC는 아예 없다. 과제 기준상 "기존 변경 RPC가 공유 잠금을 사용하지 않으면 PASS 불가".
- **A · provider 기반 발행은 원자적이지 않음 (A3-provider,A3-send-mode FAIL + PR353 probe).** Supabase `realtime.send`는 내부 INSERT가 실패해도 `WARNING`만 남기고 `void`를 반환한다. **PR #353의 변경 없는 `send_world_room_chat_v1`에 동일 장애를 주입하자 `ok:true`를 반환하면서 전달 행은 0건**이었다. provider 성공 반환을 발행 성공으로 판정하면 안 된다(대체안 A3-insert는 통과).
- **D · 클라이언트/정규화 계약 미완 (D1-client NOT MEASURED, D7-canon,D7-lower,D8-coords FAIL).** `main`에 캠퍼스 채팅용 requestId 구현이 없다. JS(Node ICU 77/Unicode 16)와 PostgreSQL(ICU 15.1/Unicode 15.1)의 NFC·소문자·좌표 반올림이 **엣지에서 불일치**한다(상세 §7).

**결론:** 핵심 서버 보안 경계(inbox 격리, fail-closed 직접 INSERT 발행, 서버 권한 멱등성, 잠금 후 재검사)는 격리 환경에서 실증됐다. 그러나 (1) 운영자 제재 계열의 공유 잠금, (2) provider 비신뢰 발행 방식, (3) 클라이언트 requestId·정규화 단일 권한화, (4) 아바타 인증은 미충족/미구현이다. 따라서 **Stage A CONDITIONAL**. 실시간 2계정 운영 Realtime·물리 모바일·운영 콜레이션은 권한/범위상 **미검증(BLOCKED/NOT MEASURED)**.

---

## 2. 기준 커밋 및 환경

실행 시작 시 재조회한 값(`results/ENVIRONMENT.txt` 원본):

| 항목 | 값 |
| --- | --- |
| 기본 브랜치 HEAD (`origin/main`) | `0dcae7b4825c12e1ec03b6879d3bc0d27f9ad46e` |
| PR #353 실제 HEAD (`refs/pull/353/head`) | `83cb427f81384087e759e0e0f158d1629b1e9f63` |
| PR #353 이전 기록 HEAD | `83cb427…` (일치) |
| PR #353 본문이 주장한 head | `8bde3d4…` (현재 tip과 불일치 — 본문 기재 오류, 실제 tip은 `83cb427`) |
| PR #353 API base_sha | `3aaec79…` (더 오래된 main) |
| 이전 검토 기준 커밋 `f574864` | 이 클론에 존재함 |

> **중요:** PR #353 본문은 `Current head: 8bde3d4`, `Local/remote tree: b8a6e24`로 기재하나 실제 원격 tip은 `83cb427`(그 위 2커밋 — `3aaec79 #354 merge`, `83cb427 H3 authority retention`)이다. 또한 PR의 base(`3aaec79`)는 현재 main(`0dcae7b`)보다 과거다. 격리 실험은 **현재 main `0dcae7b` 위에 PR #353의 3개 신규 마이그레이션을 재생**했다. 이전 기록을 현재 HEAD로 간주하지 않았다.

**스택 (운영과 다른 증거 수준을 구분하기 위해 전부 명기):**

| 구성 | 버전 | 비고 |
| --- | --- | --- |
| PostgreSQL | 17.11 (`supabase/postgres:17.11.0.004`) | `config.toml major_version=17`과 일치 |
| Realtime | `supabase/realtime:v2.140.10` | 실제 WebSocket + 논리복제 전달 |
| GoTrue(Auth) | `v2.197.0` | 합성 계정 로그인/로그아웃 |
| PostgREST | `v16.4` | 실제 RPC 경로 |
| Node | v22.22.0 — ICU **77.1 / Unicode 16.0** | 저장소 `protocol.js` 그대로 임포트 |
| DB 로케일 | `en_US.UTF-8`, ICU provider, **ICU 15.1 / Unicode 15.1** | 운영 콜레이션은 미조사(권한 금지) |
| 적용 마이그레이션 | 53개, 마지막 `20261012143000` | PR #353 `20261012023000/023100/025000` 포함 확인 |
| 기능 플래그 | `world_room_chat_config.enabled=false`, `world_club_rooms.enabled=false` | 기본 CLOSED 확인 |
| 역할 | anon/authenticated: super=f, bypassrls=f / service_role: bypassrls=t | `world_room_publisher_safe_v1` 전제와 일치 |

**증거 수준 구분(과제 §9):** 본 보고서의 모든 수치는 **실제 PostgreSQL + 실제 Supabase Realtime** 수준이다(PGlite·Mock 미사용). 단 (a) 전 클라이언트가 **단일 Node 프로세스**에서 구동되어 N=100 수신 완전성은 클라이언트 측 포화의 영향을 받고, (b) **운영 Realtime·운영 콜레이션·물리 모바일**은 접근 금지로 미검증이다.

**SEC-01 v0.4 문서 부재 고지:** 저장소에서 "SEC-01 v0.4" 설계 문서를 찾지 못했다(`docs/**`, 이슈/PR 검색 결과 0건). 따라서 본 실증의 **계약(requestId=제출 시 UUIDv7 생성, 10분 재시도/30분 조회 창, Envelope 불변성 등)은 과제 지시문에서 재구성**했으며, 이는 lab의 가정이다. PR #353에 실제 존재하는 계약(아래 §3)과 명확히 구분한다.

---

## 3. PR #353 공통화 매트릭스

PR #353은 **룸(개인방·동아리방) 전용** 서버 인증 채팅이다. 캠퍼스 채팅에 **재사용 가능한 계약**과 **룸 전용이라 그대로 적용하면 안 되는 것**을 구분한다.

| 계약/구현 | PR #353 실제 코드 | 캠퍼스 재사용 | 근거 |
| --- | --- | --- | --- |
| RPC-only 발행, 서버가 발신자 신원·이름 파생(인자에 name/sender/topic 없음) | `send_world_room_chat_v1` | **재사용** | `send_world_room_chat_v1`: 이름은 `profiles`에서, 신원은 `world_room_caller_v1()` |
| 수신자별 rotating inbox capability + `realtime.messages` RLS(소유자만 SELECT, 클라 INSERT 금지) | `can_receive_world_room_chat_v1`, 3개 restrictive 정책 | **재사용(핵심)** | C 실험 전부 PASS — 캠퍼스 lab 정책도 동일 구조로 통과 |
| 잠금 후 `clock_timestamp()` 재검사(lease·rate) | `send_world_room_chat_v1` 주석 "Lock waits must never preserve the function-entry clock" | **재사용(필수)** | B6-clock PASS / B6-txn 부정대조군 FAIL |
| `world_room_publisher_safe_v1`(SECURITY INVOKER provider + message RLS + non-BYPASSRLS 역할) 전제 | 동일 | **재사용** | 환경 역할 점검과 일치 |
| 수신자별 블록 양방향 재검사 | `send_world_room_chat_v1` fan-out 루프 | **재사용** | B1/B2 PASS(캠퍼스 lab 동형) |
| 불변 Envelope·승인 기록 테이블 | **없음**(메시지 본문 테이블 없음, realtime.messages만) | **캠퍼스는 추가 필요** | A3-send-mode FAIL 참조 |
| `realtime.send` 기반 발행 | `send_world_room_chat_v1`가 `perform realtime.send(...)` | **그대로 쓰면 안 됨** | A3-provider/A3-send-mode FAIL, PR353-A3 probe FAIL |
| 룸 노크·방문 권한·단일 참여(capacity 6, 6 seats) | `world_room_access_v1`, `world_club_room_*` | **캠퍼스에 적용 금지** | 캠퍼스는 AREA Place Zone 다중 참여; 노크/방문/정원 개념 없음 |
| H3 authority md5 지문 고정 | `world_room_chat_personal_authority_ready_v1` | 캠퍼스 무관 | 개인방 전용 |
| 운영자 제재와의 공유 잠금 | **없음**(제재 RPC는 report 행만 잠금) | **재사용 불가 — 신규 필요** | B3-existing/B9 FAIL |

**요약:** inbox RLS·잠금 후 재검사·서버 신원 파생·블록 재검사는 캠퍼스로 **그대로 공통화 가능**하다. 반면 (1) **원자성 보장(불변 Envelope + 행수 검증 직접 INSERT)**, (2) **운영자 제재와의 공유 권한 잠금**, (3) **requestId 멱등성 계약**은 PR #353에 없거나 provider-신뢰 방식이어서 캠퍼스에서 **새로 설계**해야 한다. 룸 전용 노크/정원/단일참여는 캠퍼스에 **적용하지 않는다**.

---

## 4. 원자성 테스트 결과 (실험 A)

대상: lab RPC `public.sec01_send_campus_chat`(sql/10_…). 발행 방식 두 가지 비교 — `insert`(직접 INSERT + 행수 검증), `realtime_send`(PR #353과 동일 provider 호출). 증거: `results/A-atomicity.json`.

| ID | 상황 | 판정 | 실제 관찰 | 예상 |
| --- | --- | --- | --- | --- |
| A1 | 정상 승인·발행 | **PASS** | approvals 1 / deliveries 2 / realtime 2, 각 수신자 1프레임, Envelope=RPC응답 동일, 31.9ms | 전부 커밋·동일 전달 |
| A2 | 커밋 직전 강제 롤백(예외 주입 + 명시 ROLLBACK) | **PASS** | 롤백 후 승인/발행/realtime 행 0, 수신 0. 트랜잭션 내부에선 2행 보였으나 커밋 안 되어 논리복제가 전달 안 함 | 함께 롤백 |
| A3-provider | `realtime.send` 자체(오늘 파티션 분리 주입) | **FAIL** | `send` 반환 `""`(void) + `WARNING: no partition…`, **행 증가 0** | 실패는 오류로 노출돼야 함 |
| A3-send-mode | provider 기반 발행(PR #353 방식) | **FAIL** | approvals 1, **realtime 0**(승인만 커밋, 전달 0), 수신 0 | 함께 커밋/롤백 |
| A3-insert-mode | 직접 INSERT + 행수 검증(대체안) | **PASS** | RPC 오류, 승인/발행/realtime 0, 수신 0 (fail-closed) | 원자적 거부 |
| A4 | 발행 성공 후 RPC 응답 유실(HTTP abort 후 재시도) | **PASS** | 1차 AbortError, 서버 승인 1 유지, 재시도 **replay**(동일 Envelope), 수신 각 1 | 1회 커밋·replay |
| A5 | 동일 requestId 동시(HTTP 12 + 잠금관찰 2) | **PASS** | distinct messageId 1, 신규 승인 1, 2번째 요청이 1번째 커밋까지 대기(≥1.4s) 후 replay | 승인 정확히 1 |
| A6 | 동일 requestId·다른 본문 | **PASS** | 변조/좌표변경 → `request_conflict`(행 0); 공백·ZWSP는 정규화 후 동일 → replay; 동시 2본문 → `[approved, request_conflict]` | 다른 본문 거부 |
| A7 | 승인 ↔ 발행 행 전수 대조 | **PASS** | count_mismatch 0, payload/topic_mismatch 0, orphan realtime 0 (A3 fault 발행만 delivery-without-realtime 2 — 그 자체가 FAIL 증거) | 전수 일치 |
| A8 | 중복 재조회·재시도 20+20회 | **PASS** | 행 불변, 수신자별 1프레임 유지 | 행 증가 없음 |

**PR #353 직접 probe(`results/PR353-probe.json`):** 변경 없는 `send_world_room_chat_v1`에 동일 파티션 분리 장애 주입 → **`ok:true` 반환, realtime 행 증가 0**(PR353-A3 FAIL). 정상 상태에선 `rpc:true, +2행`.

**판정:** 과제의 두 필수 조건 중 **"승인되지 않은 메시지가 실제 수신자에게 발행되지 않는다"는 전 경우 성립**(A2·A3·A6·RLS). **"승인과 발행 행이 함께 커밋/롤백"은 직접 INSERT 방식에서만 성립**하며, PR #353의 `realtime.send` 방식은 provider 경고성 실패 시 **승인만 남고 전달 0 또는 전달만 되고 기록 없음**이 가능하다. → **대체 발행 방식: 수신자별 `realtime.messages` 직접 INSERT + `GET DIAGNOSTICS` 행수 검증**(임의로 운영 설계를 바꾸지 않고 §11 계약 변경 항목으로 제시).

---

## 5. 권한 동시성 테스트 결과 (실험 B)

실제 PostgreSQL 별도 백엔드·동시 트랜잭션. 모든 경쟁 케이스에서 발행자가 `pg_stat_activity.wait_event_type='Lock'` 대기를 **실측**했거나 그 역을 확인했다. 커밋 순서는 `pg_xact_commit_timestamp`(격리 DB `track_commit_timestamp=on`). 증거: `results/B-concurrency.json`.

| ID | 상황 | 판정 | 실제 관찰 |
| --- | --- | --- | --- |
| B1a | 수신자가 발신자 차단, 발행 잠금 대기 중 차단 확정 | **PASS** | 발행자 pair 잠금 대기→차단 커밋 후 재검사→차단쌍 미발행(recipientCount 1, 차단측 수신 0) |
| B1b | 발행이 잠금 선점 → 차단이 대기 | **PASS** | 기존 `block_world_user`가 대기, 발행 커밋이 차단 커밋보다 선행 |
| B2a/B2b | 발신자가 수신자 차단(양방향) | **PASS** | 동일 결과(양방향 차단 재검사) |
| B3-existing | 운영자 제재(기존 `admin_review…` RPC) | **FAIL** | 제재 RPC는 report 행만 잠금(대기 4ms). **제재 확정 이후 발행이 커밋·전달**(publishCommit > sanctionCommit, 수신 [1,1]) |
| B3-locked | 운영자 제재 + 권한 잠금 공유(lab wrapper) | **PASS** | 제재 선확정 시 발행 `denied`·수신 0 / 발행 선점 시 제재가 대기, 발행이 엄격히 선행 |
| B3-recipient | 수신자 제재, 잠금 대기 후 제외 | **PASS** | recipientCount 1, 제재 수신자 수신 0 |
| B4 | 제재 해제 | **BLOCKED** | **해제 RPC 부재**. 직접 UPDATE 경로는 공유 잠금 미사용(발행자 미대기). 단 경쟁 결과는 **거짓 DENY(fail-safe)**뿐 — 무권한 발행은 발생 안 함 |
| B5 | generation 변경(수신자 이동/재입장, 발신자 세대 변경) | **PASS** | 이전 토픽 발행 0·수신 0; 재입장 시 새 토픽 1; 발신자 세대 변경 시 `denied` |
| B6-clock | lease 만료, 잠금 대기 중 만료, 재검사=`clock_timestamp()` | **PASS** | 만료 lease 전달 행 0·수신 0 |
| B6-txn | 동일, 재검사=`now()` **부정 대조군** | **FAIL(의도된 대조)** | `now()`는 트랜잭션 시작 시각이라 대기 중 만료된 lease에 전달됨 → `clock_timestamp()` 필요성 증명. PR #353·lab은 모두 `clock_timestamp()` 사용 |
| B7 | 세션 종료(leave), 잠금 대기 중 종료 | **PASS** | 종료 수신자 제외; 발신자 종료 시 `denied` |
| B8 | 무작위 2000 연산·16 동시 연결(send/block/unblock/move/renew/sanction) | **PASS** | **deadlock 0, 블록 순서 위반 0, 제재 순서 위반 0**, 예상 도메인 거부(SOCIAL_RESTRICTED) 외 오류 0, 2026ms |
| B9 | 기존 변경 RPC 공유 잠금 정적 점검 | **FAIL** | block/unblock=`world_lock_pair`(공유 가능), **제재 RPC 2종=report 행만, ban setter 0개, 해제 RPC 0개** |

**판정:** 일관된 잠금 순서(request→authority→pair(=`world_lock_pair` 키 동일)→session→rate)로 **교착 없이** 차단·generation·lease·세션 경쟁이 안전하게 직렬화됐다(B1,B2,B5,B6-clock,B7,B8). 그러나 과제 기준 **"기존 변경 RPC가 공유 잠금을 사용하지 않으면 PASS 불가"** 에 따라, **운영자 제재/ban/해제 경로가 발행과 잠금을 공유하지 않으므로(B3-existing,B9 FAIL) 실험 B는 PASS로 승격하지 않는다.** lab wrapper(B3-locked)는 공유 잠금으로 닫힘을 보였다 — 이것이 필요한 수정 방향이다.

---

## 6. Inbox 공격 테스트 결과 (실험 C)

세 결과를 분리 측정: **서버 발행 거부 / 서버 발행+클라 표시거부 / 실제 전달**. "클라가 버림"을 전달 차단으로 판정하지 않았다. 공격자는 별도 WebSocket(fresh socket)으로 join해 Phoenix 중복-join 아티팩트를 제거했다. 증거: `results/C-inbox.json`.

| ID | 공격 | 판정 | 실제 관찰 |
| --- | --- | --- | --- |
| C1 | 정상 인증 수신자 | **PASS** | 1프레임 수신 |
| C2 | 비인가 사용자/익명 키 토픽 구독 | **PASS** | 둘 다 `CHANNEL_ERROR: Unauthorized…`, 수신 0, 정상 수신자엔 정상 전달 |
| C3 | 공개·private 동명 토픽 | **PASS** | 공개 twin에 서버 메시지 0; 공격자 WS 위조 send `ok`지만 피해자 private 수신 0; HTTP broadcast(public/private) 202지만 private inbox 위조 행 0 |
| C4 | provider 직접 호출(REST/SQL/직접 INSERT/자기 inbox WS) | **PASS** | REST `realtime` 스키마 차단, SQL `realtime.send`는 `WARNING: RLS 위반` + 행 0, 직접 INSERT RLS 거부, 자기 inbox WS send ack=`error`·echo 0 |
| C5 | 타 수신자 capability 재사용(renew/send/leave/move/구독) | **PASS** | 전부 `denied/false/CHANNEL_ERROR`, 피해자 lease 불변 |
| C6 | 이전 generation 토픽 재구독 | **PASS** | 구 토픽 재구독 `CHANNEL_ERROR`, 기존 열린 구독에도 서버가 구 토픽에 0행 발행, 신 토픽 1 수신 |
| C7 | 늦은 lease 갱신 응답 / 회전과 경쟁 | **PASS** | 회전된 세대·만료 lease 갱신 모두 `denied`(서버). 클라 측 늦은 성공 처리(세대 비교)는 구현 부재로 클라 계층 NOT MEASURED |
| C8 | 로그아웃 요청 미도달 | **PASS** | TTL 6s에서 마지막 전달 5457ms, 7272ms 첫 서버 거부 → **잔존은 로그아웃이 아니라 lease TTL이 경계**. GoTrue 글로벌 signOut도 이미 join된 채널은 닫지 않음(JWT exp까지 유효) |
| C9 | 연결 유지 중 제재 발생 | **PASS** | 제재 전 1 수신, 제재 후 서버 발행 0·수신 0; **대조군(재검사 없는 발행자가 구 토픽에 직접 INSERT)은 전달됨** → 서버의 수신자별 재검사가 유일 경계임을 증명; 제재 중 재join `CHANNEL_ERROR` |
| C10 | RPC 응답 capability 누출 | **PASS** | 6수신자 lease/inbox id 누출 0; 응답 키에 topic/inbox 없음(`senderClientSessionId`는 발신자 자신의 선언 presence id로, 수신자 capability 아님) |

**판정:** 수신자별 private inbox는 **서버가 유일한 전달 경계**로 동작한다. 비인가 구독·위조 발행·provider 오용·capability 재사용·세대/제재/로그아웃 모두 실제 수신 0으로 차단됐다. C8은 잔존 노출이 **lease TTL로 상한**됨을(로그아웃 도달 여부와 무관) 명확히 했다 — 따라서 TTL 선택이 보안 잔존시간의 핵심이다(§8).

---

## 7. 멱등성·정규화 테스트 결과 (실험 D)

JS 측은 저장소 `apps/world/src/network/protocol.js`(main `0dcae7b`)를 **그대로 임포트**해 실행했다. 증거: `results/D-idempotency-normalization.json`(D7-table에 28개 벡터 전문).

| ID | 항목 | 판정 | 실제 관찰 |
| --- | --- | --- | --- |
| D1-server | requestId 형식·최초 도착 시각(UUIDv7 내장 시각) | **PASS** | UUIDv4 `request_id_invalid`; v7 11분 전/5분 후 `request_expired`; 9분 전 승인 |
| D1-client | requestId는 제출 시 생성(클라이언트) | **NOT MEASURED** | `main`에 캠퍼스 requestId 구현 없음(`ChatComposer.submit`은 Realtime broadcast 직송). Stage B 구현·검증 필요 |
| D2-D4 | 최초/재조회 동일 Envelope, 세션·generation·구역 변경 후 재조회 | **PASS** | 이동·재입장·조회 모두 **원 구역·원 세대의 바이트 동일 Envelope** replay, 신규 행 0, 새 구역 수신자 전달 0 |
| D5-D6 | 재시도/조회 기간 창, 초과 거부 | **PASS**(창을 2s/4s로 축소) | 창 내 replay, 창 후 `retry_expired`/`lookup_expired`, cleanup 후 승인 제거. 실제 10분/30분 벽시계는 대기하지 않음(축소 검증) |
| D7-canon | NFC·제어·공백·길이 JS↔PG | **FAIL(1/28)** | 27개(한글 완성/조합형, 터키 I, 그리스, 결합문자, 이모지 ZWJ/깃발/스킨, 제어, ZWSP/BOM, bidi, 공백, 길이 120/121) **완전 일치**(PostgREST 왕복 포함). 불일치 1건: **Unicode 16.0 신규 문자 Kirat Rai `U+16D67`** — Node(Unicode16)는 NFC 합성, PG(Unicode15.1)는 미합성 |
| D7-lower | 로케일 소문자 JS↔PG | **FAIL** | ICU/collate "C"에서 터키·그리스·Unicode16 불일치. **단 SEC-01 서버는 소문자화를 하지 않음**(반복 억제는 클라 UX) → 정보성 |
| D8-coords | 좌표 반올림·음수0·경계 | **FAIL(8/22)** | `.xx5` 중간값에서 JS `Math.round(v*100)/100`(이진 부동·half-up)과 PG `round()`(십진 half-away)가 0.01 차이(1.005→JS 1.00/PG 1.01). 범위검사 순서 차이로 `100000.004` 수용(JS)/거부(PG). 음수0은 `JSON.stringify(-0)="0"`로 서버 도달 전 소거 |

**판정:** 서버 권한 멱등성·기간 창·Envelope 불변성은 **PASS**. 그러나 **클라이언트 requestId 미구현(NOT MEASURED)** 이고, JS와 PostgreSQL의 정규화는 **Unicode 버전 경계와 부동소수 중간값에서 불일치**한다. 핵심 함의:
- **정규화/반올림은 단일 권한(서버)으로 확정**해야 한다. 서버는 비정규 입력을 `malformed`로 **거부**(fail-closed)하므로, 클라가 Unicode16 문자를 NFC 합성해 보내면 손상이 아니라 **거부**된다. 그러나 사용자 경험상 클라/서버 Unicode 버전 핀 고정이 필요하다.
- 좌표가 멱등성 지문에 포함되면 **서버만 반올림**해야 하며(결정적), 클라가 독립 반올림한 값을 지문에 넣으면 0.01 불일치가 발생할 수 있다. 캠퍼스 채팅에서 좌표는 15m 표시 필터용이라 0.01m는 무의미하나, 계약으로 "서버 권한·십진 half-away, 범위검사-후-반올림"을 명시해야 한다.

---

## 8. 규모별 성능 측정표 (실험 E)

합성 계정·세션·메시지. 단일 4-vCPU 호스트, 전 클라이언트가 **단일 Node 프로세스**. 상대 증거이며 운영 용량 수치가 아니다. 증거: `results/E-scale.json`, `results/E-scale.log`. 시나리오당 40 메시지(paced, rate=min(10,0.5N)/s) + 전원 동시 1회(burst) + 전원 renew.

| 지표 | 소규모 N=2 | 일반 N=10 | 중간 N=30 | 혼잡 N=100 |
| --- | --- | --- | --- | --- |
| 구독 성공 | 2/2 | 10/10 | 30/30 | 100/100 |
| 승인 RPC p50 / p95 (ms) | 8.26 / 10.84 | 8.54 / 12.93 | 11.16 / 16.07 | 21.72 / 29.58 |
| 발행 DB 함수 p50 (ms, HTTP 제외) | 1.81 | 3.42 | 6.15 | 16.38 |
| Realtime 전달 p50 / p95 (ms) | 9.11 / 12.6 | 9.44 / 15.15 | 13.23 / 19.95 | 29.95 / 37.88 |
| 수신자별 fan-out / 메시지 | 1 | 9 | 29 | 99 |
| paced 전달 완전성(수신/기대 프레임) | 29/29¹ | 360/360 | 1160/1160 | **1584/3960**² |
| DB 쓰기 / 메시지 (approval/delivery/realtime insert) | 0.73 / 0.73 / 0.75 | 1 / 9 / 9.2 | 0.95 / 27.6 / 27.6 | 0.95 / 94 / 94 |
| sessions 테이블 스캔 / 메시지 | 6.5 | 7.5 | 7.2 | 7.4 |
| lease 갱신 RPC p50 (ms) | 6.56 | 13.98 | 32.12 | 122.49 |
| DB CPU ms / 메시지 (cgroup) | 72.6¹ | 21.5 | 16.5 | 30.0 |
| Realtime 메모리 (load 후, MB) | 198.9 | 200.0 | 204.7 | 217.2 |
| 저장량 / 메시지 (delivery+realtime, byte) | ~3.1K | ~12.5K | ~38.9K | ~129K |
| burst 벽시계 (ms) / 전달 | 9 / 0¹ | 30 / 90/90 | 212 / 870/870 | 1062 / **0/9900**² |
| 실패율 / 사유 | 0.275¹ | 0 | 0 | 0 |

¹ **N=2 아티팩트:** rate=1/s로 40메시지 = ~40s가 lease TTL 30s를 초과해 일부 `denied`(서버 fail-safe, 결함 아님). burst도 그 여파로 0. DB CPU/메시지는 메시지 수가 적어 상대적으로 큼.
² **N=100 수신 완전성은 클라이언트 측 포화:** 서버는 메시지당 realtime insert ≈ N-1(94)·burst 9900행을 **모두 기록**(DB 쓰기 열 참조)했다. 단일 Node 프로세스가 100개 WebSocket에서 4s 창 내에 9900 프레임을 수신하지 못한 것으로, **서버 손실이 아니라 측정 하네스의 단일 프로세스 한계**다. N≤30 paced/burst는 100% 수신.

**측정 못 한 항목(NOT MEASURED):** 운영 Realtime WebSocket 실전달 지연, 물리 iOS/Android, N≥30 **실 멀티프로세스 수신 완전성**, 네트워크 왕복(모두 로컬).

**TTL·갱신 간격 권고(고정 정답 가정 금지):** C8이 보인 대로 **보안 잔존시간 = lease TTL**이다. 측정에서 renew RPC p50은 N=100에서 122ms로 승인(22ms)보다 비싸다(fan-out 없는 단일 행이지만 100개 동시 renew 경합). 후보 비교:

| 후보 TTL / 갱신 | 보안 잔존 | 성능/운영비 | 비고 |
| --- | --- | --- | --- |
| 30s / 10s (PR #353 chat과 동일) | 최대 30s 잔존 | renew 부하 ↑ (사용자당 6/분) | 제재 후 최대 30s 노출 |
| 20s / 7s | 최대 20s | 중간 | 동아리방(PR #353)과 동일 |
| 15s / 5s | 최대 15s | renew 부하 최대 | 혼잡 구역 renew 경합 ↑ |

권고: **캠퍼스는 15m 근접 필터 + 다중 참여** 특성상 제재/차단 반영이 중요하므로 **TTL 20–30s, 갱신 TTL의 1/3**을 후보로 하되, N=100 renew p50(122ms)이 승인과 경합하므로 **갱신을 지터링**하고 실 멀티프로세스 부하로 재측정 후 확정. 현 데이터로 단일 값을 "정답"으로 고정하지 않는다.

---

## 9. Avatar Binding 검증 결과 (실험 F)

피해자(U1)·관찰자(U3)는 **저장소의 실제 클라이언트 스택**(`SupabaseRealtimeTransport`+`NetworkManager`+`RemotePlayerManager`, main `0dcae7b`)을, 공격자(U2)는 동일 토픽의 평범한 두 번째 인증 계정을 사용했다. 기존 Presence/Pose 전송은 변경하지 않았다. 증거: `results/F-avatar-binding.json`.

| ID | 핵심 질문 | 판정 | 실제 관찰 |
| --- | --- | --- | --- |
| F2-F3 | 타인 userId/sessionId로 아바타 사칭 가능? | **FAIL(사칭 가능)** | 두 번째 계정이 캠퍼스 토픽 join 성공(`SUBSCRIBED`), **U1의 sessionId를 키로 한 Presence track 성공(`ok`)**. 더 늦은 `joinedAt`으로 **실제 U1 아바타를 축출**(`realU1StillVisible:false`), 관찰자 모델에 위조 세션 표시. Realtime RLS는 소켓만 인가, Presence 메타를 `auth.uid()`에 묶지 않음; `validatePresence()`는 `packet.userId`를 신뢰 |
| F1 | 서버 인증 채팅 세션 ↔ 시각적 아바타 안전 대응? | **FAIL** | 두 번째 계정 broadcast가 관찰자 `ChatFeed`에서 U1 이름의 **말풍선 위조**(`F 사칭 2`). 캠퍼스 채팅 경로는 말풍선 이름을 클라 선언 Presence에서 파생 — 아바타에 묶인 서버 인증 채팅 세션이 없음 |
| F4 | 아바타 미인증 시 피드 전용 안전 경로 동작? | **PASS** | 서버 Envelope `senderUserId`=`auth.uid()` 일치, `senderName` 서버 파생(`profiles`), 아바타 세션 바인딩 미포함 → Presence 불신뢰 피드 한 줄 가능 |
| F5 | 기존 전송 변경 없이 정상 말풍선 보존? | **PASS(단, 보존 불가 조건부)** | Pose/Presence 패킷 형태 main과 동일. 그러나 안전한 말풍선은 **presence→채팅세션 바인딩**이 필요하며 **현재 없음** |

**판정:** 과제 질문에 대한 답 —
1. 서버 인증 채팅 세션과 시각 아바타의 안전 대응: **현재 불가**(F1 FAIL). 서버 Envelope은 신원을 신뢰할 수 있으나, 그 Envelope을 **특정 화면 아바타(sessionId)에 안전히 매핑**할 방법이 없다.
2. 클라 선언 Presence 위조 가능: **가능**(F2-F3).
3. 타인 userId/sessionId 아바타 사칭: **가능**, 심지어 실제 플레이어 축출까지.
4. 아바타 미인증 시 피드 전용 안전 경로: **동작함**(F4 PASS).
5. 기존 전송 변경 없이 정상 말풍선 보존: **불가**(F5) — 보존하려면 바인딩 신설 필요.

**불가 시 요구 범위(과제 지시):**
- **필요한 Presence/Pose 변경:** Presence 메타의 `sessionId`/`userId`를 **서버 발급 토큰**(채팅 lease의 `senderClientSessionId`와 서버가 검증하는 서명/대조)으로 바인딩하거나, Realtime가 Presence 키를 `auth.uid()`로 강제하도록 전환.
- **변경 영향:** 전 캠퍼스 Presence 경로(게스트 포함) 재작성, `validatePresence`에 서버 신뢰 신원 주입.
- **예상 회귀 위험:** 리모트 아바타 표시·"한 userId 당 최신 세션" 로직(`remote-player-manager.js`)·장비 투영·미니맵이 Presence 신원에 의존 → 광범위 회귀.
- **기존 PR 충돌:** PR #353은 룸 전용이라 캠퍼스 Presence를 건드리지 않음 → 직접 충돌은 적으나 동일 transport 공유.
- **Stage B 별도 작업:** 아바타↔서버 채팅 세션 인증 바인딩 설계·구현·공격 재실증.

**Stage A의 피드 전용 구현을 SEC-01 전체 완료로 판정하지 않는다.**

---

## 10. 결함 및 차단 요인

**결함 (FAIL):**
1. **provider 비원자 발행** (A3-provider/A3-send-mode, PR353-A3): `realtime.send`는 실패를 `WARNING`+`void`로 숨김. PR #353 발행이 `ok:true`+전달 0 가능. → 직접 INSERT+행수 검증으로 교체 필요.
2. **운영자 제재 공유 잠금 부재** (B3-existing, B9): 제재 RPC가 발행과 잠금 미공유 → 제재 확정 후 in-flight 발행 전달. ban/해제 RPC 부재.
3. **아바타 사칭** (F1, F2-F3): 기존 Presence 전송에서 신원 위조·아바타 축출·말풍선 위조 가능.
4. **클라/서버 정규화·반올림 불일치** (D7-canon Unicode16 1건, D7-lower, D8-coords): 단일 권한화·버전 핀 필요.

**차단 요인 (BLOCKED) / 미측정 (NOT MEASURED):**
- B4 제재 해제: 해제 RPC 부재로 잠금 계약 검증 불가(단 경쟁 결과는 fail-safe).
- D1-client: 캠퍼스 requestId 클라 구현 부재.
- 운영 Supabase Realtime 실 2계정 전달, 물리 iOS/Android, 운영 DB 콜레이션/Unicode 버전: **접근 금지로 미검증**.
- N≥30 실 멀티프로세스 수신 완전성: 단일 프로세스 하네스 한계.

---

## 11. 구현 계약 변경 필요 여부

운영 설계를 임의 변경하지 않고, 활성화 전 필요한 계약 변경을 제시한다:

1. **발행 원자성:** `realtime.send` 반환을 성공 근거로 쓰지 말 것. 수신자별 `realtime.messages` **직접 INSERT + `GET DIAGNOSTICS row_count=1` 검증**을 승인·Envelope·delivery 기록과 **동일 트랜잭션**에 둘 것. (lab A3-insert 통과)
2. **운영자 제재/ban/해제:** 발행자가 잡는 **공유 권한 잠금**(예: `authority_key(target)`)을 제재·ban·해제 RPC도 획득하도록 신설. 해제 RPC 자체를 신설. (lab B3-locked 통과)
3. **requestId 멱등성:** 제출 시 UUIDv7 1개 생성·재시도 시 동일 전송, 서버는 내장 시각으로 10분/30분 창 적용, 다른 본문 `request_conflict`. 클라 구현 필요.
4. **정규화 단일 권한화:** 서버 NFC/제어/공백 규칙을 권한으로 하고 클라/서버 **Unicode 버전 핀 고정**. 좌표는 서버만 반올림(십진 half-away, 범위검사-후-반올림), 음수0 소거.
5. **TTL:** 20–30s 후보, 갱신 1/3, 지터링. 실 부하 재측정 후 확정.
6. **아바타 바인딩(Stage B):** Presence 신원의 서버 인증 바인딩 설계.

---

## 12. Stage B 진행 가능 여부

**조건부 가능.** 서버 측 inbox 보안·fail-closed 발행·멱등성·잠금 후 재검사의 핵심 경계가 격리 실증됐으므로 Stage B(아바타 인증 설계)로 **설계 착수는 가능**하다. 단, Stage B 착수와 **동시에** §11의 1·2·3번(발행 원자성, 제재 공유 잠금, 클라 requestId)을 해결해야 하며, 활성화는 다음 게이트를 **모두** 통과하기 전까지 보류한다: 운영 2계정 실 Realtime 전달 검증, 물리 모바일, 운영 콜레이션/Unicode 확인, retention(최대 3일 `realtime.messages`) 공개·승인, 대상별 마이그레이션/배포/머지 승인.

---

## 13. 다음 최소 실행 작업

1. 발행 RPC를 `realtime.send` → **직접 INSERT + 행수 검증**으로 바꾼 후보를 lab에 적용해 A 전 항목 재실행.
2. 제재/ban/해제 RPC에 **공유 권한 잠금** 추가 후보로 B3·B8 재실행(deadlock·순서 불변식).
3. 클라이언트 **requestId(UUIDv7)** 생성·재시도 경로 구현 후 D1-client 측정.
4. 클라/서버 **Unicode 버전·콜레이션 핀**, 좌표 서버-권한 반올림 계약 확정 후 D7/D8 재실행.
5. **실 멀티프로세스**(프로세스=세션) 하네스로 N≥30 수신 완전성·burst 재측정, TTL 후보 확정.
6. Stage B: Presence↔서버 채팅 세션 **인증 바인딩** 설계 및 F1/F2-F3 재공격.
7. (권한 확보 시) 운영과 분리된 전용 Supabase 프로젝트에서 **2계정 실 WebSocket** 전달 검증.

---

## 11′ 최종 판정 → **B. STAGE A CONDITIONAL**

핵심 서버 보안 경계(수신자별 inbox 격리, fail-closed 직접 INSERT 발행, 서버 권한 멱등성/기간 창, 잠금 후 `clock_timestamp()` 재검사, 차단/generation/lease/세션 동시성)는 실제 PostgreSQL + 실제 Supabase Realtime에서 **검증 통과**했다. 그러나 **(1) 운영자 제재 계열의 공유 잠금 미충족, (2) provider 기반 발행의 비원자성, (3) 클라 requestId·정규화 단일 권한화 미완, (4) 아바타 인증 미구현** 이 남아 있고, **운영 Realtime·물리 모바일·운영 콜레이션은 미검증(BLOCKED)**이다. 조건과 범위는 §10–§13에 명시했다. 조건부/차단 항목을 PASS로 승격하지 않으며, 본 보고 이후 임의 병합·배포·운영 마이그레이션을 진행하지 않는다.

---

### 부록 · 재현 방법 / 증거 경로
- 격리 환경 구축·재현: [`results/README_REPRODUCE.md`](results/README_REPRODUCE.md)
- 환경 캡처: [`results/ENVIRONMENT.txt`](results/ENVIRONMENT.txt)
- lab SQL(마이그레이션 아님): [`sql/10_sec01_campus_chat_lab.sql`](sql/10_sec01_campus_chat_lab.sql)
- 하네스: [`harness/`](harness/) (`lib.mjs`, `10-atomicity.mjs`, `15-pr353-provider-probe.mjs`, `20-concurrency.mjs`, `30-inbox.mjs`, `40-idempotency-normalization.mjs`, `50-scale.mjs`, `60-avatar-binding.mjs`)
- 원시 결과 JSON: [`results/`](results/) (`A-atomicity` `B-concurrency` `C-inbox` `D-idempotency-normalization` `E-scale` `F-avatar-binding` `PR353-probe`)
