# INHA WORLD · 2026-10-01 현장답사 비주얼 패스

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

상태: **PRESENTATION EVIDENCE / NON-CANONICAL**

2026-10-01 사용자가 직접 촬영한 인하대학교 현장 사진을 바탕으로, 런타임의 시각 표현만 보정한다.
사진은 건물·수목·야간 분위기의 관찰 근거이며 측량 자료가 아니다.

## 이번 패스에서 확인한 특징

### 학생회관
- 인경호 쪽에서 건물은 개별 창보다 긴 수평 리본과 발코니 띠가 먼저 읽힌다.
- 저층은 상층 매스보다 가볍고 개방적으로 보이며, 긴 유리 면과 얕은 캐노피/테라스가 전면 인상을 만든다.
- 기존의 둥근 계단실과 붉은 계단실 표현은 유지한다.

### 인경호
- 정자 주변 경관은 수면과 정자만으로 읽히지 않고, 한 그루의 큰 수양형 수목이 강한 실루엣 앵커 역할을 한다.
- 기존 안전 배치된 연못 수목 좌표를 변경하지 않고, 정자에 가장 가까운 유효 수목 하나만 hero willow로 강조한다.

## 권위 경계

이번 패스는 다음을 **변경하지 않는다**.

- Reality Base의 canonical footprint / WGS84 source polygon
- 학생회관 충돌 형상
- STUDENT_TERRACES 및 상점/NPC 앵커
- 인경호 canonical polygon
- 퀘스트, 좌석, 상호작용, 이동 권한

학생회관 footprint 재검증 상태와 GIS/건축물대장 충돌은 별도 Reality Base 절차의 소유 영역이다.
현장 사진만으로 그 권위를 승격하거나 덮어쓰지 않는다.

## 구현

- `roadview-layout.js`: 기존 collision-safe pond planting 중 정자에 가장 가까운 수목 하나를 `heroWillow`로 태깅.
- `roadview-details.js`: hero willow의 수관과 늘어진 가지 실루엣 강화. 학생회관 상부 수평 리본을 확장하고 pond-facing 저층의 연속 유리면/캐노피를 강조.
- 테스트: hero willow가 정확히 하나이며 기존 안전 배치를 유지하는지, 학생회관 저층 glazing·canopy·상부 ribbon 표현이 생성되는지 확인.

## 후속 후보

- 정문 스폰 시야축과 중앙 녹지의 vista 회귀 포인트
- 야간 인경호 정자 warm-light 패스
- 학생회관 야간 상점/복도 명암
- 정석↔본관 시야축 및 원거리 도시 skyline
