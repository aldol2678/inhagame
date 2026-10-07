import { getItemDefinition } from './item-catalog.js';
import { createItemIcon } from './item-icon.js';
// The first few existing badges/mementos only. This is current ownership presentation, not a
// fabricated Collection acquisition ledger. No missing/zero holding creates a discovery fact.
const MEMENTOS = new Set(['badge.main_gate','badge.mcm_2026_landlord','memorabilia.mcm_2026_wristband']);
const SOURCES = Object.freeze({QUEST:'퀘스트',EVENT:'이벤트',MINIGAME:'미니게임',SHOP:'상점',EXPLORATION:'탐험',ACHIEVEMENT:'업적',DEFAULT:'기본 지급',INHAGAME_REWARD:'INHAGAME 보상'});
export function currentMementoViews(snapshot) {
  return (snapshot?.items ?? []).filter(item => MEMENTOS.has(item.itemId) && ['ACTIVE','LOCKED','COMING_SOON','DISABLED'].includes(item.catalogStatus) &&
    Number.isSafeInteger(item.quantity) && item.quantity>0).map(item => ({
    itemId:item.itemId,title:getItemDefinition(item.itemId).displayName,state:'OWNED_NOW',quantity:item.quantity,
    acquiredAt:item.acquiredAt,sourceLabel:SOURCES[item.sourceType]??'출처 기록 미제공'
  }));
}
function dateText(value) {
  return typeof value==='string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('ko-KR') : '날짜 기록 미제공';
}
export function renderCollectionBook({ doc, book, inventory, retry }) {
  const el=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const root=el('div','collection-book');
  let retryButton=null;
  root.append(el('p','collection-book-note','발견 기록과 현재 보유는 서로 달라요. 이 화면은 내 기록만 읽어요.'));
  const heading=el('h3','collection-book-heading','발견 기록');root.append(heading);
  if (book.state==='SIGNED_OUT') root.append(el('p','shop-empty','로그인한 INHAGAME 계정만 수집 기록을 볼 수 있어요.'));
  else if (book.state==='IDLE'||book.state==='LOADING') root.append(el('p','shop-empty','수집 기록을 불러오는 중…'));
  else if (book.state==='UNAVAILABLE') root.append(el('p','shop-empty','수집 기록을 불러오지 못했어요.'));
  else {
    const snapshot=book.snapshot;
    root.append(el('p','collection-book-summary',`발견 기록 ${snapshot.discoveredCount} / ${snapshot.trackableCount} · 현재 공개된 기록 기준`));
    const list=el('ul','inventory-items');
    for(const entry of snapshot.entries){
      const card=el('li','inventory-item collection-book-entry');card.dataset.state=entry.state;
      let copy=card;
      // Only the already-revealed ACTIVE fish entry has a presentation binding. Never
      // infer an undiscovered record's icon from inventory, title or an unrevealed key.
      if(entry.state==='DISCOVERED' && entry.key==='collection.fish.carp'){
        card.className+=' inventory-item-with-icon';copy=el('div','inventory-item-copy');
        card.append(createItemIcon({doc,definition:getItemDefinition('material.fish_carp')}),copy);
      }
      copy.append(el('strong','inventory-item-name',entry.title));
      if(entry.state==='DISCOVERED'){
        copy.append(el('p','inventory-item-description',`첫 발견 · ${dateText(entry.firstDiscoveredAt)}`));
        copy.append(el('p','inventory-item-source','출처 기록 미제공'));
      }else if(entry.state==='OWNER_DERIVED') copy.append(el('p','inventory-item-description','별도 콘텐츠 기록 · 발견 여부 미확인'));
      if(entry.hint)copy.append(el('p','inventory-item-description',entry.hint));
      list.append(card);
    }
    root.append(list);
    if(!snapshot.entries.length)root.append(el('p','shop-empty','지금 표시할 수 있는 발견 기록이 없어요.'));
  }
  if(book.accountId){
    const button=el('button','shop-retry','기록 다시 불러오기');button.type='button';button.dataset.focusKey='book-retry';
    retryButton=button;button.disabled=book.state==='LOADING';button.addEventListener('click',retry);root.append(button);
  }
  root.append(el('h3','collection-book-heading','현재 보유한 배지·기념품'));
  root.append(el('p','collection-book-note','이 목록의 획득일·출처는 현재 보유 항목의 정보예요. 전체 과거 획득 이력이나 발견 수에 포함하지 않아요.'));
  if(book.state==='SIGNED_OUT' || inventory.state==='SIGNED_OUT')root.append(el('p','shop-empty','로그인하면 현재 보유한 배지·기념품을 볼 수 있어요.'));
  else if(inventory.accountId!==book.accountId || inventory.state!=='READY')root.append(el('p','shop-empty',inventory.state==='UNAVAILABLE'?'보유 정보를 불러오지 못했어요. 인벤토리에서 다시 시도해 주세요.':'보유 정보를 확인하는 중이에요.'));
  else {
    const items=currentMementoViews(inventory.snapshot),list=el('ul','inventory-items');
    for(const item of items){const card=el('li','inventory-item inventory-item-with-icon');card.dataset.state=item.state;
      const copy=el('div','inventory-item-copy');
      card.append(createItemIcon({doc,definition:getItemDefinition(item.itemId)}),copy);
      copy.append(el('strong','inventory-item-name',item.title),el('p','inventory-item-description',`현재 보유 ${item.quantity} · 획득 ${dateText(item.acquiredAt)}`),el('p','inventory-item-source',`획득 출처 · ${item.sourceLabel}`));list.append(card);}
    root.append(list);if(!items.length)root.append(el('p','shop-empty','현재 보유한 대상 배지·기념품이 없어요.'));
  }
  return {element:root,retryButton};
}
