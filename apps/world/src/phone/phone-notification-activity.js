// NOTI-01C-A: server-confirmed recent activity projection. Not a persistent notification ledger.
// Source authority remains the existing Hub Messages and World Social RPCs.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid=id=>typeof id==='string'&&UUID.test(id);
const nick=value=>typeof value==='string'&&value.trim()?value.trim().slice(0,24):'인하월드 사용자';
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export function projectServerActivity({accountId,conversations=[],incoming=[]}={}) {
  if(!isUuid(accountId))return [];
  const events=[];
  if(Array.isArray(incoming))for(const person of incoming.slice(0,20)) {
    if(!isUuid(person?.userId)||person.userId===accountId)continue;
    events.push({
      id:'friend:'+person.userId,group:'friends',icon:'🤝',title:nick(person.nickname)+'님의 친구 요청',
      detail:'현재 받은 친구 요청 목록에 있어요.',action:'친구 요청 보기',appId:'friends',
      params:{},createdAt:null,unread:false
    });
  }
  if(Array.isArray(conversations))for(const item of conversations.slice(0,20)) {
    if(!isUuid(item?.other?.userId)||item.other.userId===accountId||
        typeof item?.conversationId!=='string'||item.conversationId.length>100||
        item.blockedByMe===true)continue;
    const createdAt=timestamp(item.lastMessage?.createdAt)||timestamp(item.updatedAt);
    if(!createdAt)continue;
    const unread=Number.isSafeInteger(item.unreadCount)&&item.unreadCount>0;
    const name=nick(item.other.nickname);
    events.push({
      id:'conversation:'+item.conversationId,group:'messages',icon:'💬',
      title:name+'님과의 최근 대화',
      detail:unread?'읽지 않은 메시지가 있어요.':'서버에서 확인된 최근 대화예요.',
      action:'대화 열기',appId:'messages',params:{recipientId:item.other.userId},
      createdAt,unread
    });
  }
  const unique=new Set();
  return events.filter(item=>{
    if(unique.has(item.id))return false;unique.add(item.id);return true;
  }).sort((a,b)=>a.group==='friends'&&b.group!=='friends'?-1:b.group==='friends'&&a.group!=='friends'?1:
    (Date.parse(b.createdAt??'')||0)-(Date.parse(a.createdAt??'')||0)).slice(0,40);
}
