# @worldforge/schema

WorldForge v0.1의 엔진 독립 데이터 계약입니다. 대학 캠퍼스, 건물, 테마파크, 박물관처럼 서로 다른 장소 기반 월드를 같은 manifest로 표현하고, 사람이 편집하든 MCP/AI가 편집하든 동일한 구조와 검증 규칙을 사용하도록 하는 것이 목적입니다.

## Scope

v0.1은 다음 코어 컬렉션만 정의합니다.

- project / world
- assets
- zones / places / paths
- entities
- NPC schedules
- quest graphs
- timed events
- generic rules
- reviewable ChangeSet

Terrain sculpting, 3D modeling, combat/economy authoring, multiplayer operations는 v0.1 범위가 아닙니다.

## Safety model

AI/외부 도구의 변경은 World Manifest를 직접 덮어쓰는 대신 `ChangeSet`으로 표현합니다.

`draft -> validated -> previewed -> approved -> applied`

스키마의 status 값은 상태를 표현하는 데이터일 뿐입니다. 실제 승인 및 apply 권한은 이후 WorldForge server/MCP 계층이 강제해야 합니다.

## INHA WORLD compatibility

`fromInhaWorldDocumentV010()`은 현재 `apps/world/src/editor`의 `WorldDocument 0.1.0`을 읽어 WorldForge manifest로 변환합니다. 기존 엔티티와 component payload를 보존하고 `world.path` component를 범용 `paths`로 추출합니다.

시설/POI, NPC, quest/event를 임의 추론하지 않습니다. 해당 의미 데이터는 후속 adapter 단계에서 명시적으로 연결합니다.

## Commands

```sh
npm ci
npm test
npm run schema
```

`npm run schema`는 Zod 4의 `z.toJSONSchema()`을 사용해 Draft 2020-12 JSON Schema를 생성합니다.
