# Contributing

외부 기여를 환영합니다. 다만 merge 권한은 maintainer에게 있습니다.
Contributions are welcome; merge authority rests with the maintainer.

## Workflow

1. 큰 변경(구조 개편, 새 의존성, DB 스키마 변경 등)은 코드를 쓰기 전에 Issue로 먼저 논의해 주세요.
2. feature branch(fork 포함)에서 작업하고 Pull Request를 엽니다. `main`에 직접 push할 수 없습니다.
3. PR은 작고 한 가지 목적에 집중해 주세요. 관련 Issue가 있다면 링크합니다.
4. CI `verify`가 통과해야 merge됩니다. 로컬에서는 `bash scripts/public-ci.sh`와 `bash scripts/public-db.sh`로 같은 검사를 돌릴 수 있습니다.
5. 리뷰 대화는 merge 전에 해결되어야 합니다.

## Database changes

- 기존 마이그레이션은 수정하거나 삭제하지 않습니다(append-only). 변경은 항상 새 forward migration으로 추가합니다.
- 새 마이그레이션의 버전은 기존 최신 버전보다 커야 하고, 첫 파일은 `20261001213132_public_baseline.sql`입니다.
- Production 전용 객체(Mixpanel/observer 연동 등)는 이 저장소에 두지 않습니다.
- 위 규칙은 CI의 migration lint(`.github/ci/migration-lint.mjs`)가 검사합니다. 이 저장소의 마이그레이션은 로컬 일회용 개발 DB용이며 Production에는 적용되지 않습니다.

## Do not submit

- Production secret, credential, token, 개인정보
- 비공개 운영 산출물(운영 데이터, 운영진/권한 정보, 장애·복구 증빙, 배포 설정)
- 생성된 비공개 복구/감사 evidence

테스트에는 합성 fixture만 사용하고, 직접 만들었거나 라이선스가 명확한 자산만 사용해 주세요.
CI는 GitHub-hosted runner, read-only contents 권한, 일회용 로컬 서비스만 사용하며 자동 배포가 없습니다.

기여는 프로젝트의 All Rights Reserved 조건을 바꾸지 않습니다. 기여한 내용이 이 조건으로 포함되는 데 동의하는 경우에만 PR을 열어 주세요.
