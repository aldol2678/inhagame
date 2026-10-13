import { createCookingTrialPanel } from './cooking-trial-panel.js';
import { createSampleRoomTrialPanel } from './sample-room-trial-panel.js';

// Release requires a separate product/authority review. No URL, storage or account override.
export const COMMISSION_TRIALS_AVAILABLE = false;
export function createCommissionTrialFeature({ doc = document, getAccountId = () => null,
  isAvailable = () => COMMISSION_TRIALS_AVAILABLE, onOpenChange = () => {} } = {}) {
  let active = null, destroyed = false;
  const enabled = () => !destroyed && isAvailable() && typeof getAccountId() === "string" && getAccountId().length > 0;
  const changed = kind => open => { if(open)active=kind;else if(active===kind)active=null;onOpenChange(open); };
  const panels = {
    cooking:createCookingTrialPanel({doc,getAccountId,isAvailable:enabled,onOpenChange:changed('cooking')}),
    room:createSampleRoomTrialPanel({doc,getAccountId,isAvailable:enabled,onOpenChange:changed('room')})
  };
  const close = ({restoreFocus=false}={}) => { for(const panel of Object.values(panels))panel.close({restoreFocus});active=null; };
  return {
    available:enabled,
    open(kind) { if(!enabled()||!panels[kind])return false;if(active)return false;return panels[kind].open({accountId:getAccountId()}); },
    close, update(){for(const panel of Object.values(panels))panel.update();},
    state:()=>({active,available:enabled(),cooking:panels.cooking.state(),room:panels.room.state()}),
    destroy(){close();destroyed=true;for(const panel of Object.values(panels))panel.destroy();}
  };
}

// Presentation-only adapter, reusable when Quest Journal is hosted in Phone later.
export function createCommissionTrialEntry({ doc = document, feature }) {
  if (!feature.available()) return null;
  const section=doc.createElement('section');section.className='commission-trial-entry';
  const title=doc.createElement('h3');title.textContent='생활 의뢰 · 무보상 체험';
  const note=doc.createElement('p');note.textContent='임시 재료와 샘플방으로만 체험해요. 보상·개인 재료 소모·내 방 저장이 없어요.';
  section.append(title,note);
  for(const [kind,label] of [['cooking','늦어진 점심 · 요리 체험'],['room','책 펼칠 자리 · 샘플방 체험']]){
    const button=doc.createElement('button');button.type='button';button.textContent=label;button.dataset.focusKey=`trial:${kind}`;
    button.addEventListener('click',()=>feature.open(kind));section.append(button);
  }
  return section;
}
