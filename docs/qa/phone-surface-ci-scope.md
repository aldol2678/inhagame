# INHA WORLD · 변경 영향 기반 브라우저 CI 경량화

## 적용 범위

이 정책은 작은 기능 PR에서 무관한 브라우저 설치와 월드 전체 스모크 테스트가 반복되는 문제를 줄인다. 기존 #324(Vercel 무관 빌드 생략) 및 #339(Life Housing의 경로 축소)와 별개로, PR #360의 `.github/ci/phone-surface-scope.mjs`가 아래 11개 기존 워크플로의 *비용 높은 단계*를 선택적으로 실행한다.

- Graphics integration browser QA
- Biryong cloud-save recovery browser QA
- World Main 2 recovery
- NPC shop routing browser checks
- Cooking candidate browser QA
- Room transition recovery browser QA
- Quest journal controls browser checks
- Asset runtime browser QA
- Player activity audio browser QA
- Student center integrated campus browser QA
- Biryong map and NPC guidance browser QA

GitHub 워크플로 및 잡 이름, 필수 체크 컨텍스트는 변경하지 않는다. 따라서 GitHub에서 보이는 워크플로 실행 수는 줄지 않을 수 있다. `skip=true`는 해당 기능 검사에 영향이 없다고 판정한 **경로 선택 결과**이며 브라우저 테스트를 실행해 PASS했다는 뜻이 아니다.

## 판정 원리

1. Git checkout을 정확한 PR Head SHA로 고정하고 기본 이력 깊이를 128로 높인다. Head 불일치, 불완전한 베이스 이력, 브랜치 분기 또는 Git 오류는 `skip=false`로 귀결된다.
2. 변경 경로와 파일 상태를 읽는다. 삭제, 이름 변경, 예측 불가한 형식 및 중복·빈 변경은 전체 검사를 수행한다.
3. 스마트폰, 퀘스트, 상점, 외형, 퀴즈, 출석, 생활 스킬과 해당 범위에 속하는 테스트처럼 *명시된 독립 모듈*만 선택적 실행의 후보로 인정한다.
4. 실제 GitHub 워크플로 YAML의 `on.pull_request.paths`를 읽어 현재 워크플로가 변경 경로를 직접 담당하는지 확인한다. 직접 담당한다면 **그 워크플로 전체 검사를 실행한다**.
5. `apps/world/src/main.js`는 일반적으로 광범위한 코드다. **기존 플레이어 카드의 쪽지 핸들러 시작 지점에 `playerCard.close();`와 `if (smartphone?.openMessages?.(userId)) return true;` 정확히 두 문장을 이 순서대로 추가했을 때만** 예외를 인정한다. 나머지 콜백 내용(기존 Hub 이동·반환값·예외 처리 포함)과 파일 전체가 바이트 단위로 동일해야 한다. 다른 UI 동작, 부수효과, 새로운 분기 또는 문장 재배열은 모두 전체 검사를 실행한다. 이 예외는 엄격한 호환성 계약이고 다른 `main.js` 진입점을 일반적으로 안전하다고 간주하지 않는다.
6. 보안·권한·DB·네트워크·월드 입력·공통 Phone Shell/Album/Map 소유권·공용 브라우저 하네스·일반적인 `main.js` 수정·CI/워크플로 자체 변경은 전체 검사로 되돌린다.
7. Release/Hotfix/`[full-ci]` 또는 릴리스·출시 표기 PR은 선택적 실행을 사용하지 않는다.
8. 워크플로 정의 파싱 실패, 알 수 없는 파일이나 영향 범위, 추가 검증 실패도 **전체 실행(Fail Closed)** 한다.

이는 광범위한 변경을 자동으로 생략하는 정책이 아니다. 새 모듈을 추가할 때 안전한 경로로 식별할 수 없다면 우선 전체 검사하고 명시적인 리뷰를 통해 검증 범위를 확장한다.

## 항상 기존 조건으로 실행되는 안전 검사

다음 9개의 검사 정책은 #360에서 변경하지 않는다.

- Required Public `scope/source/database/verify`
- Smartphone integration Chromium
- Photo Mode
- Housing
- Life Housing
- Mounted Photo + Maps
- Private Character
- World stability
- World asset optimizer

예컨대 스마트폰 메시지함 PR에서 그래픽 및 비룡 관련 *무관한* 브라우저 단계만 줄일 수 있다. 스마트폰 자체의 입력·계정 격리·Photo·Housing 교차 회귀는 원래대로 남는다.

## 예시

| 변경 사례 | 분류 결과 |
| --- | --- |
| Phone 메시지 전용 모듈을 수정 | 무관한 그래픽·비룡 QA 단계 생략, Phone 안전 검사 유지 |
| Quest Journal 모듈 변경 | Quest Journal QA 실행, 무관한 Graphics QA 선택적 생략 |
| Shop 모듈 변경 | NPC Shop QA 실행, 무관한 Graphics QA 선택적 생략 |
| Player-card 메시지 전용 콜백과 Phone 모듈 변경 | callback 외 모든 `main.js` 줄이 동일한 경우만 선택적 실행 |
| Photo/입력/월드 엔진/보안/SQL/일반 `main.js` 변경 | 전체 기존 트리거 실행 |
| 해당 워크플로 YAML 또는 CI 분류기 변경 | 해당 워크플로 전체 테스트 실행 |
| Release/Hotfix 또는 `[full-ci]` | 전체 기존 트리거 실행 |

## 검증 및 수락 조건

1. `node --test .github/ci/public-ci-scope.test.mjs .github/ci/phone-surface-scope.test.mjs .github/ci/phone-surface-scope-contract.test.mjs` PASS.
2. CI 정책 PR 자신의 Exact-head Public `verify` 및 영향을 받는 브라우저 검사 전체 PASS. 이번 PR의 자체 수정은 `.github/ci/**`와 워크플로 YAML을 포함하므로 Fast Path를 사용하지 않아야 한다.
3. 이후 **실제로 자격이 있는** 작은 모듈 변경 PR에서 각 GitHub 로그의 `ci-impact: SKIP costly unrelated steps`와 불필요한 설치·스모크 생략 여부를 관측한다. 필수 안전 검사는 계속 실행한다.
4. Shared main/입력/SQL/CI 등 혼합 변경에서 `RUN full suite` 판정을 관측한다.
5. 실제 실행 시간·Actions 사용량은 동일한 워크플로의 과거/이후 값을 비교한 후에만 절감 수치를 주장한다.
6. 최신 Main과의 호환성 및 보호 규칙 확인 전에는 Draft 해제, 병합 및 배포 금지.

PR #357의 이미 수집된 메시지함 QA는 수정하지 않으며, 이 정책으로 소급해서 PASS/면제를 부여하지 않는다.

## SEO-only extension (2026-10-12, CI-SCOPE-02)

- Content-sensitive exception, not a filename-only bypass: only approved search tags inside the six known HTML page heads may differ; everything else must match byte-for-byte against PR base.
- Public site root and /campus/ require correct self-canonical and description; four account/editor pages require noindex. Exact static robots.txt and 2-URL sitemap are checked; only the specific SEO test and audit note are optional companions.
- Required `verify` stays named and must see a successful focused `seo` job. The Public source and local DB suites may be skipped **only** for a verified SEO-only PR merge diff. On unknown history, CI/config edits, scripts, body changes or release/hotfix, fail closed to the full suite.
- Eleven module-guarded browser jobs may skip expensive steps after their own exact SHA and ancestry check. The nine unmodified protected workflows remain unconditional by previous policy; no claim that all workflow jobs stop running.
- This CI policy PR changes CI files itself, so requires its ordinary full exact-head verification. Later check SEO-P0 PR #370 after the policy is merged and #370 is rebased; until then SEO-P0 still runs the original CI.
