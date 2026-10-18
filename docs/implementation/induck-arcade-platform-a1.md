# 인덕 아케이드 플랫폼 A1

## 구조
- `/arcade/`: 전체 게임 컬렉션, 정적 HTML로 색인 가능
- `/arcade/{id}/`: 게임 소개 페이지. **실제 플레이는 기존 각 서브도메인**에서 실행
- `data/game-catalog.json`: 허브 및 플랫폼의 공통 등록부 (schemaVersion 1 유지, 선택적 `platform` 속성)
- `scripts/generate-arcade-pages.mjs`: 등록부에서 정적 목록·소개 페이지·사이트맵 생성
- `arcade/arcade.css`: 공통 반응형 디자인
- `tests/arcade-platform.test.mjs`: 생성물 최신성·페이지 링크 검사

## 새 게임 추가
1. 게임의 플레이 주소가 확인된 뒤 등록부에 고유 ID, 제목, 설명, 상태, 순서, `platform` 정보를 추가
2. 검증된 `assets/hub/{id}-concept.svg` 콘셉트 이미지 준비. 실제 스크린샷으로 표기 금지
3. **신규 호스트는 생성기 허용 목록**에 명시적으로 추가. 현재 승인된 네 개 플레이 호스트를 넘어 자동 승인하지 않음
4. `node apps/world/scripts/generate-arcade-pages.mjs` 실행 후 생성 HTML·사이트맵 커밋
5. `node --test apps/world/tests/arcade-platform.test.mjs apps/world/tests/seo-metadata.test.mjs` 및 기존 포털/PWA 회귀 테스트

## 경계
- 게임별 인증/저장/랭킹/결제 데이터와 보상은 자동 통합하지 않음
- 플랫폼 소개 URL과 플레이 URL의 권한은 분리
- `/campus/` PWA ID·설치 경로 및 기존 로그인·소셜 기능은 그대로 유지
- `/arcade/`의 색인/검색 사이트링크 노출은 Google 재수집 뒤 별도 확인 필요
- 반응형 화면 브라우저 QA, 실제 배포 파일 응답, Search Console 상태는 CI와 배포 이후 확인
