# 생활 의뢰: 1단계 무보상 체험 후보

## 상태와 진입

- Production 기본값은 `COMMISSION_TRIALS_AVAILABLE = false`이다. URL, localStorage, 계정 설정으로 열 수 없다.
- 후보 활성화 시 계정별 임시 세션만 열며 로그아웃 상태에는 진입을 표시하지 않는다.
- 후보 진입은 기존 퀘스트 기록 → 서브 탭 하단이다. 기존 Smartphone에는 퀘스트/생활 앱이 없으므로 새 앱이나 학생증 버튼을 만들지 않는다.
- `createCommissionTrialEntry`는 별도 presentation adapter이다. 향후 Quest Journal을 Smartphone에 호스팅하더라도 같은 진입을 재사용할 수 있다.
- 기존 Cooking B2의 `COOKING_AVAILABLE = false`, `recipe.carp_grill`, Collection의 COMING_SOON 항목은 변경하지 않는다.

## 체험 범위

1. **늦어진 점심:** 이름·학과를 임의 확정하지 않은 '점심을 놓친 캠퍼스 근무자'가 한입 크기와 순한 간을 요청한다. 세 칼집 자르기 → 불 세기/뒤집기로 양면 굽기 → 소스 선택/전달을 직접 조작한다. 타거나 소스가 많으면 이유를 설명하고 처음부터 재시도할 수 있다.
2. **책 펼칠 자리:** 의뢰용 샘플방에서 제공된 가구만 배치한다. 개인 방의 소유권·배치·재료와 분리된 임시 상태이다.

모든 진행은 메모리에만 있다. 닫기·취소·뒤로·화면 이탈·계정 변경으로 세션이 끝나며, 재진입은 새 체험이다. 재화, EXP, SP, 아이템 보상이 없고 개인 재료도 소모하지 않는다. 서버 제출, 완료 기록, 지속 저장, 보상 청구 및 기존 요리 RPC 연결이 없다. UI의 '전달'은 NPC 반응을 보여 주는 로컬 체험의 끝일 뿐 서버 검증 영수증이 아니다.

3–5분은 향후 사용성 확인 목표다. 타이머로 시간을 채우지 않으며 이 단계에서 플레이 소요시간이 검증됐다고 주장하지 않는다.

## 조작과 수명주기

- 버튼은 키보드 Tab/Shift+Tab, Enter/Space 및 모바일 터치로 사용할 수 있다. Escape/닫기/취소로 나간다.
- 요리 중에는 시간 경과로 타지 않는다. 한 번 굽기 버튼이 조리량을 바꾸고, 양쪽 면의 수치를 각각 보여 준다.
- 별도 `commission-trial` input owner가 이동·카메라 입력을 차단한다. 다른 modal이 입력을 인수하면 체험을 종료한다.
- browser popstate/pagehide/계정 전환 시 종료한다. 이전 세션에서 남은 버튼 callback은 generation 확인으로 무시한다.
- 기본 화면에 상시 floating UI를 추가하지 않는다.

## 검증 및 다음 단계

`node --test apps/world/tests/*.test.mjs` 및 기존 World QA를 사용한다. 기존 Phone browser workflow에 동일 후보 head를 고정한 실제 `/campus/` PlayCanvas + 세 viewport 검증을 추가한다. 활성화는 테스트의 로컬 main.js 응답에 factory dependency를 주입하는 방식이며 production code에는 우회 경로가 없다. 원본 기본값 닫힘도 같은 테스트에서 확인한다.

샘플방의 독립 renderer 테스트는 실제 프로젝트 개인룸 renderer를 사용하되 샘플 객체만 넣는다. QA에는 합성 계정만 사용하고 remote RPC는 막는다. 실기기 iOS/Android 또는 인증된 live 서버 보상 테스트로 해석하지 않는다.

2단계 서버 검증과 3단계 보상 확정/개방은 별도 작업이다. 15 coin / 하루 1회 / 상한 60 등의 미확정안은 코드에 넣지 않는다. 병합·Production 배포·운영 DB 변경은 이 후보 범위에 포함하지 않는다.
