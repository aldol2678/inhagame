import './home.css';
import { loadCampaignProgress } from './progress';
import { mountAccountUi } from './accountUi';
import { fetchInduckUpLeaderboard, fetchMyInduckUpRank, formatRankDuration } from '../ranking/InduckUpRanking';

document.title = '인덕업 · 랭킹전';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root');

const progress = loadCampaignProgress();
const unlocked = progress.rankingUnlocked;
const testMode = new URLSearchParams(location.search).get('test') === '1';

root.innerHTML = `
<section class="ranking-shell">
  <header class="ranking-top">
    <a href="./" class="ranking-home-link">← 메인</a>
    <span data-account-slot></span>
  </header>
  ${unlocked ? `
  <div class="ranking-hero">
    <div class="hero-icon">🏆♾️</div>
    <h1>랭킹전 · 무한 생존</h1>
    <p>같은 출발선에서 죽을 때까지 버팁니다. 런 안의 카드·진화·합체만으로 빌드를 완성하세요.</p>
    <span class="ranking-status">전투 PREVIEW · 공식 기록 준비 중</span>
  </div>
  <div class="ranking-rules">
    <div class="ranking-rule"><strong>표준 시작</strong><span>HP 100 · DEF 5 · ATK 10</span></div>
    <div class="ranking-rule"><strong>Wave 5</strong><span>Elite Wave</span></div>
    <div class="ranking-rule"><strong>Wave 10</strong><span>Boss Wave</span></div>
    <div class="ranking-rule"><strong>순위 기준</strong><span>Wave › Score › Time</span></div>
    <div class="ranking-rule"><strong>연습 규칙</strong><span>장비/영구성장 OFF · 기록 저장 없음</span></div>
  </div>
  <section class="ranking-my" data-my-ranking>
    <strong>내 기록</strong><span>계정 연결 시 서버 기록을 표시합니다.</span>
  </section>
  <section class="ranking-board">
    <div class="ranking-board-head"><strong>전체 랭킹</strong><span>TOP 20</span></div>
    <div data-ranking-list><p class="ranking-empty">랭킹을 불러오는 중...</p></div>
  </section>
  <a class="ranking-back" href="?play=ranking-preview${testMode ? '&test=1' : ''}">▶ 무한 생존 연습 시작 · 기록 없음</a>
  ` : `
  <div class="ranking-hero">
    <div class="hero-icon">🔒🏆</div>
    <h1>랭킹전 잠김</h1>
    <p>Stage 6 · 후문을 CLEAR하면 랭킹 로비가 열립니다. 기록 없는 전투 연습은 지금 플레이할 수 있어요.</p>
  </div>
  <a class="ranking-back" href="?play=ranking-preview${testMode ? '&test=1' : ''}">▶ 무한 생존 연습 시작 · 기록 없음</a>
  <a class="ranking-back" href="./">캠페인으로 돌아가기</a>
  `}
</section>`;

mountAccountUi(root.querySelector<HTMLElement>('[data-account-slot]')!, root, snapshot => {
  if (snapshot.state === 'permanent' && snapshot.progress.campaign.rankingUnlocked !== unlocked) {
    location.reload();
    return;
  }
  if (snapshot.state === 'permanent' && unlocked) void renderMyRank();
});

async function renderMyRank(): Promise<void> {
  const target = root!.querySelector<HTMLElement>('[data-my-ranking]');
  if (!target) return;
  const mine = await fetchMyInduckUpRank();
  target.innerHTML = mine
    ? `<strong>내 기록 · #${mine.rank}</strong><span>Wave ${mine.bestWave} · ${mine.bestScore.toLocaleString()}점 · ${formatRankDuration(mine.bestDurationMs)}</span>`
    : '<strong>내 기록</strong><span>아직 등록된 무한 생존 기록이 없습니다.</span>';
}

async function renderLeaderboard(): Promise<void> {
  const target = root!.querySelector<HTMLElement>('[data-ranking-list]');
  if (!target) return;
  const rows = await fetchInduckUpLeaderboard(20);
  if (!rows.length) {
    target.innerHTML = '<p class="ranking-empty">아직 등록된 기록이 없어요. 무한모드 공개 후 첫 기록을 남겨보세요.</p>';
    return;
  }
  target.innerHTML = rows.map(row => `
    <div class="ranking-row ${row.isMe ? 'is-me' : ''}">
      <strong>#${row.rank}</strong>
      <span class="ranking-name">${row.nickname}</span>
      <b>Wave ${row.bestWave}</b>
      <span>${row.bestScore.toLocaleString()}점</span>
      <small>${formatRankDuration(row.bestDurationMs)}</small>
    </div>`).join('');
}

if (unlocked) {
  void renderLeaderboard();
  void renderMyRank();
}

if (new URLSearchParams(location.search).get('test') === '1') {
  (window as Window & { __INDUCKUP_RANKING__?: unknown }).__INDUCKUP_RANKING__ = { unlocked };
}
