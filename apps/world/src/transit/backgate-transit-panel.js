// Static information only. This panel has no client, RPC, transit runtime or teleport callback.
export function createBackgateTransitPanel({panel,doc=globalThis.document,onOpenChange=()=>{},fallbackFocus=null}={}) {
  if(!panel||!doc)throw new TypeError('Transit panel dependencies required');
  let open=false,closeButton=null,destroyed=false;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function setOpen(next,{restoreFocus=true}={}) {
    if(destroyed||Boolean(next)===open)return open;
    open=Boolean(next);panel.hidden=!open;
    if(!open){panel.replaceChildren();onOpenChange(false);if(restoreFocus)fallbackFocus?.focus?.();return false;}
    const title=el('h2','','인하대후문 · 37165');title.id='backgate-transit-title';
    closeButton=el('button','profile-close','×');closeButton.type='button';closeButton.setAttribute('aria-label','정류장 닫기');closeButton.addEventListener('click',()=>setOpen(false));
    const real=el('div','transit-route transit-route-real');real.append(el('strong','','511 · 주안역 방면'),el('p','profile-note','현실 노선 정보 · 실시간 운행 안내는 제공하지 않아요.'));
    const game=el('div','transit-route transit-route-game');game.append(el('strong','','F1 · 프런티어 순환'),el('p','profile-note','INHA WORLD 전용'));
    const board=el('button','transit-coming-soon','준비중');board.type='button';board.disabled=true;board.setAttribute('aria-describedby','backgate-transit-note');game.append(board);
    const note=el('p','profile-note','프런티어 이동이 준비되면 이 정류장에서 탑승할 수 있어요.');note.id='backgate-transit-note';
    panel.replaceChildren(title,closeButton,real,game,note);onOpenChange(true);closeButton.focus?.();return true;
  }
  const keydown=e=>{if(!open)return;if(e.code==='Escape'){e.preventDefault();setOpen(false);}else if(e.code==='Tab'){e.preventDefault();closeButton?.focus?.();}};
  const stop=e=>e.stopPropagation();
  doc.addEventListener('keydown',keydown);panel.addEventListener('pointerdown',stop);
  return {
    get open(){return open;},setOpen,
    destroy(){if(destroyed)return;setOpen(false,{restoreFocus:false});destroyed=true;doc.removeEventListener?.('keydown',keydown);panel.removeEventListener?.('pointerdown',stop);},
    status:()=>({open,gameStatus:'COMING_SOON',boardingEnabled:false})
  };
}
