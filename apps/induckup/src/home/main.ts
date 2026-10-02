import './home.css';
import {
  CAMPAIGN_STAGES, getStageStatus, loadCampaignProgress, normalizeCampaignProgress,
  type CampaignProgress,
} from './progress';
import { mountAccountUi } from './accountUi';
import { fetchInduckUpLeaderboard, formatRankDuration } from '../ranking/InduckUpRanking';

document.title = '인덕업';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root');

let progress = loadCampaignProgress();
function continueStage(value: CampaignProgress): 1 | 2 | 3 | 4 | 5 | 6 {
  return value.highestUnlockedStage >= 6 ? 6 : value.highestUnlockedStage >= 5 ? 5 : value.highestUnlockedStage >= 4 ? 4
    : value.highestUnlockedStage >= 3 ? 3 : value.highestUnlockedStage >= 2 ? 2 : 1;
}
function continueLabel(value: CampaignProgress): string {
  const stage = CAMPAIGN_STAGES[continueStage(value) - 1];
  return `Stage ${stage.id} · ${stage.name} ${stage.id === 1 ? '시작' : '플레이'}`;
}

function renderStages(value: CampaignProgress): string {
  return CAMPAIGN_STAGES.map(stage => {
  const status = getStageStatus(value, stage.id);
  const cls = stage.playable && status !== 'LOCKED' ? 'active'
    : status === 'NEXT' ? 'next' : status === 'CLEAR' ? 'cleared' : 'locked';
  const stars = value.stages[stage.id]?.goals.length ?? 0;
  const best = value.stages[stage.id]?.best;
  const content = `
    <span class="stage-icon">${stage.icon}</span>
    <span class="stage-copy"><strong>Stage ${stage.id} · ${stage.name}</strong>
    <small>${stage.role}</small><small class="stage-stars" aria-label="누적 별 ${stars}개">
    ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}${best ? ` · 최고 HP ${best.remainingHp}` : ''}</small></span>
    <span class="stage-state">${status === 'LOCKED' ? '🔒' : status}</span>`;
  return stage.playable && status !== 'LOCKED'
    ? `<a class="stage-row ${cls}" href="?play=campaign&stage=${stage.id}">${content}</a>`
    : `<div class="stage-row ${cls}" aria-disabled="true">${content}</div>`;
  }).join('');
}

root.innerHTML = `
<section class="home-shell">
  <header class="home-top">
    <div class="home-brand">
      <h1>인덕업 🦆⬆️</h1>
      <p>캠퍼스를 올라가며 나만의 인덕 빌드를 완성하세요.</p>
    </div>
    <div class="home-actions"><span class="home-live">LIVE</span><span data-account-slot></span></div>
  </header>

  <section class="campus-card" aria-label="캠퍼스 캠페인">
    <div class="campus-head">
      <h2>🗺️ 캠퍼스 캠페인</h2>
      <span data-clear-count>${progress.clearedStages.length}/6 CLEAR</span>
    </div>
    <div class="stage-map" data-stage-map>${renderStages(progress)}</div>
    <p class="stage-goals">인경호 ★ CLEAR · ★ HP 50 이상 · ★ 같은 능력 오리 합체</p>

    <a class="continue-button" href="?play=campaign&stage=${continueStage(progress)}">
      <span>▶ <span data-continue-label>${continueLabel(progress)}</span><small>로그라이크 성장 · 관통 / 폭탄 / 복제</small></span>
      <span class="continue-arrow">›</span>
    </a>

    <a class="ranking-button ${progress.rankingUnlocked ? '' : 'locked'}"
      ${progress.rankingUnlocked ? 'href="?ranking=1"' : 'aria-disabled="true"'}>
      <span class="ranking-mark">🏆</span>
      <span style="flex:1">랭킹전 · 무한 생존<small data-ranking-note>${progress.rankingUnlocked ? '전투 연습 PREVIEW · 공식 기록 준비 중' : 'Stage 6 후문 CLEAR 후 해금'}</small></span>
      <span class="continue-arrow" data-ranking-arrow>${progress.rankingUnlocked ? '›' : '🔒'}</span>
    </a>
    <a class="ranking-back" href="?play=ranking-preview${new URLSearchParams(location.search).get('test') === '1' ? '&test=1' : ''}">▶ 무한 생존 연습 시작 · 기록 없음</a>

    <section class="home-ranking-preview" aria-label="인덕업 랭킹 미리보기">
      <div class="home-ranking-head"><strong>🏆 랭킹 TOP 3</strong><a href="?ranking=1">전체 보기</a></div>
      <div class="home-ranking-list" data-home-ranking><p>랭킹을 불러오는 중...</p></div>
    </section>

    <nav class="home-menu" aria-label="게임 메뉴">
      <a class="home-growth-link ${progress.clearedStages.includes(6) ? '' : 'locked'}" href="?growth=1">🎒 장비<br>${progress.clearedStages.includes(6) ? '선택' : 'Stage 6 후'}</a>
      <a class="home-growth-link ${progress.clearedStages.includes(6) ? '' : 'locked'}" href="?growth=1">🦆 성장<br>${progress.clearedStages.includes(6) ? '기록·외형' : 'Stage 6 후'}</a>
      <button type="button" disabled>📖 도감<br>준비 중</button>
    </nav>
  </section>

  <p class="home-foot">
    현재 플레이 가능: Stage 1 · 인경호 / Stage 2 · 본관 / Stage 3 · 정석학술정보관 / Stage 4 · 5호관 / Stage 5 · 60주년기념관 / Stage 6 · 후문
  </p>
</section>`;

function updateProgress(value: CampaignProgress): void {
  progress = normalizeCampaignProgress(value);
  root!.querySelector<HTMLElement>('[data-stage-map]')!.innerHTML = renderStages(progress);
  root!.querySelector<HTMLElement>('[data-clear-count]')!.textContent =
    `${progress.clearedStages.length}/6 CLEAR`;
  root!.querySelector<HTMLAnchorElement>('.continue-button')!.href =
    `?play=campaign&stage=${continueStage(progress)}`;
  root!.querySelector<HTMLElement>('[data-continue-label]')!.textContent = continueLabel(progress);
  const ranking = root!.querySelector<HTMLAnchorElement>('.ranking-button')!;
  ranking.classList.toggle('locked', !progress.rankingUnlocked);
  if (progress.rankingUnlocked) { ranking.href = '?ranking=1'; ranking.removeAttribute('aria-disabled'); }
  else { ranking.removeAttribute('href'); ranking.setAttribute('aria-disabled', 'true'); }
  root!.querySelector<HTMLElement>('[data-ranking-note]')!.textContent =
    progress.rankingUnlocked ? '로비 해금 · 무한모드 엔진 준비 중' : 'Stage 6 후문 CLEAR 후 해금';
  root!.querySelector<HTMLElement>('[data-ranking-arrow]')!.textContent =
    progress.rankingUnlocked ? '›' : '🔒';
  root!.querySelectorAll<HTMLElement>('.home-growth-link').forEach((link, index) => {
    link.classList.toggle('locked', !progress.clearedStages.includes(6));
    link.innerHTML = `${index ? '🦆 성장' : '🎒 장비'}<br>${progress.clearedStages.includes(6)
      ? index ? '기록·외형' : '선택' : 'Stage 6 후'}`;
  });
  if (new URLSearchParams(location.search).get('test') === '1') {
    (window as Window & { __INDUCKUP_HOME__?: unknown }).__INDUCKUP_HOME__ = {
      clearedStages: [...progress.clearedStages],
      highestUnlockedStage: progress.highestUnlockedStage,
      rankingUnlocked: progress.rankingUnlocked,
    };
  }
}
updateProgress(progress);
(window as Window & { InhaGameEntry?: { landing(): void } }).InhaGameEntry?.landing();
const accountSlot = root.querySelector<HTMLElement>('[data-account-slot]')!;
mountAccountUi(accountSlot, root, snapshot => {
  if (snapshot.state === 'permanent') updateProgress(snapshot.progress.campaign);
});

const rankingList = root.querySelector<HTMLElement>('[data-home-ranking]')!;
void fetchInduckUpLeaderboard(3).then(rows => {
  if (!rows.length) {
    rankingList.innerHTML = '<p>아직 등록된 무한 생존 기록이 없어요.</p>';
    return;
  }
  rankingList.innerHTML = rows.map(row => `
    <div class="home-rank-row ${row.isMe ? 'is-me' : ''}">
      <strong>#${row.rank}</strong>
      <span>${row.nickname}</span>
      <b>W${row.bestWave}</b>
      <small>${row.bestScore.toLocaleString()} · ${formatRankDuration(row.bestDurationMs)}</small>
    </div>`).join('');
}).catch(() => {
  rankingList.innerHTML = '<p>랭킹을 불러오지 못했어요.</p>';
});
