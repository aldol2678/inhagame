export function observedBubbleRect({ x, y, width, height, viewport, obstacles = [] }) {
  const left = x-width/2, top = y-height-12;
  const rect = { left, top, right: left+width, bottom: top+height };
  const pad = 12;
  if (left < pad || top < pad || rect.right > viewport.width-pad || rect.bottom > viewport.height-pad) return null;
  if (obstacles.some(r=>rect.left<r.right+6 && rect.right>r.left-6 && rect.top<r.bottom+6 && rect.bottom>r.top-6)) return null;
  return rect;
}

export function createObservedBubble({ documentLike = document, windowLike = window } = {}) {
  const root = documentLike.createElement('div');
  root.id = 'npc-observed-bubble';
  root.hidden = true;
  root.setAttribute('aria-live','polite');
  root.setAttribute('aria-atomic','true');
  const name = documentLike.createElement('strong'), text = documentLike.createElement('span');
  root.append(name,text);
  const style = documentLike.createElement('style');
  style.textContent = `
    #npc-observed-bubble{position:fixed;z-index:32;pointer-events:none;box-sizing:border-box;
      width:max-content;max-width:min(230px,calc(100vw - 32px));padding:8px 11px;
      border:1px solid #d2e8e6;border-radius:12px;background:#102a32ee;color:#f4faf7;
      box-shadow:0 3px 12px #0004;font:13px/1.4 system-ui,sans-serif;overflow-wrap:anywhere}
    #npc-observed-bubble[hidden]{display:none}
    #npc-observed-bubble strong{display:block;color:#b7e7d7;font-size:11px;margin-bottom:3px}
    #npc-observed-bubble span{display:block}
    @media(max-height:500px){#npc-observed-bubble{max-width:200px;padding:5px 9px;font-size:12px}}
  `;
  documentLike.head.appendChild(style);
  documentLike.body.appendChild(root);
  let lastKey = null;
  function hide() { root.hidden = true; }
  function render(frame, { point, name: speakerName, obstacles = [] } = {}) {
    if (!frame?.line || !point?.visible) { hide(); return false; }
    const key = `${frame.conversation_id}:${frame.index}:${frame.line.npcId}`;
    if (key !== lastKey) {
      name.textContent = speakerName;
      text.textContent = frame.line.text;
      lastKey = key;
    }
    root.hidden = false;
    const size = root.getBoundingClientRect();
    const rect = observedBubbleRect({ x:point.x,y:point.y,width:size.width,height:size.height,
      viewport:{width:windowLike.innerWidth,height:windowLike.innerHeight},obstacles });
    if (!rect) { hide(); return false; }
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    return true;
  }
  return { render, hide, destroy() { root.remove(); style.remove(); } };
}
