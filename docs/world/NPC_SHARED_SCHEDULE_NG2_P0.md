# NPC Shared Schedule NG2 P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

## Scope
공통 서버 시각 + 기존 46명 일정 이동을 동기화하는 첫 단계다.
48명 중 퀘스트 전용 001/002는 기존 퀘스트 소유권을 유지한다.
기존 P2-B 관계, NG1 그룹, 학과/생활 일정, 좌표 원본을 교체하지 않는다.

Preview/local URL: /campus/?npcSync=ng2
운영 호스트에서는 기본 활성화한다. Preview/local은 위 query로 활성화한다.
2026-10-02 사용자가 병합·배포를 승인했으며 두 화면의 동시 시각 QA는 배포 이후 직접 진행한다.
private #502 위의 후속 변경이며 공유 모임/대화/상호작용 점유 authority는 이 단계 밖이다.

## Time and motion contract
- GET /api/world-time: 서버의 Unix ms, epoch, period=900000ms, 5개 기간, revision 반환.
- epoch=2026-01-01T00:00:00Z. 하루=75분의 기존 5개 일정. 실제 한국 시간대와 동일한 낮/밤은 아니다.
- 브라우저 Date.now()를 사용하지 않는다. 서버 시각 + RTT/2를 performance.now()에 고정한다.
- 첫 동기화, 이후 60초 갱신. 3초 요청 제한, RTT 2초 초과 거부. 실패 시 5초 후 재시도.
- 120초까지 최근 서버 anchor로 진행; 이후 46명은 숨김/SYNCING. 재접속 후 현재 위치 복원.
- 시간 오차 한계는 네트워크 비대칭/서버 시계 편차에 의존한다. 프레임 단위 lockstep 보장은 아니다.
- 같은 revision/데이터/시각이면 순수 경로 표본 계산 결과가 같다.
- 이전 일정의 목적지에서 다음 목적지로 기존 속도에 따라 이동하며 현재 시간으로 경로상 위치를 계산한다.
- 프레임 누적 dt, 접속 시간, 새로고침, 플레이어 입력이 경로에 영향을 주지 않는다.
- 경로는 시간대별로 처음 필요할 때 계산/캐시한다. 기존 campus walk network를 우선 사용하며
  해당 network에 양 끝점이 없으면 기존 NPC navigator를 사용한다.
- 경로 없음/15분 내 미도착은 명시적 오류다. 전 시간대 도달성 테스트로 배포 전 검사한다.
- 제2생활관 remote transfer는 기존 예외를 유지한다. 모든 장소를 연속 도보로 연결하는 패치가 아니다.
- 일정/anchor/속도/navigation 변경 시 NPC_SCHEDULE_REVISION도 변경해야 한다. 다른 revision 응답은 거부한다.
- 클라이언트가 좌표를 송신하거나 타인의 좌표를 수락하지 않는다. DB/LLM/매 프레임 방송 비용은 없다.

## Local interactions
공유 모드에서는 로컬 scripted pair, NG1.5 물리 모임, 관찰형 P0 대화를 비활성화한다.
기존 관계 그래프 데이터는 유지하되 로컬 NG1 시뮬레이션도 정지한다. 공유 그룹 authority는 후속 단계다.
움직이는 일반 NPC는 직접 대화 후보에서 제외한다.
정지 중 대화하다 일정 이동이 시작되면 로컬 대화를 닫고 공통 일정을 계속한다.
로컬 pause/setPeriod/detour로 공통 일정은 바뀌지 않는다.
다른 플레이어와의 대화 점유/공유 모임/동일 대사 타임라인은 다음 단계다.

## Verification
- Node 회귀: 접속 지연/새로고침/프레임 차이/탭 suspension, cycle wrap, 정확한 도착 경계,
  sink/remote, 잘못된 경로, 시간 계약 mismatch, RTT, 서버 장애/복구, 캐시 금지 API.
- 실제 48명 roster에서 일반 46명×5기간 230개 경로 도달성/보행 가능 위치/시간별 상태 일치 검사.
- 기존 Chromium boot smoke에 두 페이지의 실제 NPC runtime 비교 추가:
  한 서버 타임라인, 서로 다른 로컬 wall clock, 중간 접속, 실제 position 진행, reload.
  CI의 서버 시각만 점심 이동 구간으로 이동하며 운영 요청은 없다.
  소형 CI runner의 SwiftShader 부하를 제한하기 위해 각 페이지의 실제 부팅 후 drawing만 중지한다.
  App.update/NPC 이동/시각 동기화는 계속 실행한다. 두 화면의 동시 시각적 QA를 대신하지 않는다.
- 실제 두 계정/물리 디바이스 Preview 관찰과 자연 전환 시 프레임 성능 측정은 별도 인수 조건.
- 배포 후 운영 도메인의 코드 및 /api/world-time 응답을 확인한다. 두 화면의 실제 관찰은 사용자가 진행한다.

## Acceptance
두 브라우저에서 동일 NPC의 period/destination/position이 시간차 및 RTT 허용 범위 내에서 일치.
reload 후 아침으로 reset되지 않음. 전경 복귀 시 현재 경로 위치로 복원.
네트워크 실패 시 개인 시계를 만들지 않음.

## Production rollout verification

`[REDACTED: production rollout and rollback procedure — maintained privately]`
