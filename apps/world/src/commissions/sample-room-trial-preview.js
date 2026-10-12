// Isolate PlayCanvas's Application/current-device and material caches from the live game.
// Only synthetic sample objects cross this same-origin, render-only frame boundary.
export function createSampleRoomPreview(host, { isCurrent = () => true } = {}) {
  const doc = host.ownerDocument, frame = doc.createElement('iframe');
  frame.title = '샘플방 3D 미리보기'; frame.tabIndex = -1;
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block;pointer-events:none;';
  let disposed=false, runtime=null, objects=[], error=null;
  const destroy = () => {
    if(disposed)return;disposed=true;runtime?.destroy();runtime=null;
    frame.removeEventListener('load',loaded);frame.remove();objects=[];
  };
  async function loaded() {
    try {
      const created=await frame.contentWindow.__SAMPLE_ROOM_PREVIEW_READY__;
      if(!created)throw new Error('Preview unavailable');
      if(disposed||!isCurrent()){created.destroy();destroy();return;}
      runtime=created;runtime.setObjects(objects);
    } catch {
      if(disposed)return;error='PREVIEW_UNAVAILABLE';
      frame.remove();host.textContent='3D 미리보기를 불러오지 못했어요. 평면도에서 계속 체험할 수 있어요.';
    }
  }
  frame.addEventListener('load',loaded);
  frame.src=new URL('./sample-room-trial-preview-frame.html',import.meta.url).href;
  host.append(frame);
  return {
    setObjects(next){if(disposed)return;objects=next.map(row=>({...row}));runtime?.setObjects(objects);},
    status:()=>runtime?.status()??{disposed,frames:0,error},
    destroy
  };
}
