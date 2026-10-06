# 인덕업 P3 · 깃털 성장과 두 번의 진화 실험

## P3 성장 실험

`/`에서는 기본 오리 다섯 마리로 시작한다. 첫 벽돌을
부수면 깃털이 바로 떨어지고, 그다음부터는 벽돌 2개마다 떨어진다. 벽돌을
부수면 XP +1, 깃털을 오리 몸통으로 받으면 XP +2다. XP 8을 모아 LV.2가 되면
다음 패들 반사 후 탄성·폭탄·복제 중 하나와 진화할 오리의 위치를 선택한다.
첫 벽돌판을 모두 깨면 같은 런에서 다른 배치의 두 번째 판으로 진행한다.
2판에서는 XP 0/12부터 다시 모아 LV.3에 도달하면 아직 기본형인 다른 오리를
두 번째로 진화시킬 수 있다. 2판 강화벽돌은 직접 두 번 맞아야 깨지고,
폭탄의 인접 파괴는 강화벽돌도 한 번에 제거한다. 벽돌 파괴와 깃털 획득에는
XP 획득량이 화면에 잠깐 표시된다. 진화 화면은 모바일에서 터치로 선택하고 PC에서는 방향키로
능력을 고른 뒤 숫자 1~5로 오리 위치를 확정한다.
기존 P1/P2 비교는 `?growth=0`에서 유지한다.

두 번째 진화에서 이미 진화한 오리의 **인접한 기본 오리**를 같은 능력으로
고르면 두 오리가 실제로 합체한다. Matter 몸통은 다섯 마리에서 네 마리로,
연결은 네 개에서 세 개로 줄고 합체 오리의 몸통과 받는 면적이 넓어진다.
합체 탄성은 강화 반사, 합체 폭탄은 인접 벽돌 최대 2개 추가 파괴,
합체 복제는 공 유지 시간 9.5초(기본 6.5초)를 적용한다.
다른 능력이나 떨어진 슬롯을 고르면 기존 방식대로 두 마리가 각각 진화한다.

이 실험은 자석 오리, 꽥 경로, 세 번째 진화, 상점·영구 성장,
main 병합이나 production 배포를 포함하지 않는다. LV.3와 두 번째 진화까지 제공한다.
공 기본 속도는 8.4→5.9, 속도 범위는 6.6~11.2→4.8~7.7로 낮추고,
키보드 target 이동 상한은 초당 520→800, 중앙 오리 제어 스프링은 0.000065→0.00012로 높였다.
합체 오리의 벽 압축으로 바깥 오리와 벽 사이에 틈이 생기던 문제는,
몸통 간 최소 간격 안에서만 작동하는 약한 분리력을 0.0008로 조정해 막았다.
합체 위치별 좌우 벽 압박·수직 낙하 반사와 모바일 드래그를 회귀 테스트한다.
성장 수치(첫 벽돌부터 2개당 깃털 1개, 벽돌 +1 XP, 깃털 +2 XP, 진화 8 XP)는
첫 플레이 테스트용이며 두 번째 진화의 XP 목표 12도 임시 수치다. 디자인 정본을 변경하지 않는다.

P3 성장 실험. `?growth=0`에서는 기존 P1/P2의
오리 배치, 탄성 강도, 벽돌 지형과 복제 공 비교를 계속할 수 있다.
P0 Human Playtest GO나 출시 승인을 대신하지 않는다.

## Scope

- 기본 공 1개, `?clone=1`에서만 최대 2개의 실제 충돌 공 (복제 공은 최대 6.5초)
- 한 번에 벽돌 필드 1개, 한 런에서 최대 2판
- 기본 오리 5마리 Living Paddle, 진화 합체 후 4마리
- 좌우 drag / A·D / ←·→
- A 바깥형 `?flock=A` (기본값), B 안쪽형 `?flock=B`, P0 비교 `?flock=off`
- 탄성: 접촉 위치·이동 방향에 따른 작은 가로 반사 보정, 상향·수직속도 하한 유지
- 폭탄: 다음 직접 벽돌 충돌에서 인접 벽돌 최대 1개 추가 제거; 다음 오리 접촉 시 소멸
- 탄성: `?elastic=standard` (기본) / `?elastic=strong` 비교. 두 모드 모두 상향 최소 수직 비율 0.53
- 벽돌: `?bricks=classic` (기본) / `?bricks=clusters` (같은 개수, 밀집 하단과 고립 상단) 비교
- 복제: `?clone=1`일 때만 A의 2번 또는 B의 5번 오리를 복제로 교체. 공 2개는 개별 벽돌 타격·폭탄 충전·LOST 판정을 적용
- 타격 반응: 탄성은 파란 잔상, 폭탄은 불꽃과 인접 폭발, 복제는 보라 오리와 실제 두 번째 공의 보라 궤적
- 결과 화면: 오리별 반사 횟수, 폭탄 추가 파괴, 실제 복제 횟수
- 슬롯별 기존 관성·탄성·질량 차이 유지
- CLEAR / LOST / RESTART
- TEST-ONLY rigid baseline (`?mode=rigid`)
- body + head compound duck collider, side-anchor flock, soft separation, stabilized upward reflection
- collider overlay only in `?test=1`

자석 오리, 꽥 경로, 보스, 서버는 이 실험의 범위 밖이다.

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm run test
npm run build
npx playwright install chromium
npm run e2e
```

## Authority

- Game Authority: 모락
- Engineering Authority: 세움
- Final Greenlight: 설계자 알돌
- Technical PASS != Human Playtest PASS

## Tuning snapshot

Latest P3 physics source: `quacktris-p3-physical-fusion-speed` commit
`21792db9d88eebee949f3f7a707418af88ca5430`.
Base: `quacktris-p0` commit `c7248bde407d4dfc377a19ba87e0058067b21ae9`.
v0.1.3: radius 22; spacing 43; wall padding 92; constraint stiffness 0.56;
damping 0.17; min distance 36; separation force 0.000045; control spring
0.000065; control damping 0.00145; ball min vertical ratio 0.34.
v0.2: body half-width 23, half-height 14, head radius 10, anchor x 15,
max angle ±0.244 rad; wall padding 112; stiffness 0.43; damping 0.13;
min distance 38; separation force 0.000065. Center control spring and
damping stay at v0.1.3 values. Duck reflection uses ≥0.53 vertical ratio;
the ball's preexisting anti-horizontal guard remains ≥0.34.


## P4-01 인경호 하강 몬스터 Preview

2026-09-25 공식 승격 이후 **`/` 기본 경로는 P4**를 실행한다.
기존 P3 고정벽돌 게임은 비교용 `/?p3=1`에서 유지한다.

Preview 범위:
- Area 1 물결몹, Area 2 물결몹 + 급류몹
- 실시간 하강과 Y=500 위험선, 방어도 3
- 몬스터 처치 XP +1, 3처치마다 깃털, 깃털 +2 XP
- 첫 진화 XP 12, 두 번째 진화 XP 18
- 기존 탄성/폭탄/복제와 실제 5→4 합체
- 상단 Y<220에서 3초 동안 적중이 없을 때 최소 35% 하향 성분을 확보하는 anti-stall rescue
- 장비/외부성장/랭킹은 범위 밖

이 Preview는 P4 전환 승인이나 Production 채택을 뜻하지 않는다.


### P4-01 continuous level hotfix
- Area 전환 시 XP/레벨을 리셋하지 않는다.
- 레벨업 비용: 7, 8, 10, 11, 12, 14, 15, 16, 18... 순으로 상승한다.
- 누적 XP 15에서 LV.3 첫 진화, 누적 XP 48에서 LV.6 두 번째 진화/합체.
- 초과 XP는 다음 레벨로 보존한다.
- 두 번째 진화 이후에도 LV.7 이상으로 계속 성장한다.
- 현재 Preview의 진화 구현은 LV.3/LV.6 두 번이며 LV.9는 후속 후보다.


## P4 official cutover · 2026-09-25

P4 하강 몬스터 + 연속 레벨 + 관통/폭탄/복제 진화 + HP/DEF/ATK + 로그라이크 3택1 성장을
인덕업 기본 Production 경로로 승격했다.

- Official route: `/`
- Legacy P3 comparator: `/?p3=1`
- P4 experiment flag `?p4=1`은 호환 목적상 기본 P4와 동일하게 동작할 수 있으나 더 이상 필수 아님.
- main merge source: private PR #29
