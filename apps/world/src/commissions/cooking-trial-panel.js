import { createCookingTrial, COOKING_TRIAL_ORDER as ORDER } from './cooking-trial.js';

export function createCookingTrialPanel({ doc = document, getAccountId = () => null,
  onOpenChange = () => {}, isAvailable = () => false } = {}) {
  const el = (tag, text = '', cls = '') => { const n = doc.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const panel = el('section', '', 'commission-trial cooking-trial'); panel.hidden = true;
  panel.id = 'cooking-trial-panel'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true'); panel.setAttribute('aria-label',ORDER.title);
  const backdrop = el('div','','commission-trial-backdrop'); backdrop.hidden = true;
  doc.body.append(backdrop,panel);
  const model = createCookingTrial({getAccountId});
  let opener = null, destroyed = false;
  const button = (label, action, key = label, disabled = false) => {
    const n = el('button',label); n.type = 'button'; n.dataset.focusKey = key; n.disabled = disabled;
    const token = model.snapshot().generation;
    n.addEventListener('click', () => { if (!model.valid(token)) { if (!model.snapshot().active) close({restoreFocus:false}); return; }
      if (!isAvailable()) { close({restoreFocus:false}); return; } action(); }); return n;
  };
  function close({restoreFocus = true} = {}) {
    const wasOpen = !panel.hidden; model.close(); panel.hidden = backdrop.hidden = true; panel.replaceChildren();
    if (wasOpen) onOpenChange(false);
    if (restoreFocus && opener?.isConnected && !opener.closest('[hidden],[inert]')) opener.focus({preventScroll:true});
    opener = null; return wasOpen;
  }
  const act = (action,value) => { model.act(action,value); render(); };
  function render() {
    if (panel.hidden) return;
    if (!model.valid() || !isAvailable()) { close({restoreFocus:false}); return; }
    const s = model.snapshot(), focused = panel.contains(doc.activeElement) ? doc.activeElement.dataset.focusKey : null;
    panel.replaceChildren();
    const header = el('header'); header.append(el('div','생활 의뢰 · 무보상 체험','commission-trial-kicker'),button('닫기',()=>close(),'close'));
    panel.append(header,el('h2',ORDER.title),el('p',ORDER.requester,'commission-trial-requester'),el('p',ORDER.disclosure,'commission-trial-disclosure'));
    const order = el('ul','','commission-trial-order'); for (const condition of ORDER.conditions) order.append(el('li',condition)); panel.append(order);
    const steps = el('p',`주문 → 손질 → 굽기 → 담기 → 전달`,'commission-trial-steps'); panel.append(steps);
    const body = el('div','','commission-trial-workbench'); body.dataset.phase = s.phase;
    if (s.phase === 'ORDER') {
      body.append(el('p','“일하다 보니 점심때를 놓쳤네요. 먹기 편하게 잘라서, 소스는 조금만 부탁해요.”'),
        el('p','의뢰용 주방과 재료를 무료로 빌려요. 닫으면 체험 진행은 사라져요. 시간을 기다리지 않고 직접 손질하고 구워 주세요.'),
        button('주문 받고 손질하기',()=>act('accept'),'accept'));
    } else if (s.phase === 'PREP') {
      body.append(el('h3','1. 칼집을 눌러 한입 크기로 자르기'),el('p',`${s.cuts.length}/3 칼집 · 네 조각으로 나눠 주세요.`));
      const board = el('div','','cooking-trial-board');
      for (let i=0;i<4;i++) { board.append(el('span','생선','cooking-trial-piece')); if(i<3) board.append(button(s.cuts.includes(i)?'✓':`✂ ${i+1}`,()=>act('cut',i),`cut-${i}`,s.cuts.includes(i))); }
      body.append(board,button('팬으로 옮기기',()=>act('next'),'next'));
    } else if (s.phase === 'GRILL') {
      body.append(el('h3','2. 양면을 노릇하게 굽기'),el('p','불 세기와 앞뒤를 살펴 직접 구워요. 시간이 지나도 저절로 타지 않아요.'));
      const pan = el('div','','cooking-trial-pan');
      for (let i=0;i<2;i++) { const side = el('div',`${i?'뒷면':'앞면'} ${s.cooked[i]}/4${s.side===i?' · 현재 굽는 면':''}`,'cooking-trial-side'); side.dataset.doneness=String(s.cooked[i]); pan.append(side); }
      body.append(pan);
      const heat = el('div','','commission-trial-actions');
      for (const [value,label] of [['low','약불'],['medium','중불'],['high','강불']]) { const b=button(label,()=>act('heat',value),`heat-${value}`); b.setAttribute('aria-pressed',String(s.heat===value)); heat.append(b); }
      body.append(heat,button('한 번 굽기',()=>act('cook'),'cook'),button('뒤집기',()=>act('flip'),'flip'),button('접시에 담기',()=>act('next'),'next'));
    } else if (s.phase === 'PLATE') {
      body.append(el('h3','3. 소스를 골라 담기'),el('p','한입 크기 네 조각 · 양면 노릇함 ✓'));
      for (const [value,label] of [['light','소스 조금'],['rich','소스 듬뿍']]) { const b=button(label,()=>act('sauce',value),`sauce-${value}`); b.setAttribute('aria-pressed',String(s.sauce===value)); body.append(b); }
      body.append(button('근무자에게 전달하기',()=>act('submit'),'submit'));
    } else {
      body.append(el('h3',s.success?'점심을 전했어요':'다시 해볼까요?'),button('처음부터 다시 체험',()=>act('retry'),'retry'),button('체험 마치기',()=>close(),'finish'));
    }
    const status = el('p',s.feedback,'commission-trial-feedback'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    panel.append(body,status);
    const footer = el('footer'); footer.append(button('취소하고 나가기',()=>close(),'cancel')); panel.append(footer);
    const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
    (buttons.find(n=>n.dataset.focusKey===focused) ?? buttons.find(n=>!['close','cancel'].includes(n.dataset.focusKey)) ?? buttons[0])?.focus({preventScroll:true});
  }
  const stop = event => event.stopPropagation();
  panel.addEventListener('pointerdown',stop); backdrop.addEventListener('pointerdown',stop); backdrop.addEventListener('click',()=>close());
  panel.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab') {
      const list=[...panel.querySelectorAll('button:not(:disabled)')], first=list[0], last=list.at(-1);
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  return { open(options) { if(destroyed||!isAvailable()||!panel.hidden||!model.open(options))return false; opener=doc.activeElement;panel.hidden=backdrop.hidden=false;onOpenChange(true);render();return !panel.hidden; },
    close, update() { if(!panel.hidden&&(!model.valid()||!isAvailable()))close({restoreFocus:false}); },
    state:()=>({...model.snapshot(),open:!panel.hidden}),
    destroy(){close({restoreFocus:false});destroyed=true;panel.remove();backdrop.remove();} };
}
