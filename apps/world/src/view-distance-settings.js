import { menuReturnFocus } from './campus-hud.js';
import { readViewDistance, saveViewDistance, viewDistancePreset } from './view-distance.js';

export function createViewDistanceSettings(streaming,camera,graphics,{onOpenChange=()=>{}}={}) {
  const open=document.getElementById('open-settings'), panel=document.getElementById('view-settings');
  const close=document.getElementById('close-settings'), select=document.getElementById('view-distance');
  const graphicsSelect=document.getElementById('graphics-quality');
  const graphicsHint=document.getElementById('graphics-quality-hint');
  const status=document.getElementById('view-settings-status');
  let storage;
  try { storage=window.localStorage; } catch { /* Session-only settings. */ }
  let current=readViewDistance(storage);
  function apply(preset) {
    current=preset;
    streaming.setPolicy(graphics.visualPolicy(preset));
    camera.camera.farClip=preset.cameraFarClip;
    select.value=preset.id;
    open.textContent=`⚙ 설정 · ${preset.label}`;
  }
  apply(current);
  graphicsSelect.value=graphics.preference;
  const showGraphics=()=>{
    graphicsHint.textContent=graphics.preference==='auto'
      ? `자동으로 ${graphics.tier==='low'?'낮음':graphics.tier==='medium'?'보통':'높음'} 품질을 사용 중입니다.`
      : `${graphicsSelect.selectedOptions[0].textContent} 품질을 사용 중입니다.`;
  };
  showGraphics();
  let panelOpen=panel.hidden===false;
  function setOpen(next,{focus=true}={}){
    const value=Boolean(next);
    if(value===panelOpen)return panelOpen;
    panelOpen=value;
    panel.hidden=!panelOpen;
    open.setAttribute('aria-expanded',String(panelOpen));
    onOpenChange(panelOpen);
    if(panelOpen){
      if(focus)select.focus?.();
    }else if(focus){
      menuReturnFocus(open,document.body?.dataset?.lobbyShell==='true'
        ? document.getElementById('lobby-menu-toggle')
        : document.getElementById('hud-menu-toggle'))?.focus?.();
    }
    return panelOpen;
  }
  open.addEventListener('click',()=>setOpen(!panelOpen));
  close.addEventListener('click',()=>setOpen(false));
  document.addEventListener('keydown',event=>{if(event.code==='Escape'&&panelOpen)setOpen(false);});
  select.addEventListener('change',()=>{
    apply(viewDistancePreset(select.value));
    status.textContent=saveViewDistance(storage,current.id)
      ? '이 기기에 저장했어요.' : '현재 화면에만 적용했어요. 저장할 수 없습니다.';
  });
  graphicsSelect.addEventListener('change',()=>{
    const saved=graphics.setPreference(graphicsSelect.value);
    apply(current);
    showGraphics();
    status.textContent=saved ? '이 기기에 저장했어요.' : '현재 화면에만 적용했어요. 저장할 수 없습니다.';
  });
  return {get current(){return current;},get open(){return panelOpen;},setOpen};
}
