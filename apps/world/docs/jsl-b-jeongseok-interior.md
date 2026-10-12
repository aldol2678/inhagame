# JSL-B · 정석학술정보관 1F/B1 실내 블록아웃

상태: **JSL_B_BLOCKOUT_READY / JSL_B_INTEGRATION_PENDING (JSL-A) / JSL_B_FULL_FIDELITY_HOLD**.
게임용 제한 블록아웃이며 실제 평면·현행 게이트 위치·층간 동선의 재현이 아니다
(`JEONGSEOK_INTERIOR_CLAIM.realityReproduction === false`).

## 공간과 흐름

| Room ID | 공간 | 주요 근거 |
| --- | --- | --- |
| `ROOM_JEONGSEOK_LOBBY` | 1층 중앙 로비: 광택 회색 타일, 격자 커튼월, 회색 기둥, 식재, 안내 데스크, 검색 단말, 게이트 열과 상부 사이니지 | `JSL-R0-F03-LOBBY-2015` (HISTORICAL), `JSL-R0-LOBBY-2013-2017` |
| `ROOM_JEONGSEOK_B1_READING` | 통합 제2열람실: 단일 개방 공간, 목재 사각 기둥, 밝은 천장 패널, 흰 칸막이, 개방 테이블·스탠딩·접근성 좌석 | `JSL-R0-F03-READING-2026` (OBSERVED_MUSE) |
| `ROOM_JEONGSEOK_B1_CREATIVE` | Creative Space 학습 존(목재 세로살 원형 기둥, 어두운 격자 천장·다운라이트, 긴 테이블, 소파, 창, 곡선 유리) + 강연 존(남색 벽, 스크린, 계단식 좌석, 링 펜던트, 카펫) + 대표 유리 스터디룸 2개 | `JSL-R0-F03-CREATIVE-2024`, `JSL-R0-CREATIVE-FACILITY-GUIDE` |

```
캠퍼스(LIBRARY_FRONT 착지) ─문─▶ 1F 로비 ─임시 층간 이동─▶ B1 제2열람실 ⇄(B1 임시 연결)⇄ B1 Creative Space
B1 ─나가기─▶ 1F 로비(사용한 이동 지점) ─나가기─▶ JEONGSEOK_CAMPUS_RETURN
```

모든 이동 지점·스폰·앵커·존 경계는 `GAME_ADAPTATION`이며 계단·엘리베이터 위치를 주장하지 않는다.
게이트 열은 `JEONGSEOK_LOBBY_GATE_SLOT` 하나로 교체 가능하고, 플랩 애니메이션은 근접 시 시각 효과일 뿐 권한과 무관하다.
474석·대학원생 54석은 참고 수치이며 벽이나 별실로 만들지 않는다. 미배치 스터디룸 6개는 좌표 없는 `RESERVED_UNPLACED` 슬롯이다.

## 출입 정책 (`src/jeongseok/entry-policy.js`)

| 모드 | 조건 | 결과 |
| --- | --- | --- |
| `CLOSED_PENDING_JSL_A` | 기본(모든 운영 호스트) | 문 액션 없음, Room Transition이 Jeongseok room을 거절 |
| `VISUAL_PREVIEW_LOCAL_ONLY` | preview host + `?jeongseok=jsl-b` | 로컬 시각 검수 전용. 서버 보호 출입이 아님 |
| `SERVER_GRANT_JSL_A` | JSL-A 병합 후 연결 | JSL-A `onEnter(fresh)`의 GRANTED 스냅샷 1회 = 입장 1회 |

`room-transition.js`의 `accessPolicies`는 정책 키가 없으면 **fail-closed**로 거절한다.
실내는 Realtime 채널 없는 로컬 장면이라 서버 room join/invite/resume/Realtime 경로가 존재하지 않는다.
공용 실내 세션을 추가할 때는 서버 재검증(`private.world_jeongseok_access_v1()`)이 전제다.

### JSL-A(PR #358) 연결 계약

```js
// jeongseok-feature.js 의 gate controller
onEnter: fresh => jeongseokInterior.enterFromServerGrant(fresh, { mounted: controller.mounted })
// 모드: resolveJeongseokEntryMode({ serverAccessAvailable: true })
// 계정: jeongseokInterior.setAccount(userId)  (이미 main.js 연결)
// 체류 중 재조회: jeongseok.access.onChange(() => jeongseokInterior.revalidate(access.snapshot))
```

계정 전환·만료·재조회 거절 시 B1에서도 로비를 거치지 않고 캠퍼스 복귀 앵커로 강제 퇴장한다(`exit({ force, toCampus })`).

## 성능 원칙

정적 지오메트리는 재질별 1메시로 병합(`static-batch.js`), 방당 그림자 없는 omni 2개, 다운라이트·패널은 emissive.
첫 입장 시 빌드, 캠퍼스 복귀 시 해제. `low` 그래픽 단계에서는 장식(decor) 생략·세부 감소.
PC 60FPS / 모바일 30FPS는 목표 후보이며 GPU 실기기 측정 전 PASS가 아니다.

## 검증

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

- 사서 NPC 앵커: 로비 `info_desk` 슬롯 뒤(교체 가능), 기존 NPC Population 재사용
- 도서 검색: `search_kiosk_*` 모듈에 Context Action 추가, 결과는 결정적 데이터·서버 퀘스트 확인
- 독서/좌석: 열람실 `chair`/`carrel` 항목을 기존 seating 시스템 좌석으로 등록(현재 미등록)
- 보상은 기존 Quest/Reward 권위만, 입장 권한은 JSL-A 서버 판정 유지
