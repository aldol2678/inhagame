// Social S1-D1.3 · Lobby '내 방' doorway.
// Persistent room ownership is resolved before entering the reusable DORM_1_BASIC scene.

import { DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_MY_ROOM_RETURN } from "./dorm1-lobby-layout.js";
import { PersonalRoomError } from "./personal-room-client.js";

export const PERSONAL_ROOM_CONTEXT_PRIORITY=150;
const flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

export function createPersonalRoomInteraction({
  client,rooms,onStatus=()=>{},getSpace=()=>rooms?.currentSpace,
  onOpeningChange=()=>{},timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout
}={}){
  let opening=null;
  function release(attempt){
    if(opening!==attempt)return !attempt.releaseError;
    clearTimer(attempt.timer);
    opening=null;
    try{onOpeningChange({active:false,onCancel:null});return true;}
    catch(error){
      attempt.releaseError=error;
      try{onStatus("입력 상태를 복구하지 못했어요. 새로고침해 주세요.");}catch{/* Keep cleanup bounded. */}
      return false;
    }
  }
  function stop(attempt,{timedOut=false}={}){
    if(opening!==attempt)return false;
    attempt.stopped=true;
    attempt.resolveStop(null);
    // A timed-out ensure() otherwise retains its inFlight promise forever. Invalidate
    // only this attempt's generation so retry can make a fresh idempotent read/create RPC.
    if(timedOut&&client.generation===attempt.generation)client.reset?.();
    release(attempt);
    if(timedOut)onStatus("개인방을 불러오는 데 시간이 오래 걸려요. 다시 시도해 주세요.");
    return true;
  }
  function cancelOpen(){return opening?stop(opening):false;}
  const messageFor=error=>{
    if(error?.code==="SIGNED_OUT"||error?.code==="PERMANENT_ACCOUNT_REQUIRED")return "INHAGAME에 로그인하면 내 방을 사용할 수 있어요.";
    if(error?.code==="ACCOUNT_UNAVAILABLE")return "현재 계정으로는 개인방을 사용할 수 없어요.";
    return "개인방을 불러오지 못했어요.";
  };
  async function open(){
    if(opening||getSpace()!=="ROOM_DORM1_LOBBY"||rooms.status?.().busy===true)return false;
    const attempt={timer:null,stopped:false,resolveStop:null};
    const stopped=new Promise(resolve=>{attempt.resolveStop=resolve;});
    opening=attempt;
    try{
      const generation=client.generation;
      attempt.generation=generation;
      const sourceSpace=getSpace();
      onOpeningChange({active:true,onCancel:()=>stop(attempt)});
      if(attempt.stopped)return false;
      attempt.timer=setTimer(()=>stop(attempt,{timedOut:true}),timeoutMs);
      const authority=await Promise.race([client.ensure(),stopped]);
      if(attempt.stopped||opening!==attempt||getSpace()!==sourceSpace||
        client.generation!==generation||client.getSelfUserId?.()!==authority.ownerUserId)
        return false;
      // The transition claims the same loading/input owner synchronously.
      // Release our claim first; stale completions must never release its claim.
      if(!release(attempt))return false;
      if(getSpace()!==sourceSpace||client.generation!==generation||
        client.getSelfUserId?.()!==authority.ownerUserId)return false;
      const ok=rooms.enterNested("ROOM_PERSONAL_BASIC",{
        fromRoomId:"ROOM_DORM1_LOBBY",
        returnPosition:DORM_1_LOBBY_MY_ROOM_RETURN.position,
        returnYaw:DORM_1_LOBBY_MY_ROOM_RETURN.yaw,
        metadata:{personalRoomId:authority.roomId,ownerUserId:authority.ownerUserId,visitRole:"owner",visibility:authority.visibility},
        isValid:()=>client.generation===generation&&client.getSelfUserId?.()===authority.ownerUserId
      });
      if(!ok)onStatus("지금은 내 방으로 들어갈 수 없어요.");
      return ok;
    }catch(error){
      if(!attempt.stopped)onStatus(messageFor(error instanceof PersonalRoomError?error:new PersonalRoomError("FAILED")));
      return false;
    }finally{release(attempt);}
  }
  function contextAction({position,grounded=true,mounted=false}={}){
    if(getSpace()!=="ROOM_DORM1_LOBBY"||!position||!grounded||mounted)return null;
    const distance=flat(position,DORM_1_LOBBY_MY_ROOM.position);
    if(distance>DORM_1_LOBBY_MY_ROOM.radius)return null;
    return {
      id:"personal-room-door",icon:"🚪",label:"내 방 들어가기",
      priority:PERSONAL_ROOM_CONTEXT_PRIORITY,distance,pressed:false,
      trigger:()=>{void open();return true;}
    };
  }
  return {contextAction,open,cancelOpen,get opening(){return opening!==null;}};
}

