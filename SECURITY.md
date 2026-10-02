# Security

- 공개 Issue, PR, 댓글에 credential, 개인정보, 취약점 악용 세부 내용을 게시하지 마세요.
- 보안 취약점은 비공개 채널로 보고해 주세요. 이 저장소에서 GitHub private vulnerability reporting이 활성화되어 있으면
  저장소의 **Security** 탭 → **Report a vulnerability**를 사용하세요. 아직 사용할 수 없다면 공개 Issue에는
  "비공개 연락 방법이 필요하다"는 사실만 남기고 세부 내용은 적지 마세요(maintainer가 비공개 경로를 안내합니다).
  검증된 보고용 이메일은 이 저장소에서 제공하지 않습니다.
- Production credential은 이 저장소에 존재해서는 안 됩니다. 발견하면 공개적으로 언급하지 말고 위 비공개 채널로 알려 주세요.

## Scope notes

포함된 데이터베이스는 로컬 일회용 개발용이며 모든 예시 계정 식별자는 합성 값입니다.
폐기된 token/digest OPS 인증은 항상 credential을 거부해야 하고, 계정 권한 검사는 서버 측에서 수행됩니다.
이 저장소에 production secret, privileged runner, cloud OIDC trust, 배포 hook을 연결하지 마세요.
