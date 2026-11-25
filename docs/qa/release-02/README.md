# RELEASE-02 릴리스 검증 정상화 기록 (2026-11-25)

기준은 `main` 67f2632(#466 병합)이다. RELEASE-01 기록과 수정 후보는 Draft PR #467에 그대로 있고, 이 브랜치는 그 위가 아니라 `main`에서 따로 만들었다.

## 결과

| 검사 | main 67f2632 | 이 브랜치 |
| --- | --- | --- |
| `node --test apps/world/tests/*.test.mjs` (Node 24.19) | 5096개 중 25개 실패 | 5100개 중 0개 실패, 9개 건너뜀(기존과 동일) |
| `node apps/world/qa.mjs` | `#open-shop` 단언에서 중단 | 끝까지 통과 |
| `bash scripts/public-ci.sh` 전체 | 실패 | 종료 코드 0 |
| Runtime diagnostics 워크플로의 단위 단계 | 1개 실패 | 100개 통과 |
| Runtime diagnostics 워크플로의 브라우저 단계 3개 | `lobby-layout-smoke` 실패 | 3개 모두 통과 |
| `verify-cloudflare-live.mjs` | 통과 | 통과 |

모두 이 컨테이너에서 CI와 같은 Node 24.19.0으로 실행한 결과다. GitHub Actions에서의 결과는 이 PR의 실행으로 확인해야 한다.
Runtime diagnostics 워크플로는 경로 필터 때문에 이 PR에서는 실행되지 않는다. #467처럼 진단 파일을 건드리는 PR에서 실행된다.

RELEASE-01에서 센 26건은 이 컨테이너의 기본 Node 22로 센 수치다. CI와 같은 Node 24에서는 25건이다(아래 D-2).

## 실패 26건과 `qa.mjs`의 분류

### A. 폐기된 기능의 계약 — 12건과 `qa.mjs` 1곳

근거는 #460 "캠퍼스 학생회관 상점과 상단 퀘스트 안내 제거"다. 본문은 학생회관 표지, 근접 상호작용, 메뉴 바로가기, 판매원 연결을 정리했다고 적고 있고, 커밋 2d5668b는 두 학생회관 경로를 `RETIRED`로 바꿨다. 생활관 가구 판매대와 학과 판매대는 `READY`로 남아 있다.

테스트는 지우지 않고, 같은 자리에서 "폐기된 상태"를 단언하도록 바꿨다.

| 테스트 | 실패 원인 | 조치 |
| --- | --- | --- |
| `shop-routes` · five regions… | 학생회관 부서 전환 목록이 비게 됨 | 두 경로가 `RETIRED`이고 부서 전환·판매원 결속이 없음을 단언 |
| `shop-routes` · main keeps direct NPC purchases… | `shopButton`, `shopEntry`, `studentCenterVendors: true` 사라짐 | 그 연결이 없고 `studentCenterVendors: false`임을 단언. 잘못된 접근 시 패널을 닫는 7개 조건 검사는 그대로 유지 |
| `shop-entry-compat` · split campus actors… | 판매원 트리거가 더는 상점을 열지 않음 | 어떤 모드에서도 열지 않음을 단언. 생활관 인사 경로 검사는 유지 |
| `shop-world-interaction` · blocked… | `main.js`의 월드 진입 연결 사라짐 | 진입·표지·컨텍스트 액션이 없음을 단언. 모듈 자체의 차단 검사는 유지 |
| `shop-world-interaction` · menu entry kept… | `#open-shop` 사라짐 | 메뉴 항목이 없고 패널·라우터가 하나씩 남았으며 생활관 판매대 연결이 유지됨을 단언 |
| `student-center-vendors` · proximity publishes… | 경로가 `RETIRED`라 트리거가 실패 | 계정·차단·준비·위치와 무관하게 실패하고 `openShop`이 호출되지 않음을 단언 |
| `input-focus-main-wiring` · Shop, Inventory and Wardrobe… | 상점 블록의 끝 표식이던 `shopButton` 사라짐 | 끝 표식을 생활관 대화 선언으로 바꾸고 블록을 찾았는지 단언 추가. 순서 검사는 그대로 |
| `mobile-ux-settings-menu` · all existing menu actions… | `open-shop` ID가 0개 | 목록에서 빼고, 0개임을 따로 단언 |
| `item-acquisition-guide` 4건 | 고정 판매처로 쓰던 학생회관 경로가 `RETIRED` | 고정값을 운영 중인 생활관·학과 판매대로 옮김. 학생회관 스냅샷은 구매 가능 응답이 있어도 판매처가 되지 않음을 새 테스트로 추가 |
| `qa.mjs` 상점 구간 | 위와 같음 | 메뉴 항목·월드 표지가 없고 생활관 판매대가 남아 있음을 단언 |

### B. 승인된 지형 변경에 따른 계약 갱신 — 4건과 `qa.mjs` 1곳

근거는 #463 "본관 대계단 복원 및 캠퍼스 녹지·빈터 고도 반영"이다. 본문은 본관의 문턱·기단·충돌 높이를 함께 올렸고, 기존 본관 도착점을 지나는 길찾기 경로를 추가했다고 적고 있다.

고정 해시는 새 값으로 갈아 끼우지 않았다. 승인된 변경분만 떼어내면 예전 해시가 그대로 나오는지 확인하는 방식으로 바꿨고, 변경분 자체는 따로 단언한다.

| 테스트 | 실패 원인 | 조치 |
| --- | --- | --- |
| `north-landmark-restoration` · pinned ground facilities… | 길찾기 그래프에 본관 진입 경로 추가 | `MAIN_HALL_APPROACH` 경로를 빼면 기존 해시 `ae7322…`가 그대로임을 확인 |
| `north-landmark-restoration` · surroundings integration… | 노드 187→190, 간선 212→215, 본관 충돌체 높이 10.5→11.65 | 실제 그래프가 "기존 + 계단 경로 간선 2개 + 교차로 분할 1개"임을 단언. 지상 충돌체 864개 중 달라진 것은 `bldg_01`의 `maxY` 하나뿐임을 #463 이전 커밋과 대조해 확인했고, 그 값만 되돌리면 기존 해시가 유지됨 |
| `spatial-architecture` · chunk ownership… | 본관 지붕 높이 +1.15 | 기대값에 `HALL_FOUNDATION_HEIGHT` 반영 |
| `pond-surroundings` · fishing banks remain clear… | 낚시터 한 곳의 지면이 0에서 0.00145로 | 정확히 0 대신 5mm 미만으로 단언. 아래 "판단이 필요한 항목" 참조 |
| `qa.mjs` 지붕 착지 | 본관 지붕 높이 +1.15 | 위와 같음 |

### C. 실제 제품 결함 — 8건

| 테스트 | 결함 | 조치 |
| --- | --- | --- |
| `club-room` · 28. the return anchor… | 동아리방에서 나올 때의 복귀 지점이 새 대계단의 중간 단(높이 0.9) 위에 놓였다. 저장된 높이는 평지 기준 그대로였다. 브라우저에서는 이동 컨트롤러가 높이를 보정해 계단 중간에 서게 된다 | 복귀 지점을 계단 아래 평지로 옮김(`room-registry.js` 2줄). 테스트는 손대지 않음. 전후 비교: `results/product-before.json`, `product-after.json` |
| `mobile-landscape-hud`, `mobility-balloon`, `mobility-duckboat`, `mobility-kart`, `mobility-kickboard`, `mobility-shuttle` 각 1건 | #460이 퀘스트 안내를 숨기는 CSS를 `LANDSCAPE-HUD:end` 표식 뒤에 붙였다. 이 표식 뒤에는 아무 규칙도 오지 않는다는 것이 여섯 테스트의 공통 계약이다 | 블록을 표식 앞으로 옮김. `!important` 규칙이고 가로 HUD 블록에 같은 요소의 `display` 강제 규칙이 없어 동작은 같다. PC와 휴대폰 가로 화면에서 세 요소 모두 전후 `display: none`임을 확인 |
| `chat-moderation` · ChatFeed with the filter… | 운영 빌드에 들어가는 `local-chat.js`(overrides)에는 수신 측 금칙어 차단이 있는데, 저장소의 기본 소스에는 없었다. 테스트는 기본 소스를 불러온다 | 기본 소스를 운영본과 같게 맞춤. 운영 빌드는 overrides를 쓰므로 배포 바이트는 변하지 않는다 |

### D. 환경·검증기 오류 — 2건

| 테스트 | 원인 | 조치 |
| --- | --- | --- |
| D-1 `campus-relief.test.mjs` (파일 전체) | #463이 추가한 테스트가 `playcanvas` 패키지를 직접 불러오는 모듈을 정적으로 가져온다. CI의 이 단계에는 그 패키지가 없어 파일이 로드되지 않았고, 안의 테스트 4개는 한 번도 실행된 적이 없다 | 다른 테스트들이 쓰는 `registerHooks` 대체 방식을 적용. 4개가 실행되고 모두 통과 |
| D-2 `personal-room-chair-model` · self-authored GLB… | Node 22에서만 실패한다. 삼각함수 결과의 마지막 자리(최대 7e-17)가 달라 14바이트가 어긋난다. CI의 Node 24.19에서는 통과 | 변경 없음. 하우징 에셋이라 손대지 않았다 |

### 가려져 있던 추가 실패 — 1건

`lobby-layout-smoke.mjs`는 Runtime diagnostics 워크플로의 마지막 단계인데, 앞 단계가 먼저 실패해 드러나지 않았다. main에서도 실패한다.
원인은 95f6e5f "simplify the live campus entry lobby"다. 게스트 로비에서 접속 인원 카드, 계정 수치, 잠긴 후문 안내를 숨기고 입장 버튼을 퀘스트 카드 앞으로 옮겼는데 스모크가 예전 배치를 단언하고 있었다.
현재 배치에 맞춰 바꿨다. 입장 버튼과 퀘스트 카드가 첫 화면 안에 있고 서로 겹치지 않으며 가로 넘침이 없다는 검사는 세 화면 크기에서 그대로 유지한다.

## Private character acceptance의 HTTP 404

워크플로는 `https://inhagame.app/api/brand-asset?...`에서 안뇽이와 인덕이 GLB를 내려받는다. 이 경로는 Vercel 서버리스 함수(`apps/world/api/brand-asset.js`)였다. 운영이 Cloudflare 정적 배포로 바뀐 뒤에는 `/api/*` 경로 전체가 404를 낸다(`results/private-asset-404-probe.txt`).

| 요청 | 응답 |
| --- | --- |
| `/api/brand-asset?asset=annyongi-flight-v1.glb&variant=canonical` | 404 `Not found` |
| `/api/brand-asset?asset=annyongi-flight-v1.glb&variant=optimized` | 404 |
| `/api/brand-asset?asset=induck-v3.glb&variant=canonical` | 404 |
| `/api/world-time` | 404 |
| `/assets/annyongi-flight-v1.glb` | 200, SHA-256 `5b53dd9a…` |
| `/assets/induck-v3.glb` | 200, SHA-256 `bec8585e…` |
| `/.generated/assets-optimized/annyongi-flight-v1.glb` | 200이지만 허브 HTML이 돌아옴 |

경로만 고치면 되는 문제가 아니다. 워크플로가 고정한 승인 해시(안뇽이 원본 `5cc0bc54…`, 최적화본 `e2859958…`, 인덕이 `8aede8fd…`)는 지금 운영에 올라가 있는 바이트(`5b53dd9a…`, `bec8585e…`)와 다르고, 최적화본은 운영에 없다. 어느 바이트를 승인 기준으로 삼을지는 에셋 승인 결정이라 워크플로는 건드리지 않았다. 이 PR에서도 이 워크플로는 같은 이유로 실패한다.

## 판단이 필요한 항목

- **낚시터 높이.** #463은 수로·건물 기초·운동장·정원·도로의 높이를 유지한다고 했지만 인경호 둑은 목록에 없다. 낚시터 한 곳의 지면이 1.45mm 올라갔고 2WU 안에서는 최대 21mm다. 낚시 판정은 수평 거리만 쓰므로 기능 영향은 찾지 못했다. 정확히 0이어야 한다면 지형 마스크를 다시 구워야 하고, 그때는 이 단언을 0으로 되돌리면 된다.
- **학생회관 미결 영수증.** 진입점과 함께 `openRecovery` 경로도 사라졌다. 학생회관 상점에서 결제가 불확실한 채로 남은 계정이 있다면 복구 화면에 들어갈 길이 없다. 구매·DB 범위라 확인만 남긴다.
- **폐기 경로의 라우터 등록.** `SHOP_ROUTE_IDS`는 상태를 보지 않아 폐기된 두 상점 ID가 여전히 상점 라우터에 등록된다. 진입점이 없어 열리지는 않는다.
- **운영의 `/api/*`.** `/api/world-time` 등 클라이언트가 부르는 다른 경로도 404다. RELEASE-01 연속 플레이에서는 이 응답으로 막히는 단계가 없었다.

## 다른 작업과의 관계

- #467: 겹치는 파일은 `reference.json` 하나이고 서로 다른 줄이다. `git merge-tree`로 충돌 없음을 확인했다. 이 PR이 먼저 들어가면 #467의 Runtime diagnostics 실패 1건이 사라진다.
- #458: 겹치는 파일 없음, 충돌 없음. #458은 `boot-recovery.js`를 바꾸므로 main으로 옮길 때 `reference.json`을 다시 계산해야 한다.
- 하우징: 가구·개인 방·상점 구매 클라이언트, `overrides`, `campus.patch`, `supabase/`, `inhaworld` 저장소는 건드리지 않았다. `src/rooms/room-registry.js`는 동아리방 복귀 좌표 한 곳만 바꿨고 #422의 변경 파일과 겹치지 않는다. 테스트 고정값으로 생활관 판매대 ID를 쓴 것은 읽기 전용 참조다.
- 인증·DB: 변경 없음. RELEASE-01의 게스트 세션 ID 항목은 그대로 열려 있다.

## 배포 영향

공개 파일 942개 중 `campus/index.html`(스타일 버전 문자열), `styles.css`, `src/rooms/room-registry.js` 세 개가 달라진다. `reference.json`의 해당 해시 세 개를 갱신했다. 운영 배포는 하지 않았다.

## 회귀 확인

RELEASE-01의 연속 플레이를 이 브랜치의 빌드에 다시 돌렸다(헤드리스 Chromium, 에뮬레이션). PC 23/25, Android 24/26으로 main과 같다. 남은 실패는 게스트 세션 ID(인증)와 그래픽 손실 안내(#467의 수정 대상)다. `results/journey-*.json`.

## 재현

    export PATH=/path/to/node-24.19.0/bin:$PATH
    bash scripts/public-ci.sh
    node apps/world/scripts/verify-cloudflare-live.mjs
    (cd apps/world/tests/browser && npm ci --ignore-scripts)
    WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/lobby-layout-smoke.mjs
