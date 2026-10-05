import './home.css';
import { mountAccountUi } from './accountUi';
import { CAMPAIGN_STAGES } from './progress';
import { activeCosmetic, activeEquipment, COSMETICS, EQUIPMENT,
  cosmeticUnlocked, equipmentUnlocked, totalStars,
  type CosmeticId, type EquipmentId,
} from './equipment';
import type { InduckUpProgress } from '../account/accountProgress';

document.title = '인덕업 · 장비와 성장';
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root');
root.innerHTML = `<section class="home-shell">
  <header class="home-top"><div class="home-brand"><h1>🎒 장비 · 성장</h1>
    <p>캠페인 재도전에서 새로운 선택을 해보세요.</p></div><span data-account-slot></span></header>
  <a class="ranking-back" href="./">← 캠퍼스 지도로</a>
  <div data-growth-content></div>
</section>`;
const content = root.querySelector<HTMLElement>('[data-growth-content]')!;
let permanentAccount = false;
const account = mountAccountUi(root.querySelector<HTMLElement>('[data-account-slot]')!, root,
  snapshot => { permanentAccount = snapshot.state === 'permanent'; render(snapshot.progress, permanentAccount); });
render(account.getProgress(), false);

function render(progress: InduckUpProgress, permanent: boolean): void {
  const campaign = progress.campaign;
  const complete = campaign.clearedStages.includes(6);
  const stars = totalStars(campaign);
  const equipment = activeEquipment(campaign, progress.meta);
  const cosmetic = activeCosmetic(campaign, progress.meta);
  content.innerHTML = `<section class="growth-hero">
    <strong>누적 ★ ${stars}/18</strong><span>${campaign.clearedStages.length}/6 CLEAR</span>
    <p>${complete ? '장비 1개를 골라 캠페인을 재도전할 수 있어요. 별은 소비되지 않습니다.'
    : 'Stage 6 · 후문을 완료하면 장비와 외형을 선택할 수 있어요.'}</p>
    <small>${permanent ? 'INHAGAME 계정 기록 동기화' : '게스트 기기 기록'}</small>
  </section>
  <section class="growth-section"><h2>🎒 장비 · 1슬롯</h2>
    <p>현재 선택: ${equipment ? EQUIPMENT.find(item => item.id === equipment)?.name : '없음'} · 다음 캠페인 런부터 적용</p>
    <div class="growth-options">${EQUIPMENT.map(item => `<article class="growth-option">
      <strong>${item.name} <small>★${item.stars}</small></strong><p>${item.description}</p>
      <button type="button" data-equipment="${item.id}" ${!equipmentUnlocked(campaign, item.id) ? 'disabled' : ''}
        aria-pressed="${equipment === item.id}">${equipmentUnlocked(campaign, item.id)
        ? equipment === item.id ? '선택 중' : '선택하기' : `잠김 · ${complete ? `별 ${item.stars - stars}개 더 필요` : 'Stage 6 CLEAR 필요'}`}</button>
    </article>`).join('')}</div>
    <button type="button" class="growth-none" data-equipment="none" ${!complete ? 'disabled' : ''}>장비 해제</button>
  </section>
  <section class="growth-section"><h2>🦆 성장 · 외형</h2>
    <p>영구 스탯 강화 없이 획득한 별과 완주 기록으로 꾸밈을 엽니다.</p>
    <div class="growth-options">${COSMETICS.map(item => `<article class="growth-option">
      <strong>${item.name} <small>★${item.stars}</small></strong><p>전투 판정과 스탯에 영향 없음</p>
      <button type="button" data-cosmetic="${item.id}" ${!cosmeticUnlocked(campaign, item.id) ? 'disabled' : ''}
        aria-pressed="${cosmetic === item.id}">${cosmeticUnlocked(campaign, item.id)
        ? cosmetic === item.id ? '적용 중' : '적용하기' : `잠김 · ${complete ? `별 ${item.stars - stars}개 더 필요` : 'Stage 6 CLEAR 필요'}`}</button>
    </article>`).join('')}</div>
    <button type="button" class="growth-none" data-cosmetic="none" ${!complete ? 'disabled' : ''}>외형 해제</button>
  </section>
  <section class="growth-section"><h2>🗺️ 스테이지 기록</h2><div class="growth-records">
    ${CAMPAIGN_STAGES.map(stage => { const record = campaign.stages[stage.id];
      const best = record?.best;
      return `<div><strong>${stage.icon} Stage ${stage.id} · ${stage.name}</strong>
        <span>${'★'.repeat(record?.goals.length ?? 0)}${'☆'.repeat(3 - (record?.goals.length ?? 0))}
        ${best ? ` · 최고 HP ${best.remainingHp} · ${(best.durationMs / 1000).toFixed(1)}초${best.equipmentId
          ? ` · ${EQUIPMENT.find(item => item.id === best.equipmentId)?.name ?? '장비 사용'}` : ''}` : ''}</span></div>`;
    }).join('')}</div></section>
  <p class="growth-note">장비 효과는 캠페인 재도전에만 적용됩니다. 랭킹전의 출발 조건은 동일합니다.</p>`;
}

content.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-equipment], button[data-cosmetic]');
  if (!button || button.disabled) return;
  button.disabled = true;
  if (button.dataset.equipment) await account.selectEquipment(button.dataset.equipment === 'none'
    ? null : button.dataset.equipment as EquipmentId);
  if (button.dataset.cosmetic) await account.selectCosmetic(button.dataset.cosmetic === 'none'
    ? null : button.dataset.cosmetic as CosmeticId);
  render(account.getProgress(), permanentAccount);
});
