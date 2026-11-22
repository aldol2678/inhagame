# INHA WORLD v0.1 캠퍼스 통합 후보

이 디렉터리는 정적 HTTP 서버의 독립 루트다. 2026-11-22에 운영과 해당 Pages 배포에서 각각 받은 정적 파일 10개의 SHA-256이 일치했다. 복원 기준 커밋 `a0d361c`의 `snapshot.sha256`가 그 파일을 식별한다. 당시 업로드에 사용한 빌드 입력과 조립 이력은 미확인이다. 기존 `apps/world`의 PlayCanvas 앱은 별도로 실행된다.

## 실행과 재현

저장소 루트에서 다음 명령을 실행한다. 실행 중인 개발 서버, 배포 계정, 운영 세션이 필요하지 않다.

```sh
cd candidates/world-v01
python3 -m http.server 8080 --bind 127.0.0.1
```

브라우저로 `http://127.0.0.1:8080`에 접속한다. 최초 정적 파일 세트는 다음 방법으로 대조할 수 있다.

```sh
tmpdir=$(mktemp -d)
git -C "$(git rev-parse --show-toplevel)" archive a0d361c:candidates/world-v01 | tar -x -C "$tmpdir"
(cd "$tmpdir" && sha256sum --check snapshot.sha256)
```

Node 24에서 맵을 재생성하거나 비교할 수 있다. 전체 체크아웃 또는 `apps/world/src`, `apps/world/data`, `candidates/world-v01`이 필요하다. 기본 명령은 GitHub 공간 소스를 읽는다. 모아 자료에 접근할 수 있는 경우에는 패킷의 절대 파일 경로를 환경변수로 전달한다. 같은 빌더로 양쪽 결과를 비교할 수 있다.

```sh
node tools/build-layout.mjs --check
node tests/spatial.mjs
MOA_CAMPUS_DATA=/path/to/02_threejs-port/src/campus/campus-data.js node tools/build-layout.mjs --check
MOA_CAMPUS_DATA=/path/to/02_threejs-port/src/campus/campus-data.js node tests/spatial.mjs
```

Python 3, pytest, Python Playwright와 설치된 Chromium으로 브라우저 검사를 실행한다. 브라우저 경로는 `CHROMIUM`으로 지정할 수 있다. `WORLD_QA_DIR`를 지정하면 화면과 수치가 해당 경로에 기록된다. 인증 서버, 동기화 서버, 사용자 데이터는 테스트 픽스처로 대체한다.

```sh
python3 -m pytest -q tests/test_boot.py tests/test_session.py tests/test_sync.py
python3 -m pytest -q tests/test_world.py tests/test_bank_replays.py tests/test_contact.py
```

## 공간과 서비스 ID

| v0.1 서비스 ID | 지리 ID | 외부 방문 중심 (x, z) | 기준 |
|---|---|---|---|
| main-gate | lmk_main_gate | 0, −76 | 정문 투어 지점. WGS84 원점은 0, −90, 스폰은 0, −98 |
| main-building | bldg_01 | 49.481, −4.714 | 본관 전면에서 바깥쪽 5 WU |
| library | bldg_jungseok | −19.448, −3.969 | 정석 전면 로컬 프레임의 (0, 1.8) |

월드·보행 좌표는 원본 WGS84 변환을 따른다. 기준점은 37.44770°N, 126.65319°E이고 1 WU는 약 2m다. 경도 증가 방향은 +X, 위도 증가 방향은 +Z다. 운영 방 반경 9, 퀘스트 ID 3개, 방명록 키, 진행도 키와 서버 세션 헤더를 유지한다. 운영의 ‘중앙도서관’과 정석 외부 입구를 연결한 것은 이 후보의 게임 설계 결정이다.

| 파일 | 담당 |
|---|---|
| `tools/spatial-source.mjs` | 모아 포트·Reality Base의 공간 ID/좌표 입력 선택. 원본 지리 JSON은 기존 저장소에 유지 |
| `tools/build-layout.mjs`, `mesh-batch.mjs` | 원본 다각형 삼각분할, 4개 지형 절개, 8개 경로, 도로·정문 구조물·본관·정석 파사드 생성 루틴을 정점·색상 배치로 변환 |
| `data/layout.json`, `layout.bin` | 지형·도로·입구·충돌·수목 메타데이터와 렌더링 버퍼. 엔진 독립적인 생성 입력에서 재생성 가능 |
| `src/map/polygon-collision.js`, `spatial.js` | 원본 모서리·꼭짓점 연속 충돌과 미끄러짐, 경사·단 높이, 도착 가능 여부 |
| `src/campus.js` | Three.js 버텍스 컬러 배치, 본관·정석 상세 거리 제한, 수목 인스턴싱 |
| `src/main.js`, `index.html`, `src/api.js` | 기존 1인칭 카메라·입력·HUD·서비스 UI 연결. 같은 호스트 인증, 선택적 SDK, 오프라인 진행과 온라인 재연결 |
| `tests/` | 174점 회귀, 접촉, 브라우저 입력·시점·회전·저장·권한 실패 및 두 수로 왕복 재생 |

건물 2개만 본체를 생성한다. 위치가 확정되지 않은 나머지 건물 23개와 랜드마크 5개는 보류한다. 주차장 시설 링과 비룡탑의 게임용 앵커가 건물·랜드마크 배치 승인으로 쓰이지 않는다. 도로폭, 계단 단수·높이, 수목 위치와 파사드는 표현 추정치다. 5호관 보행로 실측 필드 6개는 `walkwaySurvey`에 null로 유지한다.

모아 원본 외부 미디어, 현장 사진, 미승인 GLB, 브랜딩 이미지는 후보의 입력에 포함하지 않는다. 배경은 저장소의 절차 기하와 색으로 구성한다. © OpenStreetMap contributors. 공간 데이터의 ODbL 출처와 엔진 MIT 전문을 보존한다. [OpenStreetMap 저작권](https://www.openstreetmap.org/copyright) · [Three.js 라이선스](vendor/LICENSE)
