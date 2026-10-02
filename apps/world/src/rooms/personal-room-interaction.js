// Social S1-D1.3 · Lobby '내 방' doorway.
// Persistent room ownership is resolved before entering the reusable DORM_1_BASIC scene.

import { DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_MY_ROOM_RETURN } from "./dorm1-lobby-layout.js";
import { PersonalRoomError } from "./personal-room-client.js";

export const PERSONAL_ROOM_CONTEXT_PRIORITY=150;
const flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

export function createPersonalRoomInteraction({
  client,rooms,onStatus=()=>{},getSpace=()=>rooms?.currentSpace
}={}){
  let opening=false;
  const messageFor=error=>{
    if(error?.code==="SIGNED_OUT"||error?.code==="PERMANENT_ACCOUNT_REQUIRED")return "INHAGAME에 로그인하면 내 방을 사용할 수 있어요.";
    if(error?.code==="ACCOUNT_UNAVAILABLE")return "현재 계정으로는 개인방을 사용할 수 없어요.";
    return "개인방을 불러오지 못했어요.";
  };
  async function open(){
    if(opening)return false;
    opening=true;
    try{
      const generation=client.generation;
      const authority=await client.ensure();
      if(client.generation!==generation||client.getSelfUserId?.()!==authority.ownerUserId)
        return false;
      const ok=rooms.enterNested("ROOM_PERSONAL_BASIC",{
        fromRoomId:"ROOM_DORM1_LOBBY",
        returnPosition:DORM_1_LOBBY_MY_ROOM_RETURN.position,
        returnYaw:DORM_1_LOBBY_MY_ROOM_RETURN.yaw,
        metadata:{personalRoomId:authority.roomId},
        isValid:()=>client.generation===generation&&client.getSelfUserId?.()===authority.ownerUserId
      });
      if(!ok)onStatus("지금은 내 방으로 들어갈 수 없어요.");
      return ok;
    }catch(error){
      onStatus(messageFor(error instanceof PersonalRoomError?error:new PersonalRoomError("FAILED")));
      return false;
    }finally{opening=false;}
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
  return {contextAction,open,get opening(){return opening;}};
}
