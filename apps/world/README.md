# INHA WORLD (`apps/world`)

INHA WORLD is the 3D virtual campus and game hub, served under `/campus/`. The implementation
lives in this folder; design notes live in `docs/world/`.

## Run locally

```bash
node apps/world/dev-server.mjs   # http://127.0.0.1:8080/campus/ (set PORT to change)
```

Without a local Supabase stack the World runs as a guest-only, offline session. With
`supabase start` running, the client uses the local endpoint from `supabase-public-config.js`.

## Checks

```bash
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
```

Both run in Public CI (`scripts/public-ci.sh`). Browser smokes (`apps/world/tests/browser/`,
`qa-*-runtime.mjs`) need a local Chromium.

## Layout

- `src/`: World client modules (renderer, player, rooms, network, HUD, minimap, quests, ...).
- `data/`: campus layout, editor and reality data (OSM/MOLIT-derived; see `data/reality/README.md`).
- `npc-factory/`: development NPC population generation and QA (see its README).
- `api/`: serverless handlers used by the hub and the World.
- `editor/`, `studio/`: World editor and INHA Studio tools.
- `model-converter/`, `Dockerfile.model-converter`: FBX/OBJ to GLB converter service.
  `/api/model-convert` stays off unless `MODEL_CONVERT_ENABLED=1` with an https
  `MODEL_CONVERT_CLOUD_RUN_URL`. When on, it requires a signed-in (non-guest) Supabase member
  verified server-side, optionally restricted by `MODEL_CONVERT_ALLOWED_USER_IDS`, and applies
  in-memory sliding-window limits: per user (`MODEL_CONVERT_RATE_USER_MAX`, default 5) and per
  IP for signed-in traffic (`MODEL_CONVERT_RATE_IP_MAX`, default 60, sized for a shared campus
  NAT), both per `MODEL_CONVERT_RATE_WINDOW_SEC` (default 3600 s). Unsuccessful logins (invalid
  or expired session, non-allowlisted member, auth provider error) are counted separately per IP
  (`MODEL_CONVERT_RATE_AUTH_FAIL_IP_MAX` per `MODEL_CONVERT_RATE_AUTH_FAIL_WINDOW_SEC`, defaults
  30 / 600 s) and never use members' quota. Each attempt is counted while its auth check is in
  flight, so concurrent bad tokens cannot exceed the cap. On a shared campus NAT, about 30 such
  failures (e.g. a non-allowlisted member retrying, or expired sessions) return 429 for everyone
  behind that IP for up to the failure window (10 min by default), before any auth check.
  IPv6 clients are limited per /64. Invalid values fall back to the defaults.
  These limits are kept in memory per serverless instance and are not shared, so they are not a
  cost ceiling. The real cap on converter spend is the Cloud Run service's `max-instances` (and
  concurrency); set it explicitly before enabling.

Legacy zone names `C01` / `C02` / `C03` are place labels. Runtime channels use `AREA_*`. See
`src/place-zone-registry.js`.

The sections below are historical P0 notes. Do not read them as current scope.

---

# Historical · INHAGAME Campus · P0

INHAGAME 허브용 3D Campus Master World의 첫 기술 프로토타입입니다.

## Scope

이번 브랜치는 P0-01~05 기술 프로토타입을 구현합니다.

- P0-01 Engine Bootstrap
  - PlayCanvas Engine 2.22.4
  - WebGPU 우선, WebGL2 fallback
- P0-02 Player Controller
  - WASD / 방향키
  - Shift 달리기
  - Space 점프
  - 모바일 조이스틱 / 점프 버튼 / 탭할 때마다 달리기를 켜고 끄는 RUN 버튼
  - 화면 드래그 시점 회전, 휠/두 손가락 확대축소
  - 카메라 회전에 맞춘 이동 방향
- P0-03 Zone Contract
  - C01 정문
  - C02 본관
  - C03 중앙권
  - JSON manifest 기반 Zone Registry
- P0-04 Zone Streaming Manager
  - ACTIVE / NEAR / VISTA / UNLOADED
  - 250ms 주기 스트리밍 판정
  - 현재 구역 + 인접 구역 우선
- P0-05 정문 블록아웃
  - C01 진입 도로, 보행로, 문주, 상부 구조물, 경계벽, 조경의 기본 형상
  - VISTA에서는 문주 실루엣만 유지하고 NEAR/ACTIVE에서 세부 형상을 로딩
  - 위치·형상은 프로토타입 기준이며 현장 실측·충돌 처리는 후속 과제

P0 범위에서는 실제 캠퍼스 모델, Supabase, 포털, 수집물을 다루지 않았다. 현행 `main`은 위 Current status를 샌다.

## Local preview

```bash
python3 -m http.server 4173 -d apps/world
```

`http://localhost:4173` 또는 `/campus/` 경로를 확인합니다.
