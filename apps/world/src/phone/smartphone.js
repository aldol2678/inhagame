import { createPhoneShell, PHONE_STATE } from './phone-shell.js';
import { createStudentId } from './student-id.js';
import { createPhoneAlbum } from './phone-album.js';
import { createPhonePreferences } from './phone-preferences.js';
import { createPhoneSurface, createPhoneMapHistory } from './phone-surfaces.js';
import { PHOTO_ENTRY_BLOCK_MESSAGES } from '../photo/photo-mode-panel.js';

export function createSmartphone({ inputFocus, photoMode, getMap, getSettings, getIdentity, getClient,
  getProgression, getCaptureContext, canOpen, beforeOpen, getClock = () => '',
  toggle, mapElement, settingsElement, onWarning = () => {}, doc = globalThis.document, win = globalThis.window }) {
  const el = (tag, cls = '', text = '') => { const n=doc.createElement(tag); n.className=cls; n.textContent=text; return n; };
  const btn = (text, action, label = text) => { const n=el('button','',text); n.type='button'; n.setAttribute('aria-label',label); n.addEventListener('click',action); return n; };
  const root=el('section','smartphone'); root.id='world-smartphone'; root.hidden=true; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label','INHA WORLD 스마트폰');
  const frame=el('div','smartphone-frame'), wallpaper=el('img','smartphone-wallpaper'); wallpaper.alt=''; wallpaper.hidden=true;
  const statusBar=el('div','smartphone-statusbar'); statusBar.append(el('span','','INHA'),el('span','smartphone-island',''),el('span','','● ▰'));
  const header=el('header','smartphone-header'), title=el('h2','','스마트폰');
  const back=btn('‹',()=>shell.back(),'뒤로'), close=btn('×',()=>shell.close(),'스마트폰 닫기');
  header.append(back,title,close);
  const content=el('main','smartphone-content'), message=el('p','smartphone-message'); message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  const home=btn('홈',()=>{preferences.save();shell.home();},'홈 화면으로'); home.className='smartphone-home-button';
  const footer=el('footer','smartphone-footer'); footer.append(home);
  frame.append(wallpaper,statusBar,header,content,message,footer); root.append(frame); doc.body.append(root);
  let shell, uiEpoch=0, lastRoute='', suppressClose=0, currentPage=0, selectedApp=null, photoFilter='all', locationFilter='',
    savedFocus=null, wallpaperUrl=null, wallpaperKey='', wallpaperEpoch=0, destroyed=false, warning='';
  const objectUrls = new Set(), inertNodes=new Map();
  const say = text => {message.textContent=text;};
  const warn = text => {warning=text;say(text);onWarning(text);};
  const storage = () => {try {return win.localStorage;} catch {return null;}};
  const album=createPhoneAlbum({onError:warn});
  const preferences=createPhonePreferences({getStorage:storage,getScope:()=>album.scope,onError:warn});
  const history=createPhoneMapHistory({getStorage:storage,getScope:()=>album.scope,onError:warn});
  const mapSurface=createPhoneSurface(mapElement), settingsSurface=createPhoneSurface(settingsElement);
  const student=createStudentId({getClient,getIdentity,getProgression,onChange:()=>{if(shell?.snapshot().current?.appId==='student-id')render(true);}});
  function revokeImages() {for (const url of objectUrls) win.URL.revokeObjectURL(url); objectUrls.clear();}
  function attachImage(node,blob) {const url=win.URL.createObjectURL(blob);objectUrls.add(url);node.src=url;}
  function worldVisibility(open) {
    if(open) {
      doc.body.dataset.phoneOpen='true';
      for(const node of doc.body.children) if(node!==root && !inertNodes.has(node)){inertNodes.set(node,node.inert);node.inert=true;}
    } else {
      delete doc.body.dataset.phoneOpen;
      for(const [node,inert] of inertNodes) node.inert=inert;
      inertNodes.clear();
    }
  }
  async function setWallpaper() {
    const p=preferences.snapshot().wallpaper, key=`${album.scope}:${p.type}:${p.id}`;
    if(key===wallpaperKey)return;
    const at=++wallpaperEpoch; wallpaperKey=key;
    if(wallpaperUrl)win.URL.revokeObjectURL(wallpaperUrl);wallpaperUrl=null;wallpaper.hidden=true;wallpaper.removeAttribute('src');
    frame.dataset.wallpaper=p.type==='default'?p.id:'campus';
    if(p.type!=='photo')return;
    try {
      const blob=await album.image(p.id);
      if(at!==wallpaperEpoch||destroyed)return;
      if(!blob){preferences.wallpaper({type:'default',id:'campus'});preferences.save();wallpaperKey='';return setWallpaper();}
      wallpaperUrl=win.URL.createObjectURL(blob);wallpaper.src=wallpaperUrl;wallpaper.hidden=false;
    } catch {if(at===wallpaperEpoch)say('사진 배경을 불러오지 못했어요. 기본 배경을 표시해요.');}
  }
  function closeSurface(kind) {
    suppressClose++;
    try {if(kind==='maps'){getMap()?.close();mapSurface.restore();}else{getSettings()?.setOpen(false,{focus:false});settingsSurface.restore();}}
    finally{suppressClose--;}
  }
  const registry=[
    {id:'student-id',name:'학생증',icon:'🎓',available:()=>true,open:()=>{void student.refresh();},close(){}},
    {id:'maps',name:'지도',icon:'🗺️',available:()=>!!getMap(),open(){},close:()=>closeSurface('maps')},
    {id:'camera',name:'카메라',icon:'📷',available:()=>true,open(){},close(){}},
    {id:'album',name:'앨범',icon:'🖼️',available:()=>true,open(){},close(){}},
    {id:'settings',name:'설정',icon:'⚙️',available:()=>!!getSettings(),open(){},close:()=>closeSurface('settings')}
  ];
  function launch(id,params={}) {
    if(id==='camera'){
      if(!shell.camera(photoMode)){say(PHOTO_ENTRY_BLOCK_MESSAGES[photoMode.blockedReason({entryOwner:'smartphone'})]||'지금은 카메라를 열 수 없어요.');}
      return;
    }
    selectedApp=null;shell.launch(id,params);
  }
  function appSlot(id,area,slot,page) {
    const app=registry.find(x=>x.id===id), editing=shell.state===PHONE_STATE.HOME_EDIT;
    const n=btn('',()=>{
      if(suppressClick){suppressClick=false;return;}
      if(editing){selectedApp=id;render(true);}else if(app?.available())launch(id);
    },app?.name ?? `${area==='dock'?'Dock':'홈'} 빈 칸 ${slot+1}`);
    n.className='smartphone-app';n.dataset.area=area;n.dataset.slot=slot;n.dataset.page=page;
    if(id){n.dataset.appId=id;if(selectedApp===id)n.dataset.selected='true';}
    if(app?.available())n.append(el('span','smartphone-app-icon',app.icon),el('span','smartphone-app-name',app.name));
    else {n.disabled=!editing;n.classList.add('smartphone-empty');if(editing)n.textContent='＋';}
    return n;
  }
  function renderHome() {
    const p=preferences.snapshot(), editing=shell.state===PHONE_STATE.HOME_EDIT;
    currentPage=Math.min(currentPage,p.pages.length-1);
    title.textContent=editing?'홈 편집':'INHA WORLD';
    const clock=el('div','smartphone-clock',getClock()||new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
    clock.hidden=!p.widgets.includes('clock');content.append(clock);
    const grid=el('div','smartphone-grid');p.pages[currentPage].forEach((id,i)=>grid.append(appSlot(id,'home',i,currentPage)));content.append(grid);
    const dock=el('div','smartphone-dock');p.dock.forEach((id,i)=>dock.append(appSlot(id,'dock',i,0)));content.append(dock);
    if(p.pages.length>1){const pages=el('div','smartphone-page-controls');pages.append(btn('‹',()=>{currentPage=Math.max(0,currentPage-1);render(true);},'이전 홈 페이지'),el('span','',`${currentPage+1} / ${p.pages.length}`),btn('›',()=>{currentPage=Math.min(p.pages.length-1,currentPage+1);render(true);},'다음 홈 페이지'));content.append(pages);}
    if(!editing){content.append(btn('홈 화면 편집',()=>shell.edit()));return;}
    content.append(el('p','smartphone-hint','앱을 끌어 옮기거나 앱을 선택한 뒤 이동할 칸을 고르세요.'));
    const target=el('select');target.setAttribute('aria-label','앱 이동할 칸');
    for(const [area,count] of [['home',12],['dock',4]])for(let i=0;i<count;i++){const option=el('option','',`${area==='home'?'홈':'Dock'} ${i+1}`);option.value=`${area}:${i}`;target.append(option);}
    const move=btn('선택한 앱 이동',()=>{if(!selectedApp)return;const [area,slot]=target.value.split(':');preferences.move(selectedApp,{area,page:currentPage,slot:Number(slot)});render(true);});
    move.disabled=!selectedApp;content.append(target,move);
    const themes=el('div','smartphone-actions');for(const [id,label] of [['campus','캠퍼스'],['night','밤'],['mint','민트']])themes.append(btn(label,()=>{preferences.wallpaper({type:'default',id});void setWallpaper();}));content.append(themes);
    const widget=el('label','smartphone-widget-toggle','시계 표시 '), check=el('input');check.type='checkbox';check.checked=p.widgets.includes('clock');check.addEventListener('change',()=>{preferences.clock(check.checked);render(true);});widget.append(check);
    content.append(widget,btn('기본 배치 복구',()=>{preferences.reset();selectedApp=null;void setWallpaper();render(true);}),btn('편집 완료',()=>{preferences.save();shell.home();}));
  }
  function renderStudent() {
    const p=student.snapshot(), side=preferences.snapshot().studentIdFace;const card=el('article','smartphone-student-card');card.dataset.face=side;
    if(side==='front'){
    card.append(el('p','smartphone-eyebrow','INHA WORLD DIGITAL STUDENT ID'),el('div','smartphone-student-avatar',p.avatar),el('h3','',p.nickname),el('p','',p.department),el('strong','',p.progression?.levelText||'Campus Level 확인 전'),el('p','',p.title),el('small','','게임용 디지털 학생증 · 실제 학생증/학사 인증 아님'));
    content.append(card);
    }else{
    card.append(el('p','smartphone-eyebrow','INHA WORLD DIGITAL STUDENT ID'),el('h3','','성장과 기록'),el('p','',p.progression?.expText||(p.progressionState==='UNAVAILABLE'?'진행도를 불러오지 못했어요.':p.state==='GUEST'?'게스트는 계정 성장 기록을 표시하지 않아요.':'진행도를 확인하고 있어요.')));content.append(card);
    if(p.progression?.ratio!=null){const progress=el('progress');progress.max=1;progress.value=p.progression.ratio;progress.setAttribute('aria-label','다음 Campus Level까지 EXP');card.append(progress);}
    const badges=el('div','smartphone-badges');for(const a of p.badges)badges.append(el('span','',`🏅 ${a.title}`));card.append(badges);
    if(p.badgeState==='UNAVAILABLE')content.append(el('p','','배지를 불러오지 못했어요.'));
    if(p.playedGames!==null)content.append(el('p','',`플레이한 게임 ${p.playedGames}개`));
    }
    content.append(btn(side==='front'?'뒷면 보기':'앞면 보기',()=>{preferences.face(side==='front'?'back':'front');render(true);}));
    if(p.state==='LOADING')content.append(el('p','','프로필을 불러오는 중…'));
    if(p.state==='UNAVAILABLE')content.append(el('p','','프로필을 불러오지 못했어요.'),btn('다시 불러오기',()=>{void student.refresh();}));
  }
  async function renderAlbum(params,at) {
    content.append(el('p','smartphone-hint','사진은 이 브라우저·계정에 저장돼요. 다른 기기와 동기화되지 않아요.'));
    try {
      const records=await album.list();if(at!==uiEpoch||destroyed)return;
      if(params.photoId){
        const record=records.find(x=>x.id===params.photoId);if(!record){content.append(el('p','','이 사진을 찾을 수 없어요.'));return;}
        const image=el('img','smartphone-photo');image.alt=record.locationName;content.append(image);
        const blob=await album.image(record.id);if(at!==uiEpoch||destroyed)return;if(blob)attachImage(image,blob);
        content.append(el('h3','',record.locationName),el('p','',new Date(record.capturedAtReal).toLocaleString('ko-KR')),
          el('p','',record.position?`월드 위치 ${record.position.x.toFixed(1)}, ${record.position.z.toFixed(1)}`:'촬영 위치 기록 없음'));
        if(record.weatherId)content.append(el('p','',`날씨 · ${record.weatherId}`));
        content.append(btn(record.favorite?'★ 즐겨찾기 해제':'☆ 즐겨찾기',async()=>{if(await album.favorite(record.id,!record.favorite)&&at===uiEpoch)render(true);}),
          btn('지도에서 보기',()=>launch('maps',{point:record.position,mapSourceId:record.mapSourceId,locationName:record.locationName})),
          btn('홈 배경으로 사용',()=>{preferences.wallpaper({type:'photo',id:record.id});preferences.save();void setWallpaper();say('홈 배경에 적용했어요.');}));
        const confirm=btn('삭제 확인',async()=>{
          const removed=await album.remove(record.id);if(!removed||at!==uiEpoch)return;
          if(preferences.snapshot().wallpaper.type==='photo'&&preferences.snapshot().wallpaper.id===record.id){preferences.wallpaper({type:'default',id:'campus'});preferences.save();wallpaperKey='';void setWallpaper();}
          shell.back();
        });confirm.hidden=true;content.append(btn('사진 삭제',()=>{confirm.hidden=false;}),confirm);return;
      }
      const filters=el('div','smartphone-actions');for(const [id,label] of [['all','전체'],['recent','최근'],['favorites','즐겨찾기'],['places','장소별']]){
        const button=btn(label,()=>{photoFilter=id;render(true);});button.setAttribute('aria-pressed',String(photoFilter===id));filters.append(button);
      }content.append(filters);
      if(photoFilter==='places'){
        const select=el('select');select.setAttribute('aria-label','촬영 장소');const options=['',...new Set(records.map(x=>x.locationName))];
        for(const name of options){const option=el('option','',name||'모든 장소');option.value=name;select.append(option);}select.value=locationFilter;
        select.addEventListener('change',()=>{locationFilter=select.value;render(true);});content.append(select);
      }
      let visible=records.filter(x=>photoFilter!=='favorites'||x.favorite).filter(x=>photoFilter!=='places'||!locationFilter||x.locationName===locationFilter);
      if(photoFilter==='recent')visible=visible.slice(0,20);
      if(!visible.length){content.append(el('p','smartphone-empty-state',records.length?'해당하는 사진이 없어요.':'첫 캠퍼스 사진을 남겨 보세요.'),btn('카메라 열기',()=>launch('camera')));return;}
      const grid=el('div','smartphone-album-grid');content.append(grid);
      // Thumbnails only in the grid. Original blobs are opened solely in Viewer/wallpaper.
      for(const record of visible){
        const button=btn('',()=>launch('album',{photoId:record.id}),`${record.locationName} 사진 열기`),image=el('img');image.alt=record.locationName;image.loading='lazy';button.append(image,el('span','',`${record.favorite?'★ ':''}${record.locationName}`));grid.append(button);
        const blob=await album.image(record.id,'thumbnail');if(at!==uiEpoch||destroyed)return;if(blob)attachImage(image,blob);
      }
    } catch(error){if(at===uiEpoch&&error.name!=='AbortError'){content.append(el('p','','앨범을 불러오지 못했어요.'),btn('다시 시도',()=>render(true)));}}
  }
  function pickMapPlace(place) {
    const map=getMap();if(place.mapSourceId!==map?.status().mapSourceId){say('현재 지역의 지도에서만 위치를 선택할 수 있어요.');return;}
    map.selectMapPoint(place);map.centerOnPoint(place);
  }
  function renderMaps(params) {
    const tools=el('div','smartphone-map-tools');
    tools.append(btn('선택한 장소 즐겨찾기',()=>{const map=getMap();history.toggle(map?.selectedPoi,map?.status().mapSourceId);renderMapHistory(tools);}),el('div','smartphone-map-history'));
    content.append(tools);renderMapHistory(tools);mapSurface.mount(content);getMap()?.open();getMap()?.update();
    if(params.point){if(params.mapSourceId===getMap()?.status().mapSourceId)pickMapPlace({...params.point,mapSourceId:params.mapSourceId});else say('사진을 찍은 지역과 현재 지도 지역이 달라요.');}
  }
  function renderMapHistory(tools) {
    const list=tools.querySelector('.smartphone-map-history');list.replaceChildren();
    const view=history.snapshot();for(const [kind,records] of [['즐겨찾기',view.favorites],['최근 목적지',view.recent]]){
      if(!records.length)continue;const details=el('details');details.append(el('summary','',kind));
      for(const place of records)details.append(btn(place.title,()=>pickMapPlace(place)));list.append(details);
    }
  }
  function render(force=false) {
    if(!shell||destroyed)return;const s=shell.snapshot(), route=JSON.stringify([s.state,s.stack]);
    root.hidden=!shell.ownsInput;root.dataset.state=s.state;toggle?.setAttribute('aria-expanded',String(s.open));
    worldVisibility(shell.ownsInput);if(!shell.ownsInput){preferences.save();if(s.state==='CLOSED')toggle?.focus?.({preventScroll:true});}
    if(!force&&route===lastRoute)return;lastRoute=route;uiEpoch++;revokeImages();content.replaceChildren();say(warning);void setWallpaper();
    if(s.state==='HOME'||s.state==='HOME_EDIT')renderHome();
    else if(s.state==='APP'){
      const app=s.current;title.textContent=registry.find(x=>x.id===app.appId)?.name||'스마트폰';
      if(app.appId==='student-id')renderStudent();else if(app.appId==='album')void renderAlbum(app,uiEpoch);
      else if(app.appId==='maps')renderMaps(app);else if(app.appId==='settings'){settingsSurface.mount(content);getSettings()?.setOpen(true,{focus:false});}
    }
    if(shell.ownsInput){back.focus?.({preventScroll:true});}
  }
  shell=createPhoneShell({inputFocus,registry,canOpen,beforeOpen:()=>{savedFocus=doc.activeElement;beforeOpen?.();},onChange:()=>render(),onError:()=>say('앱을 열지 못했어요. 홈이나 닫기로 돌아갈 수 있어요.')});
  const unsubscribePhoto=photoMode.subscribe(shell.cameraChanged);
  function open() {return shell.open();}
  const toggleClick=()=>shell.state==='CLOSED'?open():shell.close();toggle?.addEventListener('click',toggleClick);
  function keyboard(event) {
    if(event.isComposing||event.keyCode===229)return;
    const typing=event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    if(event.code==='KeyN'&&!typing&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&shell.state!==PHONE_STATE.CAMERA){event.preventDefault();event.stopImmediatePropagation();toggleClick();return;}
    if(!shell.ownsInput)return;
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();preferences.save();shell.back();return;}
    if(event.code==='Tab'){
      const items=[...root.querySelectorAll('button,input,select,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length),index=items.indexOf(doc.activeElement);
      if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===items.length-1){event.preventDefault();items[event.shiftKey?items.length-1:0]?.focus();}
    }
    // Existing world listeners also consult InputFocus. Stop bubbling after UI handles editing.
    if(['KeyW','KeyA','KeyS','KeyD','Space','KeyF','KeyM','KeyE','KeyV'].includes(event.code)&&!typing)event.stopPropagation();
  }
  doc.addEventListener('keydown',keyboard,true);
  let pointer=null,holdTimer=null,suppressClick=false;
  function clearHold(){if(holdTimer!==null)win.clearTimeout(holdTimer);holdTimer=null;}
  root.addEventListener('pointerdown',event=>{
    if(!['HOME','HOME_EDIT'].includes(shell.state)||event.button!==0)return;
    const node=event.target.closest?.('[data-app-id]');
    if(!node){if(event.target===content||event.target.closest?.('.smartphone-empty,.smartphone-clock,.smartphone-grid'))holdTimer=win.setTimeout(()=>{shell.edit();suppressClick=true;},550);return;}
    pointer={id:node.dataset.appId,startX:event.clientX,startY:event.clientY,active:shell.state==='HOME_EDIT',pointerId:event.pointerId,type:event.pointerType};
    if(pointer.active)root.setPointerCapture?.(event.pointerId);
    holdTimer=win.setTimeout(()=>{if(!pointer)return;pointer.active=true;selectedApp=pointer.id;shell.edit();root.setPointerCapture?.(pointer.pointerId);suppressClick=true;},550);
  });
  root.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.pointerId)return;
    if(!pointer.active&&Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>12){
      clearHold();if(pointer.type==='mouse'){pointer.active=true;selectedApp=pointer.id;shell.edit();root.setPointerCapture?.(pointer.pointerId);}else{pointer=null;return;}
    }
    if(pointer.active){event.preventDefault();root.dataset.dragging=pointer.id;}
  });
  root.addEventListener('pointerup',event=>{
    clearHold();if(!pointer){win.setTimeout(()=>{suppressClick=false;},0);return;}
    if(pointer.active){const target=doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-slot]');
      if(target){preferences.move(pointer.id,{area:target.dataset.area,page:Number(target.dataset.page),slot:Number(target.dataset.slot)});selectedApp=pointer.id;render(true);}suppressClick=true;}
    pointer=null;delete root.dataset.dragging;
    win.setTimeout(()=>{suppressClick=false;},0);
  });
  root.addEventListener('pointercancel',()=>{clearHold();pointer=null;delete root.dataset.dragging;});
  root.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
  // Blocking UI stops outside-click HUD handlers, while Phone actions keep their own listeners.
  root.addEventListener('click',event=>event.stopPropagation());root.addEventListener('pointerdown',event=>event.stopPropagation());
  const pagehide=()=>{shell.close();};win.addEventListener('pagehide',pagehide);
  const visibility=()=>{if(doc.hidden){clearHold();pointer=null;shell.close();}};doc.addEventListener('visibilitychange',visibility);
  const legacyProfile=event=>{if(event.target?.closest?.('#open-profile')&&canOpen()){event.preventDefault();event.stopImmediatePropagation();if(open())launch('student-id');}};
  doc.addEventListener('click',legacyProfile,true);
  const clockTimer=win.setInterval(()=>{const n=content.querySelector('.smartphone-clock');if(n)n.textContent=getClock()||new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});},1000);
  return Object.freeze({root,album,shell,registry,open,close:()=>shell.close(),launch,
    setAccount(userId){shell.close();student.invalidate();album.setScope(userId);warning='';preferences.load();history.load();wallpaperKey='';void setWallpaper();},
    capture:async(result,context)=>album.save(result,context),
    captureContext:()=>({...getCaptureContext(),scope:album.scope,capturedAtReal:new Date().toISOString()}),
    async latestPhoto(){const records=await album.list(),record=records[0];return record?{record,blob:await album.image(record.id,'thumbnail')}:null;},
    openAlbum(record){photoMode.close('close');if(shell.state==='CLOSED')open();if(shell.ownsInput){launch('album');if(record)launch('album',{photoId:record.id});}},
    mapClosed(){if(suppressClose||shell.snapshot().current?.appId!=='maps')return;shell.back();},
    settingsChanged(open){if(!open&&!suppressClose&&shell.snapshot().current?.appId==='settings')shell.back();},
    navigationStarted(destination){if(shell.snapshot().current?.appId!=='maps')return;history.remember(destination,getMap()?.status().mapSourceId);shell.close();},
    refresh(){if(shell.snapshot().current?.appId==='student-id')render(true);},
    status:()=>({...shell.snapshot(),scope:album.scope,preferences:preferences.snapshot(),albumError:album.error}),
    destroy(){shell.close();destroyed=true;clearHold();win.clearInterval(clockTimer);shell.destroy();album.destroy();unsubscribePhoto();
      toggle?.removeEventListener('click',toggleClick);doc.removeEventListener('keydown',keyboard,true);doc.removeEventListener('click',legacyProfile,true);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',pagehide);
      revokeImages();if(wallpaperUrl)win.URL.revokeObjectURL(wallpaperUrl);worldVisibility(false);root.remove();}
  });
}
