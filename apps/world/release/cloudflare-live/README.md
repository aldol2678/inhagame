# 인하월드 Cloudflare 정적 빌드

저장소 루트에서 Node.js 22.12 이상과 Git을 사용한다. 빌드는 네트워크·계정·DB 연결 없이 실행되며 출력 폴더는 새 경로여야 한다.

    node apps/world/scripts/build-cloudflare-live.mjs
    node apps/world/scripts/verify-cloudflare-live.mjs

기본 출력은 apps/world/dist-cloudflare-live다. Cloudflare Pages에서 작업 루트를 apps/world로 쓸 때의 빌드 명령은 node scripts/build-cloudflare-live.mjs이고 출력 경로는 dist-cloudflare-live다. 이 명령은 정적 파일만 만든다.

reference.json의 files는 공개 경로와 리뷰한 SHA-256을 담는다. 비교 기준은 캠퍼스 배포 558c0f20-fe11-4817-9506-fd71ffc3d8b1과 허브 배포 350ea3f7-d307-4a8c-a476-aacc4715acde다. 후자에서는 hub-account.js, hub-friends.js, hub-messages.js 세 경로를 사용했다. 실행 중인 서비스에서 파일을 받아오는 빌드 단계는 없다.

기본 입력은 apps/world의 동일 경로다. overrides에 열거된 경로만 이 폴더의 overrides에서 읽는다. 여기에는 기존 저장소의 Supabase 클라이언트와 별도로 운영돼 온 Cloudflare용 세션·허브 코드가 들어 있다. 공식 허브를 수정할 때는 overrides/hub-account.js, overrides/hub-friends.js, overrides/hub-messages.js가 진입점이다. campus.patch는 공유 src/main.js와 campus/index.html에 운영판의 연결 코드만 적용한다. 패치가 충돌하면 해당 변경을 소스와 대조한다. 부팅 파일과 스타일 버전은 최종 바이트에서 만든다. 인덕이는 저장소의 기존 비공개 원본에서 출력 디렉터리로 복원하며, 인덕이와 안뇽이는 고정 해시로 확인한다.

수정한 공개 파일은 빌드 후 실제 차이를 검토해 reference.json의 해당 해시를 갱신한다. 새 파일이 필요할 때만 공개 경로를 늘린다. verify는 두 번의 빌드, 허브 단독 변경, 캠퍼스 시작 코드 변경을 임시 폴더에서 시험한다. 출력물의 SNAPSHOT-MANIFEST.json은 이전 복원 당시 기록이다. 현재 인수 기준은 reference.json이다.

캠퍼스 운영판은 PlayCanvas 2.22.4의 npm 배포본과 MIT 라이선스를 vendor/playcanvas/2.22.4에서 제공한다. 빌드는 src의 정적 JSON import를 공개 목록에 있는 원본 JSON에서 동기식 모듈 상수로 변환한다. 지도와 로더의 수정 버전은 캠퍼스 HTML이 참조하는 URL에 반영된다.

## 아이패드 캠퍼스 입장 회귀 검사

2026년 11월 25일 수정판에서 사용자가 아이패드 Chrome 입장을 확인했다. 재현 당시 화면에는 `BOOT_ENTRY_DELAY_AFTER_REJECTION`이 표시됐다. 이 코드는 시작 지연을 나타내며 최초 예외의 원인은 특정되지 않았다.

- 운영 빌드는 엔진의 동일 출처 주소와 해시, 시작 스크립트·지도 모듈의 버전 URL을 검사한다. 초기 지도 모듈과 의존성이 동기적으로 초기화돼야 출력 폴더가 만들어진다.
- `iPad campus entry / webkit`은 PR의 운영 빌드에서 외부 요청과 원본 지도 JSON 요청을 차단한 채 실패 이벤트를 발생시킨다. 첫 렌더와 로비 해제 뒤 ‘정문에서 시작’을 터치해 입장하고, 별도의 모듈 실패에서는 원래 오류가 보이고 다시 시도 버튼으로 입장되는지 검사한다. 아이패드 실기기 제보는 별도로 확인한다.
- `production-delivery`는 main 반영 후 공식 주소의 캠퍼스 HTML과 시작 파일을 배포 명세의 SHA-256과 비교한다. 같은 검사는 `node apps/world/scripts/check-campus-delivery.mjs`로 실행할 수 있다. 불일치하면 출력에 표시된 URL의 Pages 응답과 공식 도메인 응답을 비교하고 해당 URL에 매칭되는 Worker 경로부터 확인한다.
