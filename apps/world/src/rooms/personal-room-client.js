// Social S1-D1.3 · account-bound personal room client.
// Ownership authority lives in get_or_create_my_personal_room_v1(); the browser never sends a user id.

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_TYPES=new Set(["DORM_1_BASIC"]);
const VISIBILITY=new Set(["private","friends"]);
const KNOWN_ERRORS=new Set(["PERMANENT_ACCOUNT_REQUIRED","ACCOUNT_UNAVAILABLE"]);

export class PersonalRoomError extends Error {
  constructor(code){super(code);this.code=code;}
}
const isUuid=value=>typeof value==="string"&&UUID.test(value);

export function parsePersonalRoom(raw){
  if(!raw||typeof raw!=="object"||!isUuid(raw.roomId)||!isUuid(raw.ownerUserId))return null;
  if(!ROOM_TYPES.has(raw.roomType)||!VISIBILITY.has(raw.visibility))return null;
  return Object.freeze({
    roomId:raw.roomId,
    ownerUserId:raw.ownerUserId,
    roomType:raw.roomType,
    visibility:raw.visibility,
    createdAt:typeof raw.createdAt==="string"?raw.createdAt:null,
    updatedAt:typeof raw.updatedAt==="string"?raw.updatedAt:null
  });
}

export class PersonalRoomClient{
  constructor({getClient,getSelfUserId}){
    this.getClient=getClient;
    this.getSelfUserId=getSelfUserId;
    this.inFlight=null;
    this.cached=null;
    this.cachedUserId=null;
    this.generation=0;
  }
  get available(){
    return !!this.getClient?.()&&isUuid(this.getSelfUserId?.());
  }
  reset(){this.generation++;this.inFlight=null;this.cached=null;this.cachedUserId=null;}
  async ensure(){
    const userId=this.getSelfUserId?.();
    const client=this.getClient?.();
    if(!client||!isUuid(userId))throw new PersonalRoomError("SIGNED_OUT");
    if(this.cached&&this.cachedUserId===userId)return this.cached;
    if(this.cachedUserId&&this.cachedUserId!==userId)this.reset();
    if(this.inFlight)return this.inFlight;
    const generation=this.generation;
    const request=(async()=>{
      const {data,error}=await client.rpc("get_or_create_my_personal_room_v1",{});
      if(this.generation!==generation||this.getSelfUserId?.()!==userId)
        throw new PersonalRoomError("SIGNED_OUT");
      if(error){
        const code=String(error.message??"").trim();
        throw new PersonalRoomError(KNOWN_ERRORS.has(code)?code:"FAILED");
      }
      const room=parsePersonalRoom(data);
      if(!room||room.ownerUserId!==userId)throw new PersonalRoomError("FAILED");
      this.cached=room;
      this.cachedUserId=userId;
      return room;
    })().finally(()=>{if(this.inFlight===request)this.inFlight=null;});
    this.inFlight=request;
    return this.inFlight;
  }
}
