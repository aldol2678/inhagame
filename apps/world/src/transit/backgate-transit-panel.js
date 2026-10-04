// Back-gate transit information + explicit game-route boarding.
// Real 511 information remains presentation-only; F1 is an INHA WORLD region handoff.
export function createBackgateTransitPanel({
  panel,doc=globalThis.document,onOpenChange=()=>{},fallbackFocus=null,onBoard=()=>false
}={}) {
  if(!panel||!doc||typeof onBoard!=='function')throw new TypeError('Transit panel dependencies required');
  let open=false,closeButton=null,boardButton=null,destroyed=false;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function setOpen(next,{restoreFocus=true}={}) {
    if(destroyed||Boolean(next)===open)return open;
    open=Boolean(next);panel.hidden=!open;
    if(!open){panel.replaceChildren();onOpenChange(false);if(restoreFocus)fallbackFocus?.focus?.();return false;}
    const title=el('h2','','인하대후문 · 37165');title.id='backgate-transit-title';
    closeButton=el('button','profile-close','×');closeButton.type='button';closeButton.setAttribute('aria-label','정류장 닫기');closeButton.addEventListener('click',()=>setOpen(false));
    const real=el('div','transit-route transit-route-real');real.append(el('strong','','511 · 주안역 방면'),el('p','profile-note','현실 노선 정보 · 실시간 운행 안내는 제공하지 않아요.'));
    const game=el('div','transit-route transit-route-game');game.append(el('strong','','F1 · 비룡역'),el('p','profile-note','INHA WORLD 전용 · 비룡권 경계 노선'));
    boardButton=el('button','transit-board','비룡역 가기');boardButton.type='button';boardButton.disabled=false;
    boardButton.addEventListener('click',()=>{
      if(destroyed||!open)return;
      const started=onBoard()===true;
      if(started)setOpen(false,{restoreFocus:false});
    });
    game.append(boardButton);
    const note=el('p','profile-note','탑승하면 캠퍼스 월드에서 비룡권의 비룡역으로 이동해요.');note.id='backgate-transit-note';
    panel.replaceChildren(title,closeButton,real,game,note);onOpenChange(true);closeButton.focus?.();return true;
  }
  const keydown=e=>{if(!open)return;if(e.code==='Escape'){e.preventDefault();setOpen(false);}else if(e.code==='Tab'){e.preventDefault();closeButton?.focus?.();}};
  const stop=e=>e.stopPropagation();
  doc.addEventListener('keydown',keydown);panel.addEventListener('pointerdown',stop);
  return {
    get open(){return open;},setOpen,
    destroy(){if(destroyed)return;setOpen(false,{restoreFocus:false});destroyed=true;doc.removeEventListener?.('keydown',keydown);panel.removeEventListener?.('pointerdown',stop);},
    status:()=>({open,gameStatus:'AVAILABLE',boardingEnabled:true})
  };
}
