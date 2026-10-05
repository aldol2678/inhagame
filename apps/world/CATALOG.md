# 허브 게임 카탈로그

`data/game-catalog.json`이 메인 허브 게임 카드의 공개 데이터 원본입니다. 게임의 코드·계정·랭킹 데이터는 포함하지 않습니다.

- `schemaVersion`: 현재 1. 모르는 버전이면 허브의 기본 카드가 남습니다.
- `games`: `id`(고유 slug), `title`, `description`, `status`(`playable` 또는 `planned`), `sortOrder`(낮을수록 먼저), `playUrl`을 작성합니다.
- `playable`: 검증된 공개 주소를 사용합니다. 현재 캠퍼스는 `/campus/?lobby=1`, 다른 게임은 각각의 정식 주소입니다(이 저장소에서는 `https://*.inhagame.example/` placeholder).
- `planned`: `playUrl: null`이며 플레이 버튼이 없습니다. 정식 공개 URL이 없는 게임은 공개 카드에 넣을지 먼저 결정합니다.

링크와 상태를 확인한 다음 해당 게임을 수정하고, PR에서 모바일 카드·링크를 확인합니다. 브라우저에서 데이터를 불러오지 못하거나 목록이 유효하지 않으면 `index.html`의 검증된 기본 링크가 남습니다. 기본 카드는 JSON의 운영 게임과 함께 갱신합니다.
