# JSL-B · 정석학술정보관 1F/B1 실내 블록아웃

상태: **PUBLIC_LOBBY_ENABLED / INNER_GATE_SERVER_CONTROLLED / JSL_B_FULL_FIDELITY_HOLD**.
승인된 클라이언트 활성화는 main constructor의 `serverAccessAvailable: true`로 `SERVER_GRANT_JSL_A`를 선택한다. 공개 로비는 게스트에게도 열리며 내부/B1는 서버 grant가 필요하다. resolver의 미설정 기본값은 계속 `CLOSED_PENDING_JSL_A`다. 서버 게이트·판매 활성화는 별도 DB 작업이며 이 코드 변경은 운영 DB 상태를 증명하거나 변경하지 않는다.
게임용 제한 블록아웃이며 실제 평면·현행 게이트 위치·층간 동선의 재현이 아니다
(`JEONGSEOK_INTERIOR_CLAIM.realityReproduction === false`).

## 공간과 흐름

| Room ID | 공간 | 주요 근거 |
| --- | --- | --- |
| `ROOM_JEONGSEOK_LOBBY` | 1층 중앙 로비: 광택 회색 타일, 격자 커튼월, 회색 기둥, 식재, 안내 데스크, 검색 단말, 게이트 열과 상부 사이니지 | `JSL-R0-F03-LOBBY-2015` (HISTORICAL), `JSL-R0-LOBBY-2013-2017` |
| `ROOM_JEONGSEOK_B1_READING` | 통합 제2열람실: 단일 개방 공간, 목재 사각 기둥, 밝은 천장 패널, 흰 칸막이, 개방 테이블·스탠딩·접근성 좌석 | `JSL-R0-F03-READING-2026` (OBSERVED_MUSE) |
| `ROOM_JEONGSEOK_B1_CREATIVE` | Creative Space 학습 존(목재 세로살 원형 기둥, 어두운 격자 천장·다운라이트, 긴 테이블, 소파, 창, 곡선 유리) + 강연 존(남색 벽, 스크린, 계단식 좌석, 링 펜던트, 카펫) + 대표 유리 스터디룸 2개 | `JSL-R0-F03-CREATIVE-2024`, `JSL-R0-CREATIVE-FACILITY-GUIDE` |

```
캠퍼스(LIBRARY_FRONT 착지) ─문─▶ 1F 공개 로비 ─서버 재확인·내부 게이트─▶ 내부 로비 ─임시 층간 이동─▶ B1 두 공간
B1 ─나가기/권한 소실─▶ 1F 공개 로비 안전 앵커 ─나가기─▶ JEONGSEOK_CAMPUS_RETURN
```

모든 이동 지점·스폰·앵커·존 경계는 `GAME_ADAPTATION`이며 계단·엘리베이터 위치를 주장하지 않는다.
게이트 열은 `JEONGSEOK_LOBBY_GATE_SLOT` 하나로 교체 가능하고, 플랩 애니메이션은 유효한 내부 세션이 있을 때만 근접 반응한다. 실제 닫힌 충돌 경계는 별도 전체 높이 collider로 정상 런타임에 포함된다.
474석·대학원생 54석은 참고 수치이며 벽이나 별실로 만들지 않는다. 미배치 스터디룸 6개는 좌표 없는 `RESERVED_UNPLACED` 슬롯이다.

## 출입 정책 (`src/jeongseok/entry-policy.js`)

- 활성화된 클라이언트에서는 게스트를 포함해 누구나 외부 문에서 공개 로비로 입장한다. 공개 로비 입장은 보호 grant를 요구하거나 소비하지 않는다.
- 내부 게이트의 리더는 `get_jeongseok_access_v1`을 재조회한다. 인하대 메일 인증 영구 계정은 무료, 나머지 적격 영구 계정은 유효한 방문증이 필요하다. 메일 인증은 재학 여부 증명이 아니다.
- 공개 쪽의 가상 안내 NPC에서만 방문증 구매 UI를 시작한다. 게스트는 안내를 읽을 수 있지만 구매에는 로그인이 필요하다.
- 확정 상품은 100인덕코인 / 발급 시점부터 현실 시간 24시간. 새 forward migration은 가격 근거를 `CONFIRMED`로 바꾸며 rollout 상태는 보존한다. 초기 상태는 계속 `COMING_SOON`이다.
- Reader의 최종 `onEnter`는 같은 계정의 fresh grant 하나를 15초의 내부 진입 기회로 소비한다. 실제 경계를 넘어야 체류가 시작되고, 공개 쪽으로 돌아오면 세션이 끝난다.
- 내부/B1 체류는 방문증 만료, 계정 변경, 인증 철회/서버 거절/조회 오류 시 종료한다. 30초마다 서버 확인, 조회 제한 8초. 페이지 숨김·복귀·BFCache 복귀·창 포커스 복귀는 기존 세션을 폐기하고 다시 태그하도록 한다.
- B1 복귀 앵커는 항상 공개 로비다. 강제 복귀 실패 시 Room Transition이 입력 잠금을 유지하며, 로비 위치 복구 실패도 별도 SYSTEM_LOCK으로 처리한다.
- 승인 없는 복원·텔레포트·고속 이동으로 내부 좌표에 놓이면 다음 정상 런타임 갱신에서 공개 앵커로 보정한다. B1 직접/형제 이동은 보호 predicate와 전환 중 재검증을 거친다.

| 모드 | 조건 | 결과 |
| --- | --- | --- |
| `CLOSED_PENDING_JSL_A` | resolver 미설정 기본값 또는 명시적 비활성화 | 외부 문 없음, 모든 정석 방 입장 거절 |
| `VISUAL_PREVIEW_LOCAL_ONLY` | 정확한 loopback hostname (`localhost`, `127.0.0.1`, `[::1]`) + `?jeongseok=jsl-b` | 시각 검수용 보호 경계 우회. 운영 출입 검증으로 주장하지 않음 |
| `SERVER_GRANT_JSL_A` | main의 명시적 `serverAccessAvailable: true` | 공개 로비 자유 입장, 내부/B1만 서버 결과 기반 세션 |

정석 visual preview는 전역 `previewHost`와 분리된 `isJeongseokVisualPreviewHost(location.hostname)`만 사용한다. `*.vercel.app`, `inhagame.app`, `localhost.evil`, `evil-localhost` 같은 공개·유사 호스트는 query와 무관하게 서버 grant 모드다. helper는 브라우저가 정규화한 hostname만 정확히 비교하며 URL 전체·포트 포함 host·공백·raw 대문자·비문자열 입력을 허용하지 않는다. IPv6는 브라우저 hostname 형식인 `[::1]`만 허용한다. 다른 기능의 전역 preview 설정은 바꾸지 않는다.

`room-transition.js`의 `accessPolicies`는 정책 키가 없으면 fail-closed로 거절한다.
기존 외관, canonical footprint, 캠퍼스 출입 위치는 바꾸지 않는다. 안내 NPC는 실존 직원·사서를 재현하지 않는 게임 캐릭터다.

### 권위와 명확한 한계

`purchase_jeongseok_pass_v1`의 서버 카탈로그·계정 검증·Wallet 원자 차감·advisory lock·idempotency를 그대로 재사용한다.
학생증 앱은 자격/방문증 표시이며 구매·차감을 자체 계산하지 않는다. 응답 유실은 같은 계정의 같은 요청 키로 복구한다.

실내는 서버 Room/Realtime 채널이 없는 로컬 장면이다. 충돌, 위치 보정, NPC 근접 확인은 정상 클라이언트의 흐름을 보호하지만 변조 클라이언트의 서버 위치 권위를 만들지는 않는다.
현 구매 RPC는 NPC 근접을 검증하지 않는다. 서버에 강제되는 권한은 인증/메일 자격/가격/차감/발급/기한이며, 서버 이동·공용 실내 세션은 별도 범위다.

### 적용 순서와 승인 경계

1. 로컬 코드·DB 후보·회귀 QA를 검토한다. 기존 migration 수정, grants 확장, 새 workflow는 없다.
2. 별도 승인 후 정확한 main 위에 한 번 게시하고 기존 필수 CI를 통과시킨다.
3. PR 병합/Production 배포와 운영 DB migration 적용은 각각 승인 범위 안에서 수행한다.
4. 공개 로비 활성화 constructor는 승인된 `serverAccessAvailable: true`를 사용한다. 클라이언트 배포 전에 운영 DB의 원본 JSL-A 및 새 정책 migration 계약·RPC·권한을 확인하고 게이트·상품은 `COMING_SOON`을 유지한다. 클라이언트 배포 확인 후 별도 승인 범위에서 게이트·상품을 원자적으로 `ACTIVE`로 변경한다. Production query로 활성화하거나 보호 경계를 우회하지 않는다. 코드 병합만으로 상품 상태를 `ACTIVE`로 바꾸지 않는다.
5. 활성화 후 합성/허용된 테스트 계정으로 무료/유료/잔액 부족/중복 키/만료/계정 전환을 재검증한다. 운영 결제 테스트는 사전 승인 없이는 수행하지 않는다.

## 성능 원칙

정적 지오메트리는 재질별 1메시로 병합(`static-batch.js`), 방당 그림자 없는 omni 2개, 다운라이트·패널은 emissive.
첫 입장 시 빌드, 캠퍼스 복귀 시 해제. `low` 그래픽 단계에서는 장식(decor) 생략·세부 감소.
PC 60FPS / 모바일 30FPS는 목표 후보이며 GPU 실기기 측정 전 PASS가 아니다.

## 검증

브라우저 QA의 공개 로비·합성 Auth/RPC·실제 disposable DB 케이스는 constructor를 주입하지 않고 배포될 main 원본을 실행한다. 브라우저가 실제 받은 main 응답과 checkout 원본의 SHA-256 일치를 확인하고 기록한다. 별도 CLOSED 회귀만 loopback에서 constructor를 명시적으로 false로 바꿔 로비/B1 거절과 query 비활성화를 확인한 뒤 route를 해제한다. 접근 정책·충돌·세션은 대역으로 교체하지 않는다. 합성 Auth/RPC 케이스와 실제 disposable DB 케이스를 구분한다.

- `node --test apps/world/tests/jeongseok-interior.test.mjs`
- `node apps/world/tests/browser/jeongseok-interior-smoke.mjs` (오프라인 Chromium, desktop / 390×844 / 844×390)

### 실기기 요청 항목 (미수행 · UNKNOWN)

1. iOS Safari / Android Chrome 세로·가로: 입장→B1 두 공간→복귀, 조이스틱·컨텍스트 버튼·스마트폰 열고 닫기
2. 실제 GPU(WebGPU 및 WebGL2)에서 로비·열람실·Creative FPS, 로딩 시간, 메모리
3. 저사양 모바일(`low` 단계)에서 낮은 천장 열람실 카메라 체감

## 남은 미확인 (FULL_FIDELITY_HOLD)

2026 게이트 수·위치·모델, 1F↔B1 실제 코어, 제2열람실 전체 평면·철거 벽 위치, 대학원생 54석 물리 관계,
Creative Space 존 연결·외부 출입·창 방위, 스터디룸 8개 배치.

## JSL-C 연결 요구사항

- 공개 안내 NPC는 출입 안내·구매 전용. 추후 사서/검색/퀘스트 역할 확장은 별도 범위
- 도서 검색: `search_kiosk_*` 모듈에 Context Action 추가, 결과는 결정적 데이터·서버 퀘스트 확인
- 독서/좌석: 열람실 `chair`/`carrel` 항목을 기존 seating 시스템 좌석으로 등록(현재 미등록)
- 보상은 기존 Quest/Reward 권위만, 입장 권한은 JSL-A 서버 판정 유지
