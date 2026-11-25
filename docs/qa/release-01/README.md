# RELEASE-01 통합 안정화 검증 기록 (2026-11-25)

목표 출시일 2026-12-18 대비, 공식 PlayCanvas 런타임(`apps/world`, Cloudflare 정적 빌드)을 대상으로 한 검증 기록이다.
기준 커밋은 `main` 67f2632(#466 병합)이고, 수정 후보는 이 브랜치의 두 커밋이다.

## 검증 환경과 한계

- 모든 브라우저 검증은 클라우드 컨테이너의 **헤드리스 Chromium + SwiftShader(소프트웨어 WebGL2)** 에뮬레이션이다.
  Android는 Playwright `Pixel 7`, iPad는 `iPad Pro 11 landscape` 프로필(화면 크기·터치·UA)을 Chromium 위에서 흉내 낸 것이다.
- **실기기(Android 폰, iPad)와 Safari/WebKit 엔진, 실제 GPU, WebGPU 경로는 검증하지 못했다.** 이 컨테이너에는 WebKit이 없다.
  저장소의 `iPad campus entry / webkit` 워크플로가 WebKit 진입을 별도로 다룬다.
- 외부 요청은 모두 차단하고 `/api/*`는 204로 응답시켰다. 따라서 서버 저장(진행도·지갑·인벤토리·하우징)과 실시간 접속은 검증 범위 밖이다.
- 연속 플레이는 진행 속도를 위해 그래픽 품질 `very_low`로 고정했다. 기본(자동) 품질 부팅은 `boot-auto.json`에 따로 기록했다.
- 긴 구간(정문→본관, 본관→인경호)은 좌표 이동으로 건너뛰고, 정문 통과·계단 오르내리기·비행·하차 후 보행은 실제 키/터치 입력으로 수행했다.

## 연속 플레이 결과

한 세션에서 로비 → 정문 입장 → 정문 통과(퀘스트 1/2) → 본관 계단 오르기(퀘스트 2/2) → 계단 내려오기 → 인경호 NPC 대화 →
안뇽이 탑승·지상 하차·비행·착지 → 로컬 저장 → 새로고침 후 이어하기 → 그래픽 컨텍스트 손실·복구 순서로 진행한다.

| 프로필 (에뮬레이션) | main 67f2632 | 수정 후보 |
| --- | --- | --- |
| PC 1280×720, 키보드 | 23/25 | 24/25 |
| Android (Pixel 7, 터치) | 23/26 | 25/26 |
| iPad (Pro 11 가로, 터치) | 24/26 | 25/26 |

- main에서 실패한 항목은 `I1`(그래픽 손실 안내 없음)과 `H2b`(게스트 세션 ID가 새로고침마다 바뀜)다.
  Android의 `I2`는 초기 측정 임계값(복구 화면 크기 3배)이 모바일 HUD 화면에 맞지 않아 생긴 측정 오류이며, 같은 기록의 수치(478393 대 245274바이트)는 이후 기준(1.5배)을 만족한다.
- 수정 후보에서 남은 실패는 `H2b` 하나이고, 인증 범주라 이 PR에서 고치지 않았다(아래 별도 목록).
- 원시 결과: `results/main/*-journey.json`, `results/fix/*-journey.json`. 손실 화면: `screens/`.

## 부팅·에셋 로딩 (자동 품질)

| 프로필 | 상태 | 렌더러 | 자동 품질 | 요청 수 | 실패 요청 | 콘솔 오류 |
| --- | --- | --- | --- | --- | --- | --- |
| PC 1366×768 | READY | WebGL2 | high | 606 | 0 | 0 |
| Android Pixel 7 | READY | WebGL2 | low | 601 | 0 | 0 |
| iPad Pro 11 가로 | READY | WebGL2 | low | 603 | 0 | 0 |
| iPad Pro 11 세로 | READY | WebGL2 | low | 602 | 0 | 0 |

main과 수정 후보의 값이 같다(`results/*/boot-auto.json`). 부팅 시간은 소프트웨어 렌더러 기준이라 실기기 성능을 나타내지 않는다.

## 운영 배포 대조

`https://inhagame.app`의 공개 파일 942개를 `reference.json`(main)과 읽기 전용으로 대조했다.
939개가 바이트 단위로 같고, `privacy.html`·`support.html`·`terms.html` 3개는 Cloudflare 이메일 난독화가 주소를 치환한 차이만 있다
(`results/production-compare.json`). 운영에 대한 쓰기, 배포, DB 접근은 하지 않았다.

## 이 PR의 수정

**그래픽 손실 시 안내 없음.** WebGL 컨텍스트가 사라지면 캔버스가 어두워진 채 HUD 버튼만 남고 아무 안내가 없었다
(`screens/main-pc-12-context-lost.png`). 컨텍스트가 돌아오면 렌더링은 정상 재개되지만, 돌아오지 않으면 플레이어가 할 수 있는 일이 없었다.
이제 화면이 보이는 상태로 4초 동안 복구되지 않으면 안내와 ‘다시 불러오기’ 버튼을 띄우고, 복구되면 지운다.
백그라운드 탭에 있던 시간은 세지 않는다. 위치는 기존 로컬 이어하기 기록으로 복원된다.

- 변경 파일: `src/diagnostics/runtime-diagnostics-runtime.js`, `runtime-diagnostics.css`, 단위 테스트, `reference.json`의 해당 해시 2개.
- 빌드 결과 942개 중 위 두 공개 파일만 달라진다. `verify-cloudflare-live.mjs` 통과.
- 하우징·상점·서버 클라이언트·`overrides`·`campus.patch`·`inhaworld` 저장소는 건드리지 않았다.

## 출시 차단 결함

1. **main의 필수 CI가 실패 상태다.** `Public local checks`가 #464~#466 병합을 포함해 최근 실행에서 모두 실패했다.
   로컬 재현: `node --test apps/world/tests/*.test.mjs` 5096개 중 26개 실패, `node apps/world/qa.mjs`는 `#open-shop` 단언에서 중단.
   실패 목록은 `results/main/unit-failures.txt`. 상점 진입 제거(#460), 지형·계단 복원(#463) 뒤 계약 테스트가 갱신되지 않은 것으로 보인다.
   이 상태에서는 회귀를 CI로 걸러낼 수 없다. 이 PR도 같은 26개가 그대로 실패한다(추가 실패 없음).
2. **게스트 세션 ID가 페이지를 열 때마다 새로 만들어진다**(인증 범주, 아래).
3. **실기기·WebKit 미검증.** 위 한계 참조.

## 인증·DB 관련 결함 (별도 목록, 이 PR에서 수정하지 않음)

- **A-1 게스트 세션 ID 비유지.** `release/cloudflare-live/overrides/src/online/world-online.js`의 `startGuest`가 매번 `randomId()`로
  `inhaworld-guest-session-v1`을 덮어쓴다. 세 프로필 모두에서 새로고침 전후 값이 달랐다(`H2b`).
  Tier 4 클라이언트는 이 값을 `X-Session-Id`로 보내고 서버는 이를 행위자 ID로 쓰므로, 운영에서 게스트의 서버 저장
  (진행도·지갑·인벤토리·가구·스타터 지급)이 재접속 때 이어지지 않을 가능성이 높다. 운영 백엔드에 대한 확인은 하지 않았다.
  하우징 스타터 지급(`inhaworld` #16)과 직접 맞물리므로 하우징·서버 담당과 함께 정해야 한다.
- **A-2 세션 등록 경로 미확인.** `workers-tier04/worker.js`의 `verifySession`은 `public.sessions`에 있는 ID만 받는다.
  클라이언트가 만든 UUID가 어디서 등록되는지 이 저장소의 공개 코드만으로는 확인하지 못했다.
- **A-3 로컬 대체 서버에서의 읽기 실패 표시.** `/api/*`가 빈 응답일 때 진행도·지갑·인벤토리 클라이언트가 JSON 파싱 오류를 경고로 남긴다.
  플레이는 계속되지만, 운영에서 같은 응답이 올 때 플레이어에게 무엇이 보이는지는 확인하지 못했다.
- 미이관 클라이언트(낚시, 도감, 친구 방 방문, 비룡 세션)는 `campus.patch`에서 null 토큰으로 막혀 있다. 출시 범위에서 뺄지 결정이 필요하다.

## 잔여 위험

- 인경호 일상 NPC는 에셋 로드가 한 번 실패하면 그 세션에서 다시 시도하지 않는다(`inkyung-daily-npcs.mjs`의 `failed`).
- 탑승 중에는 위치가 저장되지 않아, 탑승한 채 종료하면 마지막으로 걸어서 있던 곳에서 이어진다(의도된 동작으로 보임).
- `runtime-diagnostics.css`는 버전 없는 URL로 불려 온다. 오래된 캐시가 남은 브라우저에서는 새 안내가 스타일 없이 보일 수 있다.
- #458(부팅 18% 그래픽 초기화 복구)은 아직 Draft이고 main에 없다. 이 PR과 파일이 겹치지 않는다.
- Three.js 후보(#452, `inhaworld` #7~#15)는 비교 대상에서 제외했고 채택하지 않았다.

## 다음 개발 권고

1. main의 실패 테스트 26개와 `qa.mjs`를 현재 의도(상점 진입 제거, 지형 변경)에 맞게 정리해 `verify`를 먼저 녹색으로 만든다.
2. 게스트 세션 ID 유지 여부를 서버 담당과 확정하고, 운영 DB 변경 없이 스테이징에서 재접속 저장을 검증한다.
3. 실기기 점검표(Android Chrome, iPad Safari·Chrome)로 이 문서의 연속 플레이 순서를 그대로 수행한다. 백그라운드 전환 후 복귀도 포함한다.
4. #458을 main 기준으로 다시 맞춰 부팅 단계 그래픽 실패까지 한 흐름으로 검증한다.
5. 출시 동결 시점을 정하고, 그 뒤에는 `reference.json` 해시 변경이 있는 PR만 운영 대조(`check-campus-delivery.mjs`)와 함께 받는다.

## 재현 방법

    node apps/world/scripts/build-cloudflare-live.mjs /tmp/campus-build
    python3 -m http.server 8021 --bind 127.0.0.1 --directory /tmp/campus-build &
    cd docs/qa/release-01/scripts
    node journey.cjs pc 8021 /tmp/out        # pc | android | ipad
    node boot-auto.cjs 8021 /tmp/out/boot-auto.json

Playwright 1.63과 Chromium이 설치된 환경이 필요하다. CI에는 연결하지 않았다.
