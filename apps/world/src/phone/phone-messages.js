// PHONE-MENU-02A: presentation for the existing Hub messages authority.
// The legacy Hub client owns RPC names, parsing, permission errors and account generations.
export async function loadHubMessagesFactory(win = globalThis.window) {
  if (!win?.InhaHubMessagesClient?.createHubMessagesClient) {
    await import('../../hub-messages-client.js');
  }
  const factory = win?.InhaHubMessagesClient?.createHubMessagesClient;
  if (typeof factory !== 'function') throw Error('Hub messages client unavailable');
  return factory;
}

export const PHONE_MESSAGE_REPORT_CATEGORIES = Object.freeze([
  ['spam','스팸'],['harassment','욕설·괴롭힘'],
  ['inappropriate_content','부적절한 콘텐츠'],['impersonation','사칭'],['other','기타']
]);
export const phoneMessageErrorText = code => ({
  PERMANENT_ACCOUNT_REQUIRED:'로그인한 INHAGAME 계정이 필요해요.',
  ACCOUNT_UNAVAILABLE:'계정을 확인할 수 없어요.',
  SOCIAL_RESTRICTED:'이 계정은 쪽지 기능을 사용할 수 없어요.',
  INHA_VERIFICATION_REQUIRED:'새 대화는 인하대 이메일 인증 회원만 시작할 수 있어요.',
  TARGET_UNAVAILABLE:'이 사용자에게 쪽지를 보낼 수 없어요.',
  NOT_ALLOWED:'이 사용자와 쪽지를 주고받을 수 없어요.',
  CONVERSATION_UNAVAILABLE:'대화를 불러올 수 없어요.',
  MESSAGE_UNAVAILABLE:'메시지를 사용할 수 없어요.',
  RATE_LIMITED:'요청이 많아요. 잠시 후 다시 시도해 주세요.',
  INVALID_MESSAGE:'쪽지는 1~1000자로 입력해 주세요.',
  INVALID_CATEGORY:'신고 유형을 확인해 주세요.'
})[code] || '요청을 처리하지 못했어요. 다시 시도해 주세요.';

export function createPhoneMessages({ getClient, getFactory = loadHubMessagesFactory,
  onUnread = () => {}, doc = globalThis.document } = {}) {
  if (typeof getClient !== 'function') throw Error('Phone messages requires the existing Supabase client');
  let accountId = null, client = null, loading = null, host = null, active = false;
  let epoch = 0, view = 'inbox', current = null, thread = [], draft = '';
  let inbox = [], unread = 0, busy = false, notice = '', pendingRecipient = null;
  const el = (tag,cls='',value='') => {
    const node=doc.createElement(tag); node.className=cls; node.textContent=value; return node;
  };
  const button = (value,action,cls='') => {
    const node=el('button',cls,value); node.type='button'; node.addEventListener('click',action); return node;
  };
  const safe = ticket => active && ticket === epoch && client?.accountId === accountId;
  const date = value => {
    const n=new Date(value); return Number.isFinite(n.getTime()) ? n.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  };
  function notify(count) {
    unread = Math.max(0,Number(count)||0);
    onUnread(unread);
  }
  async function getModel() {
    if (client) return client;
    if (!loading) loading=Promise.resolve(getFactory()).then(factory=>{
      if(!client) client=factory({rpc:(name,args)=>{
        const api=getClient();return api?.rpc ? api.rpc(name,args) : Promise.resolve({error:{message:'ACCOUNT_UNAVAILABLE'}});
      }});
      client.setAccount(accountId);return client;
    }).finally(()=>{loading=null;});
    return loading;
  }
  function render() {
    if (!host || !active) return;
    host.replaceChildren();
    const root=el('section','phone-messages');root.setAttribute('aria-label','메시지함');
    root.dataset.view=view;host.append(root);
    const title=el('h3','','💬 메시지함');root.append(title);
    if (notice) {const state=el('p','phone-messages-notice',notice);state.setAttribute('role','status');root.append(state);}
    if (!accountId) {root.append(el('p','smartphone-empty-state','로그인하면 메시지를 확인할 수 있어요.'));return;}
    if (view === 'inbox') {
      const controls=el('div','phone-messages-controls');
      controls.append(button(busy?'불러오는 중…':'새로고침',()=>{void loadInbox();}));
      const count=el('span','phone-messages-unread',unread ? '읽지 않음 '+unread+'개' : '읽지 않은 메시지 없음');
      controls.append(count);root.append(controls);
      const form=el('form','phone-messages-new');
      const entry=el('input');entry.type='text';entry.maxLength=36;entry.placeholder='상대방 사용자 ID';entry.setAttribute('aria-label','새 쪽지 받을 사용자 ID');
      const start=button('새 대화',()=>{});start.type='submit';
      form.addEventListener('submit',event=>{event.preventDefault();if(!busy)void startConversation(entry.value.trim());});
      form.append(entry,start);root.append(form);
      if (!inbox.length) root.append(el('p','smartphone-empty-state',busy?'쪽지함을 불러오는 중…':'아직 받은 쪽지가 없어요.'));
      const list=el('div','phone-messages-inbox');
      for (const item of inbox) {
        const line=button('',()=>{void openConversation(item);},'phone-messages-inbox-item');
        line.append(el('strong','',item.other.nickname),el('span','',date(item.updatedAt)));
        line.append(el('small','',item.lastMessage?.deleted?'삭제된 메시지':item.lastMessage?.body||'새 대화'));
        if(item.unreadCount)line.append(el('b','phone-messages-count',String(item.unreadCount)));
        list.append(line);
      }
      root.append(list);return;
    }
    root.append(button('‹ 받은 쪽지함',()=>{void loadInbox();},'phone-messages-back'));
    if (!current) {root.append(el('p','','대화를 선택해 주세요.'));return;}
    root.append(el('h3','phone-messages-contact',current.other.nickname));
    if (current.blockedByMe || current.other.available===false) root.append(el('p','',current.blockedByMe?'차단된 사용자예요.':'현재 메시지를 보낼 수 없는 사용자예요.'));
    const list=el('div','phone-messages-thread');
    for(const msg of thread) {
      const mine=msg.senderId===accountId;
      const item=el('article','phone-messages-entry'+(mine?' is-mine':''));
      item.append(el('p','',msg.deleted?'삭제된 메시지':msg.body),el('small','',date(msg.createdAt)));
      if(!mine && !msg.deleted) {
        const report=el('div','phone-messages-report');
        const select=el('select');select.setAttribute('aria-label','메시지 신고 유형');
        for(const [value,label] of PHONE_MESSAGE_REPORT_CATEGORIES) {
          const option=el('option','',label);option.value=value;select.append(option);
        }
        const submit=button('신고',()=>{if(!busy)void reportMessage(msg.id,select.value);});
        report.append(select,submit);item.append(report);
      }
      list.append(item);
    }
    if(view==='draft')list.append(el('p','','처음 연락하는 상대예요. 새 대화 권한은 서버에서 검사해요.'));
    root.append(list);
    if(!current.blockedByMe && current.other.available!==false) {
      const form=el('form','phone-messages-composer');
      const field=el('textarea');field.maxLength=1000;field.rows=3;field.value=draft;field.placeholder='메시지를 입력하세요';field.setAttribute('aria-label','메시지 내용');
      field.addEventListener('input',()=>{draft=field.value;});
      const submit=button(busy?'처리 중…':'보내기',()=>{});submit.type='submit';submit.disabled=busy;
      form.addEventListener('submit',event=>{event.preventDefault();if(!busy)void sendMessage(field.value);});
      form.append(field,submit);root.append(form);
    }
    const actions=el('div','phone-messages-controls');
    if(current.conversationId) actions.append(button('대화 보관',()=>{if(!busy)void archiveConversation();}));
    if(!current.blockedByMe && current.other.available!==false) {
      actions.append(button(pendingRecipient===current.other.userId?'차단 확정':'사용자 차단',()=>{
        if(busy)return;
        if(pendingRecipient!==current.other.userId){pendingRecipient=current.other.userId;notice='차단하면 친구·쪽지 기능도 제한돼요. 한 번 더 눌러 확정하세요.';render();}
        else void blockRecipient();
      }));
    }
    root.append(actions);
  }
  async function loadInbox({ recipientId=null, selectUserId=null } = {}) {
    if(!active || !accountId)return;
    const ticket=++epoch;view='inbox';current=null;thread=[];notice='';busy=true;render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const result=await model.list(50);if(!safe(ticket))return;
      if(result.outcome!=='READY'){notice=phoneMessageErrorText(result.code);return;}
      inbox=result.conversations;notify(result.unreadCount);
      const chosen=selectUserId || recipientId;
      if(chosen) {
        const existing=inbox.find(x=>x.other.userId===chosen);
        if(existing){busy=false;await openConversation(existing);return;}
        if(recipientId){busy=false;await startConversation(recipientId);return;}
      }
    } catch {if(safe(ticket))notice='메시지함을 불러오지 못했어요.';}
    finally {if(safe(ticket)){busy=false;render();}}
  }
  async function startConversation(userId) {
    if(!active || !accountId || busy)return;
    const ticket=++epoch;busy=true;notice='사용자 확인 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const existing=model.conversations.find(x=>x.other.userId===userId);
      if(existing){busy=false;await openConversation(existing);return;}
      const result=await model.recipient(userId);if(!safe(ticket))return;
      if(result.outcome!=='READY'){notice=phoneMessageErrorText(result.code);return;}
      current={conversationId:null,other:result.recipient,blockedByMe:result.recipient.relationship==='blocked_by_me'};
      thread=[];draft='';view='draft';notice='새 대화는 서버에서 인하대 이메일 인증 여부를 확인해요.';
    } catch {if(safe(ticket))notice='사용자를 확인하지 못했어요.';}
    finally{if(safe(ticket)){busy=false;render();}}
  }
  async function openConversation(item) {
    if(!active || !accountId || busy)return;
    const ticket=++epoch;view='thread';current=item;thread=[];draft='';notice='대화 불러오는 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const result=await model.thread(item.conversationId,100,null);if(!safe(ticket))return;
      if(result.outcome!=='READY'){notice=phoneMessageErrorText(result.code);return;}
      thread=result.thread.messages;notice='';
      const read=await model.markRead(item.conversationId);if(!safe(ticket))return;
      if(read.outcome==='SUCCESS')notify(model.unreadCount);
      else if(read.outcome!=='STALE')notice='읽음 처리를 완료하지 못했어요.';
    } catch {if(safe(ticket))notice='대화를 불러오지 못했어요.';}
    finally{if(safe(ticket))render();}
  }
  async function sendMessage(body) {
    if(!active || !accountId || busy || !current)return;
    draft=String(body).trim();
    if(!draft || draft.length>1000){notice=phoneMessageErrorText('INVALID_MESSAGE');render();return;}
    const ticket=++epoch,target=current.other.userId;busy=true;notice='전송 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const result=await model.send(target,draft);if(!safe(ticket))return;
      if(result.outcome!=='SUCCESS'){notice=phoneMessageErrorText(result.code);return;}
      draft='';busy=false;await loadInbox({selectUserId:target});
    } catch {if(safe(ticket))notice='전송 결과를 확인하지 못했어요. 재전송 전에 쪽지함을 확인해 주세요.';}
    finally{if(safe(ticket)){busy=false;render();}}
  }
  async function mutation(kind,id,other=null) {
    if(!active||!accountId||busy||!current)return;
    const ticket=++epoch;busy=true;notice='요청 처리 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const result=kind==='archive' ? await model.archive(id) :
        kind==='block' ? await model.block(id) : await model.report(id,other);
      if(!safe(ticket))return;
      if(result.outcome!=='SUCCESS'){notice=phoneMessageErrorText(result.code);return;}
      if(kind==='archive'){busy=false;await loadInbox();return;}
      if(kind==='block'){current={...current,blockedByMe:true};pendingRecipient=null;}
      notice=kind==='block'?'사용자를 차단했어요.':'신고가 접수됐어요.';
    } catch {if(safe(ticket))notice='처리 결과를 확인하지 못했어요. 다시 수행하기 전 상태를 확인해 주세요.';}
    finally{if(safe(ticket)){busy=false;render();}}
  }
  const archiveConversation=()=>mutation('archive',current?.conversationId);
  const blockRecipient=()=>mutation('block',current?.other?.userId);
  const reportMessage=(id,category)=>mutation('report',id,category);
  function setAccount(id) {
    const next=typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)?id:null;
    if(accountId===next)return;
    accountId=next;epoch++;client?.setAccount(next);
    inbox=[];thread=[];current=null;draft='';view='inbox';busy=false;notice='';pendingRecipient=null;notify(0);
    if(active){render();if(next)void loadInbox();}
    else if(next)void refreshUnread();
  }
  async function refreshUnread() {
    if(!accountId)return false;
    const ticket=epoch;
    try {
      const model=await getModel();if(ticket!==epoch)return false;
      const result=await model.refreshUnread();
      if(ticket!==epoch || result.outcome!=='READY')return false;
      notify(result.unreadCount);return true;
    } catch{return false;}
  }
  function activate(params={}) {
    active=true;epoch++;view='inbox';current=null;thread=[];draft='';notice='';pendingRecipient=null;
    if(typeof params.recipientId==='string')pendingRecipient=params.recipientId;
  }
  function mount(node) {
    host=node;render();
    if(accountId)void loadInbox({recipientId:pendingRecipient});
    pendingRecipient=null;
  }
  function close() {epoch++;active=false;busy=false;current=null;thread=[];draft='';host=null;pendingRecipient=null;}
  return Object.freeze({activate,mount,close,setAccount,refreshUnread,
    get available(){return true;},
    status:()=>({active,view,accountId,unreadCount:unread,conversationCount:inbox.length})
  });
}
