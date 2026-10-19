import { createPhoneMotion, phoneGesture } from './phone-motion.js';
import { createPhoneShell, PHONE_STATE } from './phone-shell.js';
import { createPhoneAppRegistry, phoneExternalApp } from './phone-app-catalog.js';
import { phoneStoreSnapshot, phoneStoreMutate, phoneStoreCanOpen, phoneIdForStore } from './phone-store-integration.js';
import { createPhoneMessages } from './phone-messages.js';
import { createPhoneNotificationCenter } from './phone-notification-center.js';
import { createStudentId } from './student-id.js';
import { createAlbumManager } from './phone-album-manager.js';
import { formatPhotoBytes } from './phone-album-export.js';
import { createPhoneAlbum } from './phone-album.js';
import { createPhonePreferences, PHONE_APP_IDS } from './phone-preferences.js';
import { createPhoneSurface, createPhoneMapHistory } from './phone-surfaces.js';
import { PHOTO_ENTRY_BLOCK_MESSAGES } from '../photo/photo-mode-panel.js';
import { PURCHASE_ERRORS } from '../jeongseok/access-client.js';
import { gateMessage } from '../jeongseok/gate-panel.js';

export function createSmartphone({ inputFocus, photoMode, getMap, getSettings, getIdentity, getClient,
  getProgression, getCaptureContext, canOpen, beforeOpen, getClock = () => '', onAlbumViewed = () => {},
  toggle, mapElement, settingsElement, dailyQuizElement, attendanceElement,
  getDailyQuizPanel = () => null, getAttendancePanel = () => null,
  getDailyQuiz = () => null, getAttendance = () => null,
  getSocial = () => null, onOpenFriends = () => false,
  onWarning = () => {}, learning = null, jeongseok = null, doc = globalThis.document, win = globalThis.window }) {
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
  const motion=createPhoneMotion({win});
  let previousView=null, hidePrompt=null, hideBusy=false;
  let shell, uiEpoch=0, lastRoute='', suppressClose=0, currentPage=0, selectedApp=null, photoFilter='all', locationFilter='',
    savedFocus=null, wallpaperUrl=null, wallpaperKey='', wallpaperEpoch=0, destroyed=false, warning='',
    jeongseokReturn=null, jeongseokConfirm=false;
  const objectUrls = new Set(), inertNodes=new Map();
  const say = text => {message.textContent=text;};
  const warn = text => {warning=text;say(text);onWarning(text);};
  const storage = () => {try {return win.localStorage;} catch {return null;}};
  const album=createPhoneAlbum({onError:warn});
  const albumManager=createAlbumManager({album,doc,win,el,btn});
  const preferences=createPhonePreferences({getStorage:storage,getScope:()=>album.scope,getAppIds:()=>learning?.available()?[...PHONE_APP_IDS,'learning']:PHONE_APP_IDS,onError:warn});
  const history=createPhoneMapHistory({getStorage:storage,getScope:()=>album.scope,onError:warn});
  const mapSurface=createPhoneSurface(mapElement), settingsSurface=createPhoneSurface(settingsElement);
  const dailySurfaces={ 'daily-quiz':createPhoneSurface(dailyQuizElement), attendance:createPhoneSurface(attendanceElement) };
  const dailyPanels={ 'daily-quiz':getDailyQuizPanel, attendance:getAttendancePanel };
  function closeDailySurface(kind) {
    suppressClose++;
    try { dailyPanels[kind]?.()?.setOpen(false); dailySurfaces[kind]?.restore(); }
    finally { suppressClose--; }
  }
  function renderDailySurface(kind) {
    const panel=dailyPanels[kind]?.();
    if(!panel){content.append(el('p','smartphone-empty-state','이 앱을 지금 열 수 없어요.'));return;}
    dailySurfaces[kind].mount(content);
    panel.setOpen(true);
  }
  let messageUnread=0, notifications;
  const messages=createPhoneMessages({getClient,onUnread:count=>{
    messageUnread=count;
    const badge=root.querySelector('.smartphone-app[data-app-id="messages"] .smartphone-notification-badge');
    if(badge){badge.hidden=!count;badge.textContent=count>99?'99+':String(count);}
    notifications?.setMessageUnread(count);
  }});
  notifications=createPhoneNotificationCenter({getStorage:storage,getAttendance,getQuiz:getDailyQuiz,
    getSocial,getMessageActivity:()=>messages.readActivity(),
    onOpenApp:(id,params={})=>id==='friends'?openFriendsFromNotifications():launch(id,params),onChange:state=>{
      const badge=root.querySelector('.smartphone-app[data-app-id="notifications"] .smartphone-notification-badge');
      if(badge){badge.hidden=!state.unreadCount;badge.textContent=state.unreadCount>99?'99+':String(state.unreadCount);}
    },doc});
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
    try {if(kind==='maps'){offMapSelection?.();offMapSelection=null;getMap()?.close();mapSurface.restore();}else{getSettings()?.setOpen(false,{focus:false});settingsSurface.restore();}}
    finally{suppressClose--;}
  }
  const nativeRegistry=[
    {id:'learning',available:()=>learning?.available()===true,open(){},close:()=>learning?.unmount()},
    {id:'student-id',name:'학생증',icon:'🎓',available:()=>true,open:params=>{if(params?.view==='jeongseok'){if(jeongseok?.phoneView().enabled)void jeongseok.refresh();}else void student.refresh();},close(){}},
    {id:'maps',name:'지도',icon:'🗺️',available:()=>!!getMap(),open(){},close:()=>closeSurface('maps')},
    {id:'camera',name:'카메라',icon:'📷',available:()=>true,open(){},close(){}},
    {id:'album',name:'앨범',icon:'🖼️',available:()=>true,open(){},close(){}},
    {id:'settings',name:'설정',icon:'⚙️',available:()=>!!getSettings(),open(){},close:()=>closeSurface('settings')},
    {id:'daily-quiz',name:'오늘의 퀴즈',icon:'📚',available:()=>!!getDailyQuizPanel(),open(){},close:()=>closeDailySurface('daily-quiz')},
    {id:'attendance',name:'출석부',icon:'📅',available:()=>!!getAttendancePanel(),open(){},close:()=>closeDailySurface('attendance')},
    {id:'messages',name:'메시지',icon:'💬',available:()=>true,open:params=>messages.activate(params),close:()=>messages.close()},
    {id:'notifications',name:'알림센터',icon:'🔔',available:()=>true,open:()=>notifications.refresh(),close:()=>notifications.close()}
  ];
  const registry=createPhoneAppRegistry(nativeRegistry,()=>preferences.snapshot().installedApps);
  function openFriendsFromNotifications() {
    if(!getSocial()?.available)return false;
    shell.close();
    try {return onOpenFriends()===true;}
    catch {return false;}
  }
  function launch(id,params={}) {
    if(id==='camera'){
      if(!shell.camera(photoMode)){say(PHOTO_ENTRY_BLOCK_MESSAGES[photoMode.blockedReason({entryOwner:'smartphone'})]||'지금은 카메라를 열 수 없어요.');}
      return;
    }
    selectedApp=null;return shell.launch(id,params);
  }
  function appSlot(id,area,slot,page) {
    const app=registry.find(x=>x.id===id), editing=shell.state===PHONE_STATE.HOME_EDIT;
    const n=btn('',()=>{
      if(suppressClick){clearClickSuppression();return;}
      if(editing){selectedApp=id;render(true);}else if(app?.available())launch(id);
    },app?.name ?? `${area==='dock'?'Dock':'홈'} 빈 칸 ${slot+1}`);
    n.className='smartphone-app';n.dataset.area=area;n.dataset.slot=slot;n.dataset.page=page;
    if(id){n.dataset.appId=id;if(selectedApp===id)n.dataset.selected='true';}
    if(app?.available()){n.append(el('span','smartphone-app-icon',app.icon),el('span','smartphone-app-name',app.name));
      if(id==='messages'||id==='notifications'){
        const count=id==='messages'?messageUnread:notifications.snapshot().unreadCount;
        const badge=el('b','smartphone-notification-badge',count>99?'99+':String(count));
        badge.hidden=!count;badge.setAttribute('aria-label',id==='messages'?'읽지 않은 메시지':'확인할 알림');n.append(badge);
      }
    }
    else {n.disabled=!editing;n.classList.add('smartphone-empty');if(editing)n.textContent='＋';}
    if(!editing||!id||id==='induck-store')return n;
    const cell=el('div','smartphone-app-cell');
    const remove=btn('−',()=>area==='dock'?unpinApp(id):confirmHide(id,n),area==='dock'?`${app.name} Dock에서 홈으로 이동`:`${app.name} 홈에서 숨기기`);
    remove.className='smartphone-remove';cell.append(n,remove);return cell;
  }
  function unpinApp(id) {
    if(!preferences.commit(()=>preferences.unpin(id))){warn('Dock 이동을 저장하지 못했어요. 이전 배치를 유지해요.');return;}
    selectedApp=null;render(true);say('Dock 바로가기를 홈의 빈 칸으로 옮겼어요.');
  }
  function dismissHide() {hidePrompt?.remove();hidePrompt=null;}
  function confirmHide(id,icon) {
    if(hidePrompt||hideBusy)return;
    const app=registry.find(x=>x.id===id), panel=el('section','smartphone-hide-confirm');
    panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',`${app.name} 홈에서 숨기기`);
    panel.append(el('p','',`${app.name} 바로가기를 홈에서 숨길까요? 앱 설치와 계정·게임 데이터는 유지돼요. 아래 숨긴 앱에서 다시 표시할 수 있어요.`));
    const cancel=btn('취소',()=>{dismissHide();icon.focus?.();});
    const confirm=btn('숨기기 확인',async()=>{
      if(hideBusy)return;
      // Persist and verify before any success visual. Failure retains the exact layout.
      if(!preferences.commit(()=>preferences.hide(id))){dismissHide();warn('숨기기를 저장하지 못했어요. 이전 배치를 유지해요.');icon.focus?.();return;}
      hideBusy=true;dismissHide();const at=uiEpoch;icon.disabled=true;
      await motion.play(icon,[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.15)'}],180);
      if(at!==uiEpoch||destroyed)return;hideBusy=false;
      selectedApp=null;render(true);say('홈에서 숨겼어요. 숨긴 앱에서 다시 표시할 수 있어요.');
    });
    panel.append(cancel,confirm);hidePrompt=panel;content.prepend(panel);cancel.focus?.();
  }
  function changePage(delta) {
    const next=Math.max(0,Math.min(preferences.snapshot().pages.length-1,currentPage+delta));
    if(next===currentPage)return false;
    currentPage=next;render(true);void motion.play(content,[{opacity:.35,transform:`translateX(${delta>0?24:-24}px)`},{opacity:1,transform:'none'}]);return true;
  }
  function renderHome() {
    const p=preferences.snapshot(), editing=shell.state===PHONE_STATE.HOME_EDIT;
    currentPage=Math.min(currentPage,p.pages.length-1);
    title.textContent=editing?'홈 편집':'INHA WORLD';
    const clock=el('div','smartphone-clock',getClock()||new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
    clock.hidden=!p.widgets.includes('clock');content.append(clock);
    const grid=el('div','smartphone-grid');p.pages[currentPage].forEach((id,i)=>grid.append(appSlot(id,'home',i,currentPage)));content.append(grid);
    const dock=el('div','smartphone-dock');p.dock.forEach((id,i)=>dock.append(appSlot(id,'dock',i,0)));content.append(dock);
    if(p.pages.length>1){const pages=el('div','smartphone-page-controls');pages.append(btn('‹',()=>{changePage(-1);},'이전 홈 페이지'),el('span','',`${currentPage+1} / ${p.pages.length}`),btn('›',()=>{changePage(1);},'다음 홈 페이지'));content.append(pages);}
    if(p.hiddenApps.length){
      const library=el('details','smartphone-hidden-apps');library.append(el('summary','','숨긴 앱'));
      for(const id of p.hiddenApps){const app=registry.find(x=>x.id===id);if(!app?.available())continue;
        library.append(btn(`${app.icon} ${app.name} 다시 표시`,()=>{if(preferences.commit(()=>preferences.show(id))){render(true);say('홈에 다시 표시했어요.');}else warn('앱 표시를 저장하지 못했어요.');}));
      }content.append(library);
    }
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
    card.append(el('p','smartphone-eyebrow','INHA WORLD DIGITAL STUDENT ID'),el('div','smartphone-student-avatar',p.avatar),el('h3','',p.nickname),el('p','',p.department),el('strong','',p.progression?.levelText||'Campus Level 확인 전'),el('p','',p.title));
    if(p.inhaMailVerified!==null){const mail=el('p','smartphone-student-mail',p.inhaMailVerified?'✉️ 인하대 이메일 인증됨':'인하대 이메일 미인증');mail.dataset.verified=String(p.inhaMailVerified);card.append(mail);}
    card.append(el('small','','게임용 디지털 학생증 · 실제 학생증/학사 인증 아님 · 이메일 인증은 메일 소유 확인일 뿐 재학·재직 증명이 아니에요'));
    card.querySelector('.smartphone-student-avatar').setAttribute('role','img');card.querySelector('.smartphone-student-avatar').setAttribute('aria-label',`${p.nickname} 프로필 아바타`);
    content.append(card);
    }else{
    card.append(el('p','smartphone-eyebrow','INHA WORLD DIGITAL STUDENT ID'),el('h3','','성장과 기록'),el('p','',p.progression?.expText||(p.progressionState==='UNAVAILABLE'?'진행도를 불러오지 못했어요.':p.state==='GUEST'?'게스트는 계정 성장 기록을 표시하지 않아요.':'진행도를 확인하고 있어요.')));content.append(card);
    if(p.progression?.ratio!=null){const progress=el('progress');progress.max=1;progress.value=p.progression.ratio;progress.setAttribute('aria-label','다음 Campus Level까지 EXP');card.append(progress);}
    const badges=el('div','smartphone-badges');for(const a of p.badges)badges.append(el('span','',`🏅 ${a.title}`));card.append(badges);
    if(p.badgeState==='UNAVAILABLE')content.append(el('p','','배지를 불러오지 못했어요.'));
    if(p.playedGames!==null)content.append(el('p','',`플레이한 게임 ${p.playedGames}개`));
    }
    content.append(btn(side==='front'?'뒷면 보기':'앞면 보기',()=>{preferences.face(side==='front'?'back':'front');render(true);}));
    if(jeongseok?.phoneView().enabled)content.append(btn('🏛️ 정석학술정보관 출입',()=>launch('student-id',{view:'jeongseok'})));
    if(p.state==='LOADING')content.append(el('p','','프로필을 불러오는 중…'));
    if(p.state==='UNAVAILABLE')content.append(el('p','','프로필을 불러오지 못했어요.'),btn('다시 불러오기',()=>{void student.refresh();}));
  }
  const passTime=iso=>new Date(iso).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const passDuration=seconds=>seconds%3600===0?`${seconds/3600}시간`:seconds%60===0?`${seconds/60}분`:`${seconds}초`;
  function renderJeongseok() {
    const v=jeongseok?.phoneView(); title.textContent='정석 출입';
    const card=el('article','smartphone-jeongseok-card');content.append(card);
    card.append(el('p','smartphone-eyebrow','INHA WORLD · 정석학술정보관 출입 (게임 전용)'));
    if(!v?.enabled){card.append(el('p','','정석학술정보관 내부 게이트는 준비 중이에요.'));return;}
    const a=v.access,s=a.snapshot,g=v.gate;card.dataset.gate=g.state;
    if(['SCANNING','GRANTED','OPENING','READY_TO_ENTER'].includes(g.state)){
      const tag=el('div','smartphone-jeongseok-tag');tag.dataset.state=g.state;tag.setAttribute('role','img');
      tag.setAttribute('aria-label',g.via==='VISITOR_PASS'?'가상 방문증을 리더기에 태그':'가상 학생증을 리더기에 태그');
      tag.append(el('span','smartphone-jeongseok-tag-card',g.via==='VISITOR_PASS'?'🪪':'🎓'),el('span','smartphone-jeongseok-tag-reader',''));
      card.append(tag);
    }
    // Refusals are explained by the server lines below; the gate line covers progress only.
    if(['CHECKING','SCANNING','GRANTED','OPENING','READY_TO_ENTER','PURCHASING','UNKNOWN'].includes(g.state)){const live=el('strong','smartphone-jeongseok-gate',gateMessage(g));live.setAttribute('role','status');card.append(live);}
    const line=(text,cls='')=>card.append(el('p',cls,text));
    line('로비는 로그인 없이 자유롭게 이용할 수 있어요. 내부 게이트는 인하대 이메일 인증 계정은 무료, 그 외 계정은 방문증이 필요해요.');
    if(v.atGuide)line('로비 안내 NPC · 게임 속 가상 안내원이에요. 방문증을 구입한 뒤 리더기에서 따로 태그해 주세요.','smartphone-hint');
    // An unresolved request is recovered with its own key before anything else, whatever the read says.
    // Only after the request ended without a definitive answer; an in-flight request is not "unresolved".
    if(a.pendingKey&&!a.purchasing&&g.state!=='PURCHASING'&&v.atGuide&&a.accountId){
      line('이전 방문증 발급 요청의 결과를 확인하지 못했어요. 같은 요청으로 다시 확인하면 중복 결제 없이 결과를 받아요.','smartphone-jeongseok-error');
      const epoch=uiEpoch, account=a.accountId;
      content.append(btn('같은 요청 다시 확인',()=>{
        if(epoch===uiEpoch&&jeongseok.phoneView().access.accountId===account)void jeongseok.purchase();
      }));
    }
    if(a.pendingKey&&!v.atGuide)line('이전 방문증 발급 결과는 로비 안내 NPC 곁에서 같은 요청으로 다시 확인할 수 있어요.');
    if(a.state==='SIGNED_OUT')line('방문증 구매에는 정식 계정 로그인이 필요해요. 로그인 메뉴에서 계정을 연결한 뒤 안내 NPC에게 돌아오세요.');
    else if(!s&&a.state==='LOADING')line('출입 자격을 서버에서 확인하고 있어요…');
    else if(a.state==='UNKNOWN'||!s){line('내부 출입 자격을 확인하지 못했어요. 로비는 계속 이용할 수 있어요.');content.append(btn('다시 확인',()=>{void jeongseok.refresh();}));}
    else{
      // The last server answer for this account stays visible while a newer read is in flight.
      if(a.state==='LOADING')line('최신 상태를 다시 확인하고 있어요…','smartphone-hint');
      if(s.inhaMailVerified!==null)line(s.inhaMailVerified?'✉️ 인하대 이메일 인증 회원':'인하대 이메일 미인증 계정','smartphone-student-mail');
      if(s.decision==='DISABLED'||s.decision==='COMING_SOON')line(s.decision==='COMING_SOON'?'정석학술정보관 내부 게이트는 준비 중이에요.':'정석학술정보관 내부 게이트가 지금은 닫혀 있어요.');
      else if(s.decision==='AUTH_REQUIRED')line('방문증 구매에는 정식 계정 로그인이 필요해요. 로그인 메뉴에서 계정을 연결해 주세요.');
      else if(s.decision==='ACCOUNT_BLOCKED')line('현재 계정 상태로는 출입할 수 없어요.');
      else if(s.via==='INHA_MAIL')line('무료 내부 출입 가능 · 방문증 없이 리더기에 학생증을 태그하세요.','smartphone-jeongseok-ok');
      else if(s.via==='VISITOR_PASS'){
        line('🪪 가상 정석 방문증 보유','smartphone-jeongseok-ok');
        const left=Math.max(0,Date.parse(s.pass.expiresAt)-(Date.now()+s.clockOffsetMs));
        line(`만료 ${passTime(s.pass.expiresAt)} · 약 ${Math.floor(left/3600000)}시간 ${Math.floor(left%3600000/60000)}분 남음 (서버 시각 기준)`);
      }else renderJeongseokOffer(v,line);
    }
    if((v.atReader||v.atGuide)&&g.state!=='IDLE'){const cancel=btn('출입 취소',()=>{jeongseokConfirm=false;jeongseok.cancel();},'정석 출입 취소');cancel.disabled=!g.canCancel;content.append(cancel);}
    card.append(el('small','','가상 학생증·방문증은 게임 속 표현이에요. 실제 학교 출입·학생 신분을 증명하지 않으며 QR·바코드를 사용하지 않아요.'));
  }
  function renderJeongseokOffer(v,line) {
    const a=v.access,s=a.snapshot,o=s.offer,g=v.gate;
    line(s.decision==='EXPIRED'?`방문증이 ${passTime(s.pass.expiresAt)}에 만료됐어요.`:'방문증이 필요해요.');
    if(!o||o.status!=='ACTIVE'){line('방문증 발급은 아직 준비 중이에요.');return;}
    const facts=el('dl','smartphone-jeongseok-offer');
    for(const [k,val] of [['상품',`정석 ${passDuration(o.durationSeconds)} 방문증 (게임 전용)`],['가격',`${o.price} 인덕코인`],['보유',`${o.balance} 인덕코인`],
      ...(o.canPurchase?[['결제 후',`${o.balance-o.price} 인덕코인`]]:[]),['유효기간',`발급 시각부터 현실 시간 ${passDuration(o.durationSeconds)}`]])facts.append(el('dt','',k),el('dd','',val));
    content.append(facts,el('p','smartphone-hint','계정 귀속 · 양도·거래 불가 · 유효기간 중 중복 구매 불가'));
    if(!o.canPurchase)content.append(el('p','',`인덕코인이 ${o.shortfall}개 부족해요.`));
    if(a.purchaseError)content.append(el('p','smartphone-jeongseok-error',PURCHASE_ERRORS[a.purchaseError]??PURCHASE_ERRORS.UNKNOWN));
    if(!v.atGuide){jeongseokConfirm=false;content.append(el('p','','방문증은 로비 내부 게이트 옆 안내 NPC에게 구입할 수 있어요.'));return;}
    if(g.state==='PURCHASING'||a.purchasing){const wait=btn('발급 확인 중…',()=>{});wait.disabled=true;content.append(wait);return;}
    if(a.pendingKey)return;
    if(!jeongseokConfirm){const buy=btn(`방문증 발급하기 · ${o.price} 인덕코인`,()=>{jeongseokConfirm=true;render(true);});buy.disabled=!g.canPurchase||a.state!=='READY';content.append(buy);return;}
    const epoch=uiEpoch, account=a.accountId;
    const confirm=btn(`결제 확인 · ${o.price} 인덕코인 사용`,()=>{
      if(epoch!==uiEpoch||jeongseok.phoneView().access.accountId!==account)return;
      jeongseokConfirm=false;void jeongseok.purchase();
    });
    confirm.disabled=!g.canPurchase||a.state!=='READY';
    content.append(confirm,btn('구매 취소',()=>{jeongseokConfirm=false;render(true);}));
  }
  async function renderAlbum(params,at) {
    content.append(el('p','smartphone-hint','사진은 이 브라우저·계정에 저장돼요. 다른 기기와 동기화되지 않아요.'));
    try {
      const records=await album.list();if(at!==uiEpoch||destroyed)return;
      if(params.storage){await albumManager.mount(content,{storage:true});return;}
      if(params.photoId){
        const record=records.find(x=>x.id===params.photoId);if(!record){content.append(el('p','','이 사진을 찾을 수 없어요.'));return;}
        const image=el('img','smartphone-photo');image.alt=record.locationName;
        image.addEventListener('load',()=>{if(at===uiEpoch&&!destroyed&&image.naturalWidth>0)onAlbumViewed(record);},{once:true});
        image.addEventListener('error',()=>{if(at===uiEpoch&&!destroyed)say('사진을 표시하지 못했어요. 앨범에서 다시 열어 주세요.');},{once:true});
        content.append(image);
        const blob=await album.image(record.id);if(at!==uiEpoch||destroyed)return;if(blob)attachImage(image,blob);
        const sizes=await album.sizes(record.id);if(at!==uiEpoch||destroyed)return;
        content.append(el('p','',`원본 ${formatPhotoBytes(sizes.originalBytes)} · 썸네일 ${formatPhotoBytes(sizes.thumbnailBytes)}`));
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
      const manager=await albumManager.mount(content,{openStorage:()=>launch('album',{storage:true})});
      if(at!==uiEpoch||destroyed)return;
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
        const button=btn('',()=>{if(!manager?.pick(record.id))launch('album',{photoId:record.id});},`${record.locationName} 사진 열기`),image=el('img');image.alt=record.locationName;image.loading='lazy';button.append(image,el('span','',`${record.favorite?'★ ':''}${record.locationName}`));grid.append(button);manager?.bind(record.id,button);
        if(manager)button.append(el('small','',`원본 ${formatPhotoBytes(manager.byId.get(record.id)?.originalBytes)}`));
        const blob=await album.image(record.id,'thumbnail');if(at!==uiEpoch||destroyed)return;if(blob)attachImage(image,blob);
      }
    } catch(error){if(at===uiEpoch&&error.name!=='AbortError'){content.append(el('p','','앨범을 불러오지 못했어요.'),btn('다시 시도',()=>render(true)));}}
  }
  function pickMapPlace(place) {
    const map=getMap();if(place.mapSourceId!==map?.status().mapSourceId){say('현재 지역의 지도에서만 위치를 선택할 수 있어요.');return;}
    const selected=map.selectStoredPlace?.(place) ?? (!place.poiId ? map.selectMapPoint(place) : null);
    if(!selected){say('이 장소는 현재 지도에서 찾을 수 없어요.');return;}
    map.centerOnPoint(selected);
  }
  let offMapSelection=null;
  function renderMaps(params) {
    offMapSelection?.();
    const tools=el('div','smartphone-map-tools');
    const favorite=btn('',()=>{const map=getMap();history.toggle(map?.selectedPoi,map?.status().mapSourceId);renderMapHistory(tools);});
    favorite.dataset.mapFavorite='true';tools.append(favorite,el('div','smartphone-map-history'));
    offMapSelection=getMap()?.onSelectionChange(()=>renderMapHistory(tools));
    content.append(tools);renderMapHistory(tools);mapSurface.mount(content);getMap()?.open();getMap()?.update();
    if(params.point){if(params.mapSourceId===getMap()?.status().mapSourceId)pickMapPlace({...params.point,mapSourceId:params.mapSourceId});else say('사진을 찍은 지역과 현재 지도 지역이 달라요.');}
  }
  function renderMapHistory(tools) {
    const map=getMap(),place=map?.selectedPoi,selected=!!place;
    const favorite=tools.querySelector('[data-map-favorite]'),active=history.has(place,map?.status().mapSourceId);
    favorite.disabled=!selected;favorite.textContent=active?'★ 즐겨찾기 해제':'☆ 즐겨찾기 추가';
    favorite.setAttribute('aria-pressed',String(active));
    const list=tools.querySelector('.smartphone-map-history');list.replaceChildren();
    const view=history.snapshot();for(const [kind,records] of [['즐겨찾기',view.favorites],['최근 목적지',view.recent]]){
      if(!records.length)continue;const details=el('details');details.append(el('summary','',kind));
      for(const place of records)details.append(btn(place.title,()=>pickMapPlace(place)));list.append(details);
    }
  }
  // INHA OS live storefront: Phone preferences, never the iframe, own installed Home apps.
  let storeFrame=null;
  const storeMessage=(action,data={})=>{
    const target=storeFrame?.contentWindow;
    if(!storeFrame?.isConnected||!target||!win.location?.origin)return;
    target.postMessage({channel:'INHA_OS_STORE_021',action,...data},win.location.origin);
  };
  const sendStoreSync=()=>storeMessage('sync',{snapshot:phoneStoreSnapshot(preferences,registry)});
  function receiveStoreMessage(event) {
    if(!storeFrame?.isConnected||event.source!==storeFrame.contentWindow||
      event.origin!==win.location?.origin||event.data?.channel!=='INHA_OS_STORE_021'||
      shell?.snapshot().current?.appId!=='induck-store')return;
    const {action,id,requestId}=event.data;
    if(action==='ready'){sendStoreSync();return;}
    if(action==='back'){shell.back();return;}
    if(!Number.isSafeInteger(requestId)||requestId<1||requestId>1000000000)return;
    if(!['install','uninstall','pin','open','home'].includes(action))return;
    if(action==='home'){shell.home();return;}
    if(action==='open'){
      const ok=phoneStoreCanOpen(registry,preferences,id)&&launch(phoneIdForStore(id));
      if(!ok)storeMessage('result',{requestId,ok:false,snapshot:phoneStoreSnapshot(preferences,registry)});
      return;
    }
    // Denied, non-existent, or failed writes cannot claim installation in the Store.
    const changed=phoneStoreMutate(preferences,action,id);
    let ok=changed&&preferences.save();
    if(changed&&!ok){preferences.load();warn('앱 설정 저장 실패 · 이전 배치를 유지했어요.');}
    storeMessage('result',{requestId,ok,snapshot:phoneStoreSnapshot(preferences,registry)});
  }
  win.addEventListener('message',receiveStoreMessage);
  function renderStore() {
    const frame=el('iframe','phone-store-iframe');
    frame.title='인덕스토어 v0.2.1 · INHA OS 앱 관리';
    frame.loading='eager';
    frame.referrerPolicy='same-origin';
    frame.src='/campus/induck-store-v0.2.1.html?phone=1&scope='+encodeURIComponent(album.scope);
    frame.addEventListener('load',()=>{if(storeFrame===frame)sendStoreSync();});
    storeFrame=frame;
    content.append(frame);
  }
  function renderExternalGame(id) {
    const app=phoneExternalApp(id);
    if(!app||!preferences.snapshot().installedApps.includes(id)) {
      content.append(el('p','smartphone-empty-state','설치된 게임 바로가기가 아니에요.'));return;
    }
    content.append(el('h3','',app.icon+' '+app.name),
      el('p','smartphone-hint','별도 웹게임을 새 탭으로 열어요. 인하월드의 로그인·세이브·보상과 자동 연동되지 않아요.'));
    const link=el('a','phone-store-external','외부 게임 열기 ↗');
    link.href=app.url;link.target='_blank';link.rel='noopener noreferrer';
    link.setAttribute('aria-label',app.name+' 새 탭에서 열기');
    content.append(link,btn('인덕스토어로 돌아가기',()=>launch('induck-store')));
  }
  function render(force=false) {
    if(!shell||destroyed)return;const s=shell.snapshot(), route=JSON.stringify([s.state,s.stack]);
    if(previousView?.state!==s.state||previousView?.appId!==s.current?.appId){motion.cancel();cancelPointer();dismissHide();}
    root.hidden=!shell.ownsInput;root.dataset.state=s.state;toggle?.setAttribute('aria-expanded',String(s.open));
    content.className=s.state==='APP'&&s.current?.appId==='induck-store'?'smartphone-content phone-store-host':'smartphone-content';
    worldVisibility(shell.ownsInput);if(!shell.ownsInput){preferences.save();if(s.state==='CLOSED'&&inputFocus.can('WORLD_ACTION')){
      const focus=savedFocus?.isConnected&&savedFocus.getClientRects().length?savedFocus:toggle;focus?.focus?.({preventScroll:true});savedFocus=null;
    }}
    const gateView=s.current?.appId==='student-id'&&s.current.view==='jeongseok'&&s.current.origin==='gate';
    if(jeongseokReturn&&(!shell.ownsInput||!gateView)){jeongseokReturn=null;jeongseok?.phoneClosed();}
    if(!force&&route===lastRoute)return;const routeChanged=route!==lastRoute;lastRoute=route;if(routeChanged)jeongseokConfirm=false;
    dismissHide();hideBusy=false;motion.cancel();
    const oldView=previousView;previousView={state:s.state,appId:s.current?.appId};
    const keepFocus=!routeChanged&&root.contains(doc.activeElement)?doc.activeElement.textContent:null;uiEpoch++;storeFrame=null;albumManager.leave();revokeImages();content.replaceChildren();if(routeChanged)content.scrollTop=0;say(warning);void setWallpaper();
    if(s.state==='HOME'||s.state==='HOME_EDIT')renderHome();
    else if(s.state==='APP'){
      const app=s.current;title.textContent=registry.find(x=>x.id===app.appId)?.name||'스마트폰';
      if(app.appId==='student-id'){if(app.view==='jeongseok')renderJeongseok();else renderStudent();}else if(app.appId==='album')void renderAlbum(app,uiEpoch);
      else if(app.appId==='maps')renderMaps(app);else if(app.appId==='settings'){settingsSurface.mount(content);getSettings()?.setOpen(true,{focus:false});}
      else if(app.appId==='daily-quiz'||app.appId==='attendance')renderDailySurface(app.appId);
      else if(app.appId==='learning'){
        try { learning?.mount(content); } catch { learning?.unmount();warn('학습 앱을 열지 못했어요. 홈이나 닫기로 돌아갈 수 있어요.'); }
      }
      else if(app.appId==='messages')messages.mount(content);
      else if(app.appId==='notifications'){
        const handle=btn('⌃ 알림 닫기',()=>shell.back(),'알림센터 닫기');handle.className='smartphone-notification-handle';handle.dataset.notificationHandle='close';const host=el('div','smartphone-notifications-host');content.append(handle,host);notifications.mount(host);
      }
      else if(app.appId==='induck-store')renderStore();
      else if(phoneExternalApp(app.appId))renderExternalGame(app.appId);
    }
    notificationHandle.hidden=s.state!=='HOME';
    if(routeChanged&&shell.ownsInput){
      if(!oldView||['CLOSED','CAMERA'].includes(oldView.state))void motion.play(frame,[{opacity:0,transform:'translateY(24px) scale(.96)'},{opacity:1,transform:'none'}],260);
      else if(s.current?.appId==='notifications')void motion.play(content,[{opacity:.4,transform:'translateY(-36px)'},{opacity:1,transform:'none'}]);
      else if(oldView.appId==='notifications')void motion.play(content,[{opacity:.4,transform:'translateY(24px)'},{opacity:1,transform:'none'}]);
      else if(s.state==='APP'||oldView.state==='APP')void motion.play(content,[{opacity:.25,transform:s.state==='APP'?'scale(.94)':'scale(1.04)'},{opacity:1,transform:'none'}]);
    }
    if(shell.ownsInput && !['daily-quiz','attendance'].includes(s.current?.appId)){
      const same=keepFocus&&[...content.querySelectorAll('button')].find(n=>n.textContent===keepFocus&&!n.disabled);
      (same||back).focus?.({preventScroll:true});
    }
  }
  let pointer=null,holdTimer=null,suppressClick=false,clickResetTimer=null,gesture=null,freeTap=null;
  const notificationHandle=btn('⌄',()=>{if(shell.state==='HOME')launch('notifications');},'알림센터 열기');
  notificationHandle.className='smartphone-notification-handle';notificationHandle.dataset.notificationHandle='open';statusBar.append(notificationHandle);
  shell=createPhoneShell({inputFocus,registry,canOpen,beforeOpen:()=>{savedFocus=doc.activeElement;beforeOpen?.();},onChange:()=>render(),onError:()=>warn('앱을 열지 못했어요. 홈이나 닫기로 돌아갈 수 있어요.')});
  const unsubscribePhoto=photoMode.subscribe(shell.cameraChanged);
  function open() {return shell.open();}
  const toggleClick=()=>shell.state==='CLOSED'?open():shell.close();toggle?.addEventListener('click',toggleClick);
  function keyboard(event) {
    if(event.isComposing||event.keyCode===229)return;
    const typing=event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    if(hidePrompt&&!['Escape','Tab','Enter','Space'].includes(event.code)){event.stopImmediatePropagation();return;}
    if(event.code==='KeyN'&&!typing&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&shell.state!==PHONE_STATE.CAMERA){event.preventDefault();event.stopImmediatePropagation();toggleClick();return;}
    if(!shell.ownsInput)return;
    if(hidePrompt&&!hidePrompt.contains(doc.activeElement)&&['Enter','Space'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();hidePrompt.querySelector('button')?.focus();return;}
    if(event.code==='Escape'&&hidePrompt){event.preventDefault();event.stopImmediatePropagation();dismissHide();back.focus?.();return;}
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();preferences.save();shell.back();return;}
    if(event.code==='Tab'){
      const items=[...(hidePrompt||root).querySelectorAll('button,input,textarea,select,a[href],summary')].filter(n=>!n.disabled&&n.getClientRects().length),index=items.indexOf(doc.activeElement);
      if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===items.length-1){event.preventDefault();items[event.shiftKey?items.length-1:0]?.focus();}
    }
    // Existing world listeners also consult InputFocus. Stop bubbling after UI handles editing.
    if(['KeyW','KeyA','KeyS','KeyD','Space','KeyF','KeyM','KeyE','KeyV'].includes(event.code)&&!typing)event.stopPropagation();
  }
  doc.addEventListener('keydown',keyboard,true);
  function clearHold(){if(holdTimer!==null)win.clearTimeout(holdTimer);holdTimer=null;}
  function clearClickSuppression(){if(clickResetTimer!==null)win.clearTimeout(clickResetTimer);clickResetTimer=null;suppressClick=false;}
  function suppressGestureClick(){clearClickSuppression();suppressClick=true;clickResetTimer=win.setTimeout(()=>{clickResetTimer=null;suppressClick=false;},0);}
  function cancelPointer(){
    clearHold();clearClickSuppression();const held=pointer;pointer=null;gesture=null;freeTap=null;delete root.dataset.dragging;
    // Clear the tracked pointer before release: its deliberate lostcapture must not
    // cancel suppression armed after a completed drag or swipe.
    if(held&&root.hasPointerCapture?.(held.pointerId))root.releasePointerCapture?.(held.pointerId);
  }
  root.addEventListener('pointerdown',event=>{
    if(hidePrompt){if(!hidePrompt.contains(event.target))event.preventDefault();return;}
    if(event.button!==0||hideBusy)return;
    if(pointer||gesture){cancelPointer();return;}
    const handle=event.target.closest?.('[data-notification-handle]')?.dataset.notificationHandle;
    const node=event.target.closest?.('[data-app-id]');
    const free=event.target===content||event.target.closest?.('.smartphone-empty,.smartphone-clock')||event.target.classList?.contains('smartphone-grid');
    if(handle&&(shell.state==='HOME'||shell.snapshot().current?.appId==='notifications')){
      gesture={state:shell.state,handle,x:event.clientX,y:event.clientY,pointerId:event.pointerId};return;
    }
    if(!['HOME','HOME_EDIT'].includes(shell.state))return;
    if(shell.state==='HOME'&&(node||free))gesture={state:'HOME',x:event.clientX,y:event.clientY,pointerId:event.pointerId};
    if(!node){
      if(free){freeTap={x:event.clientX,y:event.clientY,pointerId:event.pointerId,editing:shell.state==='HOME_EDIT'};
        if(shell.state==='HOME')holdTimer=win.setTimeout(()=>{gesture=null;freeTap=null;shell.edit();suppressClick=true;},550);}
      return;
    }
    if(event.target.closest?.('.smartphone-remove'))return;
    pointer={id:node.dataset.appId,startX:event.clientX,startY:event.clientY,active:shell.state==='HOME_EDIT',pointerId:event.pointerId,type:event.pointerType};
    if(pointer.active)root.setPointerCapture?.(event.pointerId);
    holdTimer=win.setTimeout(()=>{if(!pointer)return;const held=pointer;selectedApp=held.id;shell.edit();pointer={...held,active:true};gesture=null;root.setPointerCapture?.(held.pointerId);suppressClick=true;},550);
  });
  root.addEventListener('pointermove',event=>{
    const start=gesture||freeTap;
    if(start&&event.pointerId===start.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>12){clearHold();freeTap=null;}
    if(!pointer||event.pointerId!==pointer.pointerId)return;
    if(!pointer.active&&Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>12){clearHold();pointer=null;return;}
    if(pointer.active){event.preventDefault();root.dataset.dragging=pointer.id;}
  });
  root.addEventListener('pointerup',event=>{
    clearHold();let consumeClick=suppressClick;
    if(gesture&&event.pointerId===gesture.pointerId){
      const action=phoneGesture({state:gesture.state,handle:gesture.handle,dx:event.clientX-gesture.x,dy:event.clientY-gesture.y});
      if(action){cancelPointer();if(action==='notifications')launch('notifications');else if(action==='dismiss')shell.back();else changePage(action==='next'?1:-1);suppressGestureClick();return;}
    }
    if(freeTap?.editing&&event.pointerId===freeTap.pointerId){preferences.save();shell.home();consumeClick=true;}
    if(pointer?.active&&event.pointerId===pointer.pointerId){const target=doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-slot]');
      if(target){preferences.move(pointer.id,{area:target.dataset.area,page:Number(target.dataset.page),slot:Number(target.dataset.slot)});selectedApp=pointer.id;render(true);}consumeClick=true;}
    cancelPointer();if(consumeClick)suppressGestureClick();
  });
  root.addEventListener('focusin',event=>{if(hidePrompt&&!hidePrompt.contains(event.target))hidePrompt.querySelector('button')?.focus();});
  root.addEventListener('pointercancel',cancelPointer);
  root.addEventListener('lostpointercapture',event=>{if(pointer?.pointerId===event.pointerId)cancelPointer();});
  root.addEventListener('click',event=>{if(hidePrompt&&!hidePrompt.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();return;}if(suppressClick){event.preventDefault();event.stopImmediatePropagation();clearClickSuppression();}},true);
  // Blocking UI stops outside-click HUD handlers, while Phone actions keep their own listeners.
  root.addEventListener('click',event=>event.stopPropagation());root.addEventListener('pointerdown',event=>event.stopPropagation());
  const pagehide=()=>{cancelPointer();motion.cancel();dismissHide();shell.close();};win.addEventListener('pagehide',pagehide);
  const visibility=()=>{if(doc.hidden){pagehide();}};doc.addEventListener('visibilitychange',visibility);
  const legacyProfile=event=>{if(event.target?.closest?.('#open-profile')&&canOpen()){event.preventDefault();event.stopImmediatePropagation();if(open())launch('student-id');}};
  doc.addEventListener('click',legacyProfile,true);
  // The original HUD menu entries become Phone deep links only when Phone admission is possible.
  // Lobby/pre-world entry keeps its existing panel fallback, and never auto-claims attendance.
  const legacyDaily=event=>{
    const kind=event.target?.closest?.('#open-daily-quiz') ? 'daily-quiz'
      : event.target?.closest?.('#open-attendance') ? 'attendance' : null;
    if(!kind || !canOpen())return;
    event.preventDefault();event.stopImmediatePropagation();
    // Release HUD-menu ownership before Phone acquires its own blocking owner.
    // Doing this only after admission preserves legacy fallback outside the World.
    beforeOpen?.();
    if(open())launch(kind);
  };
  doc.addEventListener('click',legacyDaily,true);
  const clockTimer=win.setInterval(()=>{const n=content.querySelector('.smartphone-clock');if(n)n.textContent=getClock()||new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});},1000);
  return Object.freeze({root,album,shell,registry,open,close:()=>shell.close(),launch,
    setAccount(userId){cancelPointer();motion.cancel();dismissHide();albumManager.reset();shell.close();learning?.setAccount(userId);notifications.setAccount(userId);messages.setAccount(userId);student.invalidate();album.setScope(userId);warning='';preferences.load();history.load();wallpaperKey='';void setWallpaper();},
    openMessages(recipientId){if(shell.state==='CLOSED'&&!open())return false;return shell.ownsInput && launch('messages',{recipientId});},
    capture:async(result,context)=>album.save(result,context),
    captureContext:()=>({...getCaptureContext(),scope:album.scope,capturedAtReal:new Date().toISOString()}),
    async latestPhoto(){const records=await album.list(),record=records[0];return record?{record,blob:await album.image(record.id,'thumbnail')}:null;},
    openAlbum(record){photoMode.close('close');if(shell.state==='CLOSED')open();if(!shell.ownsInput||!launch('album'))return false;return record?launch('album',{photoId:record.id}):true;},
    mapClosed(){if(suppressClose||shell.snapshot().current?.appId!=='maps')return;shell.back();},
    dailyPanelClosed(kind){if(suppressClose||shell.snapshot().current?.appId!==kind)return false;return shell.back();},
    settingsChanged(open){if(!open&&!suppressClose&&shell.snapshot().current?.appId==='settings')shell.back();},
    navigationStarted(destination){if(shell.snapshot().current?.appId!=='maps')return;history.remember(destination,getMap()?.status().mapSourceId);shell.close();},
    refresh(){if(shell.snapshot().current?.appId==='student-id')render(true);else if(shell.snapshot().current?.appId==='notifications')notifications.refresh();},
    // The internal reader tags; the separate public-lobby guide shows pass guidance in Student ID.
    openJeongseok({tag=false}={}){
      if(!jeongseok?.phoneView().enabled||destroyed)return false;
      const s=shell.snapshot();
      if(s.current?.appId==='student-id'&&s.current.view==='jeongseok'){render(true);return true;}
      const wasOpen=s.state!=='CLOSED';
      if(!wasOpen&&!open())return false;
      if(!shell.ownsInput||!launch('student-id',{view:'jeongseok',origin:'gate',tag})){if(!wasOpen)shell.close();return false;}
      jeongseokReturn=wasOpen?'BACK':'CLOSE';return true;
    },
    endJeongseok(){
      const s=shell.snapshot(),how=jeongseokReturn;jeongseokReturn=null;
      if(s.current?.appId!=='student-id'||s.current.view!=='jeongseok'||s.current.origin!=='gate')return false;
      return how==='CLOSE'?shell.close():how==='BACK'?shell.back():false;
    },
    status:()=>({...shell.snapshot(),scope:album.scope,preferences:preferences.snapshot(),albumError:album.error,messages:messages.status(),notifications:notifications.snapshot()}),
    destroy(){cancelPointer();motion.destroy();dismissHide();albumManager.reset();shell.close();learning?.dispose();notifications.destroy();messages.setAccount(null);destroyed=true;clearHold();win.clearInterval(clockTimer);shell.destroy();album.destroy();unsubscribePhoto();
      toggle?.removeEventListener('click',toggleClick);doc.removeEventListener('keydown',keyboard,true);doc.removeEventListener('click',legacyProfile,true);doc.removeEventListener('click',legacyDaily,true);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',pagehide);win.removeEventListener('message',receiveStoreMessage);
      revokeImages();if(wallpaperUrl)win.URL.revokeObjectURL(wallpaperUrl);worldVisibility(false);root.remove();}
  });
}
