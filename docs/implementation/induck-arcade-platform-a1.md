# 인덕 아케이드 플랫폼 A1

## 구조
- `/arcade/`: 전체 게임 컬렉션, 정적 HTML로 색인 가능
- `/arcade/{id}/`: 게임 소개 페이지. **실제 플레이는 기존 각 서브도메인**에서 실행
- `data/game-catalog.json`: 허브 및 플랫폼의 공통 등록부 (schemaVersion 1 유지). non-campus 게임의 `platform`은 필수
- `game-catalog.js`: 브라우저 홈과 생성기가 함께 사용하는 검증·정렬 계약 및 승인된 ID → 정확한 플레이 URL 정책
- `scripts/generate-arcade-pages.mjs`: 등록부에서 정적 목록·소개 페이지·사이트맵 및 홈 fallback 카드 생성. 홈은 `ARCADE-CARDS:START/END` 사이만 갱신
- `arcade/arcade.css`: 공통 반응형 디자인
- `tests/arcade-platform.test.mjs`: 생성물 최신성·페이지 링크 검사

## 새 게임 추가
1. 게임의 플레이 주소가 확인된 뒤 등록부에 고유 ID, 문자열 제목(60자 이하), 설명(160자 이하), 상태, 0 이상 정수 순서, `platform` 정보를 추가. 같은 순서는 ID로 정렬
2. 검토된 `assets/hub/{id}-concept.svg` 콘셉트 이미지 준비. 실제 스크린샷으로 표기 금지. 생성기는 100KB 이하의 단순 정적 SVG 부분집합(도형·그룹·그라디언트·텍스트)을 검사하며 외부 참조·스크립트·style·이벤트 속성·깨진 태그를 거부. 임의 SVG 전체를 정화하는 도구는 아니므로 이미지 검토와 브라우저 decode 검사도 필요
3. **새 playable 게임은 `game-catalog.js`의 `playUrls`에 ID와 정확한 HTTPS 루트 URL을 검토 후 추가**. 생성기·홈이 같은 정책을 사용하므로 호스트를 따로 복제하지 않음. 기존 네 호스트 외 자동 승인 금지
4. `platform.genre`는 아케이드·액션·시뮬레이션·퍼즐·전략·RPG·기타 중 하나, `label`은 30자 이하 필수. `coverImage`는 위 SVG 경로와 일치해야 함. 선택적 `posterLabel`(30자 이하)은 홈 포스터 문구이며 생략 시 label 사용. 새 시뮬레이션도 ID에 관계없이 홈 필터에 포함
5. `node apps/world/scripts/generate-arcade-pages.mjs` 실행 후 생성 HTML·홈 카드·사이트맵을 함께 검토. 커버 누락·잘못된 입력은 쓰기 전에 실패. 계정·소셜 영역은 생성 범위 아님
6. `node apps/world/scripts/generate-arcade-pages.mjs --check` 및 `node --test apps/world/tests/arcade-*.test.mjs apps/world/tests/seo-metadata.test.mjs apps/world/tests/hub-*.test.mjs apps/world/tests/pwa-*.test.mjs` 실행
7. 브라우저 도구 설치 후 `node apps/world/tests/browser/hub-editorial-layout-smoke.mjs`와 `node apps/world/tests/browser/arcade-layout-smoke.mjs` 실행. 두 검사는 오프라인 HTTP 복사본을 사용하며 실제 게임 시작·계정·저장 기능을 조작하지 않음

## 삭제·준비 중 전환
- planned는 playUrl이 null 또는 없어야 하며 목록에는 준비 중으로 표시. 소개 페이지·사이트맵 링크는 생성하지 않음
- 생성기가 남긴 정확한 소유 표시가 있는 불필요한 소개 HTML만 제거. 디렉터리·메모·수동 작성 페이지는 삭제하지 않음
- `--check`는 낡은 출력과 남은 생성 페이지를 모두 실패로 처리. 삭제·전환은 재생성 후 변경 diff를 확인
- 이 패치는 소유 표시가 있는 생성 HTML과 함께 적용. 예상 출력 경로의 표시 없는 수동 파일이나 심볼릭 링크는 덮어쓰지 않고 실패. 기존 A1의 표시 없는 파일을 별도로 이관할 때는 diff로 출처를 확인한 뒤 패치의 생성 파일을 반영. 생성 페이지에서 소유 표시를 지우면 자동 정리 대상에서 제외됨
- 게임 소개 목록 제외는 게임 서버 접근 차단이 아님. 게임 서비스 자체 중단은 별도 승인·운영 절차

## 경계
- 게임별 인증/저장/랭킹/결제 데이터와 보상은 자동 통합하지 않음
- 플랫폼 소개 URL과 플레이 URL의 권한은 분리
- `/campus/` PWA ID·설치 경로 및 기존 로그인·소셜 기능은 그대로 유지
- `/arcade/`의 색인/검색 사이트링크 노출은 Google 재수집 뒤 별도 확인 필요
- CI는 320·390·700·768·1440px에서 새 5페이지의 넘침·커버 비율·내부 이동·키보드 초점·확대 시 재배치를 검사. 새 경로·등록부·정책·생성기 변경도 브라우저 게이트 대상
- 실제 모바일 실기기, TalkBack/VoiceOver, 브라우저 실제 확대, Production 응답·캐시·Search Console은 별도 확인. 자동화의 텍스트 확대+좁은 viewport 검사는 실제 브라우저 확대 전체를 대신하지 않음
