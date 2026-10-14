// PHONE-NOTI-01A: read-only activity hub over existing Messages, Attendance and Daily Quiz.
// No RPC, reward, delivery queue or OS push. Seen/muted state is local presentation only.
export function createPhoneNotificationCenter({
  getStorage = () => null, getAttendance = () => null, getQuiz = () => null,
  onOpenApp = () => false, onChange = () => {}, doc = globalThis.document
} = {}) {
  let accountId = null, host = null, filter = 'all', messageUnread = 0;
  let settingsOpen = false, openError = false;
  let seen = new Set(), muted = new Set(), storageError = false;
  const groups = Object.freeze({all:'전체',messages:'메시지',daily:'오늘 할 일'});
  const key = () => 'inha-world-phone-notifications-v1:' + accountId;
  const node = (tag,cls='',label='') => {
    const item=doc.createElement(tag);item.className=cls;item.textContent=label;return item;
  };
  const button = (label,click,cls='') => {
    const item=node('button',cls,label);item.type='button';item.addEventListener('click',click);return item;
  };
  function save() {
    if (!accountId) return;
    try {
      const db=getStorage();if(!db)throw Error('storage unavailable');
      const data=JSON.stringify({v:1,seen:[...seen].slice(-80),muted:[...muted]});
      db.setItem(key(),data);
      if(db.getItem(key())!==data)throw Error('storage readback');
      storageError=false;
    } catch {storageError=true;}
  }
  function setAccount(id) {
    const next=typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)?id:null;
    if(next===accountId)return;
    accountId=next;messageUnread=0;seen=new Set();muted=new Set();filter='all';storageError=false;
    settingsOpen=false;openError=false;
    if(accountId) {
      try {
        const raw=JSON.parse(getStorage()?.getItem(key())||'null');
        if(raw?.v===1) {
          seen=new Set((Array.isArray(raw.seen)?raw.seen:[]).filter(x=>typeof x==='string'&&x.length<100).slice(-80));
          muted=new Set((Array.isArray(raw.muted)?raw.muted:[]).filter(x=>x==='daily'||x==='messages'));
        }
      } catch {storageError=true;}
    }
    changed();
  }
  const dailyEntry = (id,client) => {
    if(!accountId||client?.accountId!==accountId||client?.state!=='READY')return null;
    const s=client.snapshot;
    if(!s||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.rewardDate))return null;
    if(id==='attendance') {
      if(s.claimedToday!==false)return null;
      return {id:'attendance:'+s.rewardDate,group:'daily',appId:'attendance',icon:'📅',
        title:'오늘 출석 전',detail:'출석부에서 오늘의 출석 상태를 확인해 보세요.',action:'출석부 열기'};
    }
    if(id==='quiz'&&!['AVAILABLE','ACTIVE'].includes(s.status))return null;
    return {id:'quiz:'+s.rewardDate,group:'daily',appId:'daily-quiz',icon:'📚',
      title:s.status==='ACTIVE'?'진행 중인 오늘의 퀴즈':'오늘의 퀴즈 가능',
      detail:'오늘의 퀴즈 앱에서 진행 상태를 확인해 보세요.',action:'퀴즈 열기'};
  };
  function entries() {
    if(!accountId)return [];
    const rows=[];
    if(messageUnread>0)rows.push({id:'messages',group:'messages',appId:'messages',icon:'💬',
      title:'읽지 않은 메시지 '+Math.min(messageUnread,999)+'개',
      detail:'메시지함에서 확인하면 실제 읽음 상태가 갱신돼요.',action:'메시지 열기',
      unread:true,serverUnread:true});
    for(const entry of [dailyEntry('attendance',getAttendance()),dailyEntry('quiz',getQuiz())]) {
      if(entry)rows.push({...entry,unread:!seen.has(entry.id),serverUnread:false});
    }
    return rows;
  }
  function snapshot() {
    const rows=entries();
    const visible=rows.filter(x=>!muted.has(x.group));
    return {accountId,rows,visible,filter,muted:[...muted],storageError,settingsOpen,openError,
      counts:{all:visible.length,messages:visible.filter(x=>x.group==='messages').length,
        daily:visible.filter(x=>x.group==='daily').length},
      unreadCount:visible.reduce((n,x)=>n+(x.unread?(x.serverUnread?Math.min(messageUnread,99):1):0),0)};
  }
  function changed() {const state=snapshot();render(state);onChange(state);return state;}
  function setMessageUnread(value) {
    const next=Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
    if(next===messageUnread)return;
    messageUnread=next;changed();
  }
  function markRead(id) {
    if(!accountId||!entries().some(x=>x.id===id&&!x.serverUnread))return false;
    seen.add(id);save();changed();return true;
  }
  function markAllRead() {
    if(!accountId)return;
    for(const item of entries())if(!item.serverUnread)seen.add(item.id);
    save();changed();
  }
  function setMuted(group,value) {
    if(!accountId||!['messages','daily'].includes(group))return;
    if(value)muted.add(group);else muted.delete(group);
    save();changed();
  }
  function openEntry(entry) {
    // The existing Shell returns a synchronous boolean: mark local daily cards only after successful navigation.
    // Messages must still be read through the existing server-backed Messages app.
    const owner = accountId;
    let opened = false;
    try { opened = onOpenApp(entry.appId) === true; } catch { /* existing Phone remains usable */ }
    if (!opened) {
      if (owner === accountId) { openError = true; changed(); }
      return false;
    }
    if (owner === accountId && !entry.serverUnread) markRead(entry.id);
    return true;
  }
  function render(state=snapshot()) {
    if(!host)return;
    // Re-render without losing focus after filter, switch and details actions.
    const focusedControl=host.contains?.(doc.activeElement) ? doc.activeElement?.dataset?.notificationFocus : null;
    host.replaceChildren();
    const root=node('section','phone-notifications');
    root.setAttribute('aria-label','알림센터');host.append(root);

    const hero=node('div','phone-notifications-hero');
    const heroCopy=node('div','phone-notifications-hero-copy');
    heroCopy.append(node('h3','','오늘의 알림'));
    heroCopy.append(node('p','phone-notifications-summary',!accountId?'로그인 후 확인할 수 있어요.'
      :state.unreadCount>0?'확인할 새 알림 '+state.unreadCount+'건':'새로운 알림이 없어요'));
    const heroIcon=node('span','phone-notifications-hero-icon','🔔');
    heroIcon.setAttribute('aria-hidden','true');
    hero.append(heroCopy,heroIcon);root.append(hero);
    if(!accountId) {
      root.append(node('p','smartphone-empty-state','로그인하면 메시지·출석·퀴즈 알림을 확인할 수 있어요.'));
      return;
    }

    const controls=node('div','phone-notifications-filters');
    controls.setAttribute('role','group');controls.setAttribute('aria-label','알림 종류');
    for(const [id,name] of Object.entries(groups)){
      const b=button(name,()=>{filter=id;openError=false;changed();},'phone-notifications-filter');
      b.setAttribute('aria-pressed',String(filter===id));
      b.setAttribute('aria-label',name+' '+state.counts[id]+'개');
      b.dataset.notificationFocus='filter-'+id;
      const number=node('span','phone-notifications-count',String(state.counts[id]));
      b.append(number);controls.append(b);
    }
    root.append(controls);

    const list=node('div','phone-notifications-list');
    const visible=state.visible.filter(x=>filter==='all'||x.group===filter);
    if(!visible.length) {
      const empty=node('div','phone-notifications-empty');
      const icon=node('span','phone-notifications-empty-icon','🔕');icon.setAttribute('aria-hidden','true');
      empty.append(icon,node('strong','',state.rows.length===0?'지금은 새로운 알림이 없어요':
        state.visible.length===0?'표시 설정에서 모든 알림을 껐어요':'이 종류의 알림은 없어요'));
      empty.append(node('p','','새로운 메시지나 오늘 할 일이 생기면 여기에 표시돼요.'));
      list.append(empty);
    }
    for(const item of visible) {
      const card=node('article','phone-notification-item');
      card.dataset.category=item.group;card.dataset.unread=String(item.unread);
      const itemIcon=node('span','phone-notification-icon',item.icon);
      itemIcon.setAttribute('aria-hidden','true');
      const copy=node('div','phone-notification-copy');
      const top=node('div','phone-notification-heading');
      top.append(node('strong','',item.title));
      if(item.unread){
        const dot=node('span','phone-notification-unread','미확인');
        dot.setAttribute('aria-label','미확인 알림');
        top.append(dot);
      }
      copy.append(top,node('p','',item.detail));
      const action=button(item.action,()=>openEntry(item),'phone-notification-action');
      action.setAttribute('aria-label',item.title+' · '+item.action);
      action.dataset.notificationFocus='entry-'+item.id;
      card.append(itemIcon,copy,action);list.append(card);
    }
    root.append(list);
    if(state.openError) {
      const error=node('p','phone-notifications-error','앱을 열 수 없어요. 다시 시도해 주세요.');
      error.setAttribute('role','status');root.append(error);
    }

    const footer=node('div','phone-notifications-footer');
    const unreadDaily=state.visible.some(x=>x.group==='daily'&&x.unread);
    if(unreadDaily) {
      const all=button('할 일 알림 모두 확인',markAllRead,'phone-notifications-mark-all');
      all.dataset.notificationFocus='mark-all';footer.append(all);
    }
    const settingsButton=button('표시 설정',()=>{settingsOpen=!settingsOpen;openError=false;changed();},'phone-notifications-settings-button');
    settingsButton.setAttribute('aria-expanded',String(settingsOpen));
    settingsButton.setAttribute('aria-controls','phone-notifications-preferences');
    settingsButton.dataset.notificationFocus='settings';
    footer.append(settingsButton);root.append(footer);

    const preferences=node('div','phone-notifications-preferences');
    preferences.id='phone-notifications-preferences';preferences.hidden=!settingsOpen;
    for(const [id,name] of [['messages','메시지 알림'],['daily','출석·퀴즈 알림']]){
      const setting=node('div','phone-notifications-setting');
      const title=node('span','',name);
      const enabled=!muted.has(id);
      const toggle=button(enabled?'켜짐':'꺼짐',()=>setMuted(id,enabled),'phone-notifications-switch');
      toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(enabled));
      toggle.setAttribute('aria-label',name);
      toggle.dataset.notificationFocus='mute-'+id;
      setting.append(title,toggle);preferences.append(setting);
    }
    preferences.append(node('p','phone-notifications-hint',
      '이 기기에서 표시할 알림만 선택해요. OS 푸시 권한은 변경하지 않아요.'));
    root.append(preferences);
    root.append(node('p','phone-notifications-footnote','읽음 표시는 이 기기에만 저장돼요. 메시지 읽음은 메시지함에서 처리해요.'));
    if(state.storageError) {
      const error=node('p','phone-notifications-error','설정을 저장하지 못했어요. 현재 화면에만 적용돼요.');
      error.setAttribute('role','status');root.append(error);
    }
    if(focusedControl) {
      const selector='[data-notification-focus="'+focusedControl+'"]';
      (root.querySelector?.(selector) || root.querySelector?.('[data-notification-focus="settings"]'))?.focus?.({preventScroll:true});
    }
  }
  const offAttendance=getAttendance()?.onChange?.(()=>changed());
  const offQuiz=getQuiz()?.onChange?.(()=>changed());
  function mount(container){host=container;changed();}
  function close(){host=null;}
  function destroy(){close();offAttendance?.();offQuiz?.();accountId=null;seen.clear();muted.clear();messageUnread=0;}
  return Object.freeze({setAccount,setMessageUnread,mount,close,destroy,markRead,markAllRead,setMuted,
    snapshot,refresh:changed});
}
