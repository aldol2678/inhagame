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
  // Keep unresolved writes across Close and A→B→A. No storage, RPC replay or account leakage.
  const sends = new Map();
  const sendKey = (owner, recipient) => owner + ':' + recipient;
  const currentSend = () => current && sends.get(sendKey(accountId, current.other.userId));
  const sendBlocked = body => {const held=currentSend();return held &&
    (held.state!=='observed' || !String(body||'').trim() || String(body).trim()===held.body);};
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
      const refresh=button(busy?'불러오는 중…':'새로고침',()=>{if(!busy)void loadInbox();});refresh.disabled=busy;controls.append(refresh);
      const count=el('span','phone-messages-unread',unread ? '읽지 않음 '+unread+'개' : '읽지 않은 메시지 없음');
      controls.append(count);root.append(controls);
      const form=el('form','phone-messages-new');
      const entry=el('input');entry.type='text';entry.maxLength=36;entry.placeholder='상대방 사용자 ID';entry.setAttribute('aria-label','새 쪽지 받을 사용자 ID');
      const start=button('새 대화',()=>{});start.type='submit';start.disabled=busy;
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
      field.addEventListener('input',()=>{draft=field.value;submit.disabled=busy||Boolean(sendBlocked(draft));});
      const held=currentSend();
      const submit=button(busy?'처리 중…':'보내기',()=>{});submit.type='submit';submit.disabled=busy||Boolean(sendBlocked(draft));
      form.addEventListener('submit',event=>{event.preventDefault();if(!busy)void sendMessage(field.value);});
      form.append(field,submit);root.append(form);
      if(held) {
        const text=held.state==='pending'?'이전 전송 결과를 기다리고 있어요. 자동으로 다시 보내지 않아요.':
          held.state==='observed'?'같은 내용의 새 쪽지가 확인됐어요. 같은 내용 재전송은 잠갔어요. 다른 내용의 새 쪽지는 보낼 수 있어요.':
          '전송됐을 수도 있어요. 최신 대화를 확인하기 전에는 다시 보낼 수 없어요.';
        root.append(el('p','phone-messages-notice',text));
        if(held.state!=='pending' && held.state!=='observed') {
          const check=button('최신 대화 확인',()=>{if(!busy)void checkUncertainSend();});check.disabled=busy;root.append(check);
          if(held.state==='checked') {
            root.append(el('p','phone-messages-notice','조회만으로 미전송을 확정할 수 없어요. 다시 보내면 중복될 수 있어요.'));
            const retry=button('중복 가능성 확인 · 재시도 허용',()=>{
              if(busy||currentSend()!==held||held.state!=='checked')return;
              sends.delete(sendKey(accountId,current.other.userId));draft=held.body;
              notice='내용을 확인한 뒤 보내기를 눌러 주세요.';render();
            });root.append(retry);
          }
        }
      }
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
    const ticket=++epoch;view='thread';current=item;thread=[];draft='';busy=true;notice='대화 불러오는 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const result=await model.thread(item.conversationId,100,null);if(!safe(ticket))return;
      if(result.outcome!=='READY'){notice=phoneMessageErrorText(result.code);return;}
      thread=result.thread.messages;notice='';
      const read=await model.markRead(item.conversationId);if(!safe(ticket))return;
      if(read.outcome==='SUCCESS')notify(model.unreadCount);
      else if(read.outcome!=='STALE')notice='읽음 처리를 완료하지 못했어요.';
    } catch {if(safe(ticket))notice='대화를 불러오지 못했어요.';}
    finally{if(safe(ticket)){busy=false;render();}}
  }
  async function sendMessage(body) {
    if(!active || !accountId || busy || !current || sendBlocked(body))return;
    draft=String(body).trim();
    if(!draft || draft.length>1000){notice=phoneMessageErrorText('INVALID_MESSAGE');render();return;}
    const ticket=++epoch,target=current.other.userId,owner=accountId,key=sendKey(owner,target);
    const attempt={state:'pending',body:draft,owner,target,startedAt:Date.now(),
      conversationId:current.conversationId,knownIds:new Set(thread.map(message=>message.id))};
    sends.set(key,attempt);busy=true;notice='전송 중…';render();
    try {
      const model=await getModel();if(!safe(ticket)){attempt.state='uncertain';return;}
      const result=await model.send(target,attempt.body);
      // Even a hidden or previous-account request must settle its own lock.
      const receipt=result.data;
      const confirmed=result.outcome==='SUCCESS' && typeof receipt?.messageId==='string' && receipt.messageId.length>0 &&
        typeof receipt.conversationId==='string' && receipt.conversationId.length>0 &&
        (!attempt.conversationId || receipt.conversationId===attempt.conversationId) &&
        receipt.senderId===owner && receipt.body===attempt.body && Number.isFinite(Date.parse(receipt.createdAt));
      if(confirmed)sends.delete(key);
      else if(result.outcome==='FAILED' && result.code && result.code!=='FAILED')sends.delete(key);
      else attempt.state='uncertain';
      if(!safe(ticket))return;
      if(!confirmed){
        notice=sends.has(key)?'전송 상태를 확인하지 못했어요. 최신 대화를 확인해 주세요.':phoneMessageErrorText(result.code);return;
      }
      draft='';busy=false;await loadInbox({selectUserId:target});
    } catch {attempt.state='uncertain';if(safe(ticket))notice='전송 결과를 확인하지 못했어요. 최신 대화를 확인해 주세요.';}
    finally{if(safe(ticket)){busy=false;render();}else if(active && accountId===owner && current?.other.userId===target)render();}
  }
  async function checkUncertainSend() {
    const attempt=currentSend();
    if(!active||!attempt||busy||attempt.state==='pending'||attempt.state==='observed')return;
    const ticket=++epoch;busy=true;attempt.state='uncertain';notice='최신 대화 확인 중…';render();
    try {
      const model=await getModel();if(!safe(ticket))return;
      const listing=await model.list(100);if(!safe(ticket))return;
      if(listing.outcome!=='READY')throw Error('Readback unavailable');
      const item=listing.conversations.find(value=>value.other.userId===attempt.target);
      const conversationId=item?.conversationId||attempt.conversationId;
      let messages=[];
      if(conversationId) {
        const result=await model.thread(conversationId,100,null);if(!safe(ticket))return;
        if(result.outcome!=='READY')throw Error('Readback unavailable');
        messages=result.thread.messages;
      }
      if(item){current=item;view='thread';thread=messages;}
      // A new server ID, sender, target thread, time and body are evidence, not an idempotency receipt.
      // A second device could send identical text; conservatively suppress replay instead of claiming exact success.
      const observed=messages.some(message=>!message.deleted && message.senderId===attempt.owner &&
        !attempt.knownIds.has(message.id) && message.body===attempt.body &&
        Number.isFinite(Date.parse(message.createdAt)) && Date.parse(message.createdAt)>=attempt.startedAt-5000 &&
        Date.parse(message.createdAt)<=Date.now()+5000);
      attempt.state=observed?'observed':'checked';
      notice=observed?'새 쪽지를 대화에서 확인해 주세요. 자동 재전송은 하지 않았어요.':
        '최신 대화를 불러왔어요. 전송 여부를 확인한 뒤 재시도를 결정해 주세요.';
    } catch {if(safe(ticket))notice='최신 대화를 확인하지 못했어요. 재전송 잠금을 유지해요.';}
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
  // NOTI-01C: reuse the existing server-validated conversation list for an on-demand read-only activity snapshot.
  // This is NOT a durable notification ledger. Never persist messages or infer unread/read receipts.
  async function readActivity(limit=20) {
    const owner=accountId, ticket=epoch;
    if(!owner)return {outcome:'SIGNED_OUT'};
    try {
      const model=await getModel();
      if(ticket!==epoch||accountId!==owner)return {outcome:'STALE'};
      const result=await model.list(Math.max(1,Math.min(20,Number(limit)||20)));
      if(ticket!==epoch||accountId!==owner)return {outcome:'STALE'};
      if(result.outcome!=='READY')return {outcome:'FAILED'};
      // This 20-conversation projection is partial: never overwrite the full server unread badge.
      return {outcome:'READY',accountId:owner,conversations:result.conversations};
    } catch {return ticket===epoch&&accountId===owner?{outcome:'FAILED'}:{outcome:'STALE'};}
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
  return Object.freeze({activate,mount,close,setAccount,refreshUnread,readActivity,
    get available(){return true;},
    status:()=>({active,view,accountId,busy,unreadCount:unread,conversationCount:inbox.length})
  });
}
