import { menuReturnFocus } from './campus-hud.js';
import { readViewDistance, saveViewDistance, viewDistancePreset } from './view-distance.js';
import { GRAPHICS_QUALITY_LABELS } from './graphics-presets.js';

export function createViewDistanceSettings(streaming,camera,graphics,{onOpenChange=()=>{}}={}) {
  const open=document.getElementById('open-settings'), panel=document.getElementById('view-settings');
  const close=document.getElementById('close-settings'), select=document.getElementById('view-distance');
  const graphicsSelect=document.getElementById('graphics-quality');
  const graphicsHint=document.getElementById('graphics-quality-hint');
  const status=document.getElementById('view-settings-status');
  const detailControls = {
    frameLimit: document.getElementById('graphics-frame-limit'),
    renderScale: document.getElementById('graphics-render-scale'),
    shadows: document.getElementById('graphics-shadows'),
    showFps: document.getElementById('graphics-show-fps')
  };
  const home=document.getElementById('settings-category-home');
  const back=document.getElementById('settings-section-back');
  const title=document.getElementById('view-settings-title');
  const pages=[...(panel.querySelectorAll?.('[data-settings-page]') ?? [])];
  const categories=[...(panel.querySelectorAll?.('[data-settings-target]') ?? [])];
  const sectionLabels={home:'설정',graphics:'화면 및 그래픽',audio:'소리',controls:'조작 및 카메라',diagnostics:'진단 및 정보'};
  let section='home';
  function showSection(next,{focus=false}={}){
    if(!home)return; // Legacy isolated DOM fixtures have no categorized shell.
    section=next==='home'||pages.some(page=>page.dataset.settingsPage===next)?next:'home';
    home.hidden=section!=='home';
    for(const page of pages)page.hidden=page.dataset.settingsPage!==section;
    if(back)back.hidden=section==='home';
    if(title)title.textContent=sectionLabels[section];
    // The embedded Phone owns the scroll. Reset only the active scroller on navigation.
    const scroller=panel.closest?.('.smartphone-content') ?? panel;
    scroller.scrollTop=0;
    if(focus)(section==='home'?categories[0]:pages.find(page=>page.dataset.settingsPage===section)?.querySelector?.('select,button'))?.focus?.({preventScroll:true});
  }
  const cleanups=[];
  let destroyed=false;
  const listen=(target,type,handler)=>{
    if(!target)return;
    target.addEventListener(type,handler);
    cleanups.push(()=>target.removeEventListener(type,handler));
  };
  const savedStatus=saved=>{status.textContent=saved ? '이 기기에 저장했어요.' : '현재 화면에만 적용했어요. 저장할 수 없습니다.';};
  const syncDetails=()=>{
    const values=graphics.status();
    for(const [key,control] of Object.entries(detailControls)){
      if(!control)continue;
      if(key==='showFps')control.checked=values[key];
      else control.value=String(values[key]);
    }
  };
  syncDetails();
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
    const applied=GRAPHICS_QUALITY_LABELS[graphics.tier] ?? GRAPHICS_QUALITY_LABELS.medium;
    graphicsHint.textContent=graphics.preference==='auto'
      ? `자동으로 ${applied} 품질을 사용 중입니다.`
      : `${GRAPHICS_QUALITY_LABELS[graphics.preference] ?? applied} 품질을 사용 중입니다.`;
  };
  showGraphics();
  let panelOpen=panel.hidden===false;
  function setOpen(next,{focus=true}={}){
    const value=Boolean(next);
    if(destroyed)return panelOpen;
    if(value===panelOpen)return panelOpen;
    panelOpen=value;
    panel.hidden=!panelOpen;
    open.setAttribute('aria-expanded',String(panelOpen));
    onOpenChange(panelOpen);
    if(panelOpen){
      showSection('home');
      if(focus)(categories[0]??select).focus?.({preventScroll:true});
    }else if(focus){
      menuReturnFocus(open,document.body?.dataset?.lobbyShell==='true'
        ? document.getElementById('lobby-menu-toggle')
        : document.getElementById('hud-menu-toggle'))?.focus?.();
    }
    return panelOpen;
  }
  for(const category of categories)listen(category,'click',()=>showSection(category.dataset.settingsTarget,{focus:true}));
  listen(back,'click',()=>showSection('home',{focus:true}));
  listen(open,'click',()=>setOpen(!panelOpen));
  listen(close,'click',()=>setOpen(false));
  listen(document,'keydown',event=>{if(event.code==='Escape'&&panelOpen)setOpen(false);});
  listen(select,'change',()=>{
    apply(viewDistancePreset(select.value));
    status.textContent=saveViewDistance(storage,current.id)
      ? '이 기기에 저장했어요.' : '현재 화면에만 적용했어요. 저장할 수 없습니다.';
  });
  listen(graphicsSelect,'change',()=>{
    const saved=graphics.setPreference(graphicsSelect.value);
    apply(current);
    showGraphics();
    status.textContent=saved ? '이 기기에 저장했어요.' : '현재 화면에만 적용했어요. 저장할 수 없습니다.';
  });
  for(const [key,control] of Object.entries(detailControls)){
    listen(control,'change',()=>{
      const value=key==='showFps' ? control.checked
        : key==='shadows'||control.value==='auto' ? control.value : Number(control.value);
      savedStatus(graphics.setDetail(key,value));
      syncDetails();
    });
  }
  listen(document.getElementById('graphics-reset'),'click',()=>{
    savedStatus(graphics.reset());
    graphicsSelect.value=graphics.preference;
    apply(current); showGraphics(); syncDetails();
  });
  return {get current(){return current;},get open(){return panelOpen;},setOpen,
    destroy(){
      if(destroyed)return;
      setOpen(false,{focus:false}); destroyed=true;
      for(const cleanup of cleanups)cleanup();
    }
  };
}
