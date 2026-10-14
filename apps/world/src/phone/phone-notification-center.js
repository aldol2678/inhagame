// PHONE-NOTI-01A: read-only activity hub over existing Messages, Attendance and Daily Quiz.
// No RPC, reward, delivery queue or OS push. Seen/muted state is local presentation only.
export function createPhoneNotificationCenter({
  getStorage = () => null, getAttendance = () => null, getQuiz = () => null,
  onOpenApp = () => false, onChange = () => {}, doc = globalThis.document
} = {}) {
  let accountId = null, host = null, filter = 'all', messageUnread = 0;
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
    return {accountId,rows,visible,filter,muted:[...muted],storageError,
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
    // Messages are marked read only by their existing server-backed Messages flow.
    if(!entry.serverUnread)markRead(entry.id);
    onOpenApp(entry.appId);
  }
  function render(state=snapshot()) {
    if(!host)return;
    host.replaceChildren();
    const root=node('section','phone-notifications');root.setAttribute('aria-label','알림센터');host.append(root);
    root.append(node('h3','','🔔 알림센터'));
    root.append(node('p','phone-notifications-hint',
      '서버에서 확인된 메시지·출석·퀴즈 상태만 보여줘요. 읽음 표시는 이 기기의 알림 표시 설정이에요.'));
    if(!accountId){root.append(node('p','smartphone-empty-state','로그인하면 알림을 확인할 수 있어요.'));return;}
    const controls=node('div','phone-notifications-filters');
    for(const [id,name] of Object.entries(groups)){
      const b=button(name,()=>{filter=id;changed();});b.setAttribute('aria-pressed',String(filter===id));controls.append(b);
    }
    root.append(controls);
    const mute=node('div','phone-notifications-settings');
    for(const [id,name] of [['messages','메시지 표시'],['daily','출석·퀴즈 표시']]){
      const label=node('label','phone-notifications-setting',name),box=node('input');
      box.type='checkbox';box.checked=!muted.has(id);
      box.addEventListener('change',()=>setMuted(id,!box.checked));label.append(box);mute.append(label);
    }
    root.append(mute);
    const list=node('div','phone-notifications-list');
    const visible=state.visible.filter(x=>filter==='all'||x.group===filter);
    if(!visible.length)list.append(node('p','smartphone-empty-state','표시할 알림이 없어요.'));
    for(const item of visible) {
      const card=node('article','phone-notification-item');card.dataset.category=item.group;
      card.dataset.unread=String(item.unread);
      const label=node('div','phone-notification-copy');
      label.append(node('strong','',item.icon+' '+item.title),node('p','',item.detail));
      const action=button(item.action,()=>openEntry(item),'phone-notification-action');
      card.append(label,action);list.append(card);
    }
    root.append(list);
    const footer=node('div','phone-notifications-footer');
    footer.append(button('확인한 알림 표시 정리',markAllRead));
    if(state.storageError)footer.append(node('p','phone-notifications-error','읽음 설정을 저장하지 못했어요. 현재 화면에만 적용돼요.'));
    root.append(footer);
  }
  const offAttendance=getAttendance()?.onChange?.(()=>changed());
  const offQuiz=getQuiz()?.onChange?.(()=>changed());
  function mount(container){host=container;changed();}
  function close(){host=null;}
  function destroy(){close();offAttendance?.();offQuiz?.();accountId=null;seen.clear();muted.clear();messageUnread=0;}
  return Object.freeze({setAccount,setMessageUnread,mount,close,destroy,markRead,markAllRead,setMuted,
    snapshot,refresh:changed});
}
