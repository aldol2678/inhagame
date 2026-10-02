import { createHumanAvatar } from "../../../npc-factory/dev-human-avatar.mjs";
import { metersToWorld } from "../../world-scale.js";
import { MCM_2026_MINIGAME_POINTS, MCM_2026_ROOM_ID } from "./minigame-room-layout.js";
import { MCM_2026_PHASE } from "./event-phase.js";

const ACTOR_IDS=Object.freeze(["ZUE-MG-001","ZUE-MG-002","ZUE-MG-003","ZUE-MG-004","ZUE-MG-005"]);
const RADIUS=metersToWorld(3);
const APPEARANCES=Object.freeze([
  {height:.98,presentation:"female",skin_tone:0,skin_color_override:"#a3a690",hair_style:"ponytail",hair_color:"#29262a",outfit_style:"hoodie",outfit_color:"#4f5d74",accent_color:"#b85a72",accessory:"backpack"},
  {height:1.02,presentation:"male",skin_tone:1,skin_color_override:"#9da68d",hair_style:"short",hair_color:"#272729",outfit_style:"jacket",outfit_color:"#5b4650",accent_color:"#a9435f",accessory:"messenger"},
  {height:1,presentation:"female",skin_tone:2,skin_color_override:"#96a58a",hair_style:"bob",hair_color:"#30272b",outfit_style:"sweater",outfit_color:"#596b65",accent_color:"#b24b65",accessory:"scarf"},
  {height:1.03,presentation:"male",skin_tone:0,skin_color_override:"#9aa890",hair_style:"sidepart",hair_color:"#262426",outfit_style:"shirt",outfit_color:"#665665",accent_color:"#c64d6a",accessory:"glasses"},
  {height:.97,presentation:"female",skin_tone:1,skin_color_override:"#91a181",hair_style:"bun",hair_color:"#2b292d",outfit_style:"cardigan",outfit_color:"#655b4b",accent_color:"#c6834c",accessory:"headphones"}
]);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

function ensureStyle(doc){
  if(doc.getElementById("mcm26-minigame-style"))return;
  const style=doc.createElement("style");style.id="mcm26-minigame-style";style.textContent=`
    .mcm26-game-hud{position:fixed;left:50%;top:calc(76px + env(safe-area-inset-top));transform:translateX(-50%);z-index:66;background:#17161bdc;color:#fff;border:1px solid #ffffff25;border-radius:13px;padding:9px 13px;font:800 13px system-ui;box-shadow:0 8px 30px #0007}
    .mcm26-game-hud[hidden],.mcm26-game-toast[hidden]{display:none!important}
    .mcm26-game-toast{position:fixed;left:50%;bottom:calc(100px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:140;max-width:calc(100vw - 28px);background:#121419f2;color:white;border:1px solid #ffffff28;border-radius:12px;padding:10px 14px;font:800 13px system-ui;box-shadow:0 12px 36px #0007}
  `;doc.head.appendChild(style);
}
const actor=(id,index)=>({id,name:"수상한 학생",position:{...MCM_2026_MINIGAME_POINTS[index]}});

export function createMcm2026MinigameRuntime({
  roomScene,player,client,getRoomId=()=>null,onInfo=()=>{},onReward=()=>{},doc=globalThis.document
}={}){
  if(!roomScene?.root||!player||!client||!doc?.body)throw Error("MCM_MINIGAME_RUNTIME_REQUIRED");
  ensureStyle(doc);
  const actors=ACTOR_IDS.map(actor);
  const visuals=new Map(actors.map((a,index)=>{
    const v=createHumanAvatar(roomScene.root,a,APPEARANCES[index]);
    v.avatar.setLocalPosition(a.position.x,0,a.position.z);v.avatar.enabled=false;v.marker.enabled=false;
    return [a.id,v];
  }));
  const hud=doc.createElement("div");hud.className="mcm26-game-hud";hud.hidden=true;hud.setAttribute("role","status");
  const toast=doc.createElement("div");toast.className="mcm26-game-toast";toast.hidden=true;doc.body.append(hud,toast);
  let run=null,busy=false,activeLast=false,timer=null,elapsed=0,settlementPending=false,introShown=false;
  const active=()=>getRoomId()===MCM_2026_ROOM_ID;
  const say=(text,ms=2600)=>{toast.textContent=text;toast.hidden=false;clearTimeout(timer);timer=setTimeout(()=>{toast.hidden=true;},ms);};
  const nearest=()=>{
    const p=player.getLocalPosition();
    return actors.map(a=>({actor:a,distance:dist(p,a.position)})).sort((a,b)=>a.distance-b.distance)[0]??null;
  };
  const setVisible=value=>{for(const visual of visuals.values())visual.avatar.enabled=value;};

  async function start(){
    if(!active()||busy)return false;
    // New runs need the server window open. The server refuses anyway; this only explains why.
    if(client.state?.eventState!=="ACTIVE"){say("이벤트가 종료되어 새 도전을 시작할 수 없어요.");return false;}
    busy=true;
    try{
      run=await client.startRun();
      if(!run)return false;
      say(client.preview?"🧪 QA PREVIEW · 실제 기록/보상 없이 45초 미니게임을 확인합니다.":"🧟 45초 안에 인간을 찾아 F로 말을 거세요.");
      return true;
    }catch{say("미니게임을 시작하지 못했어요. 연결을 확인해 주세요.");return false;}
    finally{busy=false;}
  }
  async function settleClear(){
    if(busy)return false;
    settlementPending=false;
    try{
      const landlord=await client.claimLandlord();onReward(landlord);
      if(landlord?.status==="REWARD_FAILED")settlementPending=true;
      await client.refresh().catch(()=>null);
      if(client.state?.progress?.stage==="COMPLETED"){
        const main=await client.claimMain();onReward(main);
        if(main?.status==="REWARD_FAILED")settlementPending=true;
      }
      return !settlementPending;
    }catch{
      settlementPending=true;
      say("클리어는 기록됐지만 보상 정산에 실패했어요. F로 다시 시도할 수 있습니다.",3600);
      return false;
    }
  }
  async function talk(actorId){
    if(!run||run.status!=="ACTIVE"||busy)return false;
    busy=true;
    try{
      const result=await client.submitRun(run.runId,actorId);
      run={...run,...result};
      if(result.status==="CLEARED"){
        settlementPending=true;
        say("🎉 생존자 발견! 서버에 CLEAR가 기록됐습니다.",3200);
        busy=false;
        await settleClear();
      }else if(result.status==="FAILED"){
        say("🧟 시간이 다 됐습니다. 다시 도전할 수 있어요.",3000);
      }else if(result.correct===false){
        const left=Math.ceil(client.remainingMs(result.deadlineAt)/1000);
        say(`🧟 좀비였다! -5초 · 남은 시간 ${left}초`);
      }
      return true;
    }catch{say("선택을 확인하지 못했어요. 다시 시도해 주세요.");return false;}
    finally{busy=false;}
  }
  function contextAction(){
    if(!active())return null;
    if(!run||run.status==="FAILED")return {id:"mcm-minigame-start",icon:run?"↻":"🎮",
      label:run?"다시 도전":"인간 찾기 시작",priority:310,trigger:()=>{void start();return true;}};
    if(run.status==="CLEARED"&&settlementPending)return {id:"mcm-minigame-settle",icon:"🎁",label:"보상 정산 다시 시도",priority:310,trigger:()=>{void settleClear();return true;}};
    if(run.status==="CLEARED")return {id:"mcm-minigame-info",icon:"🧟",label:"행사 정보 보기",priority:140,trigger:()=>{onInfo();return true;}};
    const target=nearest();
    if(!target||target.distance>RADIUS)return null;
    return {id:"mcm-minigame-talk",icon:"💬",label:"수상한 학생에게 말 걸기",priority:310,distance:target.distance,
      trigger:()=>{void talk(target.actor.id);return true;}};
  }
  function update(dt){
    elapsed+=Math.min(dt??0,.05);
    const nowActive=active();
    if(nowActive!==activeLast){
      activeLast=nowActive;setVisible(nowActive);
      if(nowActive){
        const activeRun=client.state?.landlord?.activeRun;
        const clearedAt=client.state?.landlord?.firstClearedAt;
        run=activeRun?{...activeRun,status:"ACTIVE"}:clearedAt?{runId:null,status:"CLEARED",wrongCount:0}:null;
        settlementPending=Boolean(clearedAt);
        // A short opening line on the first entry of the session only.
        const intro=introShown?"👤 「좀비를 피해 인간을 찾아라」 · F로 시작":"👤 이 중 인간은 단 한 명입니다. · F로 시작";
        introShown=true;
        say(clearedAt?"🎉 첫 클리어 기록이 있어요. 보상 정산을 확인할 수 있습니다.":intro,3200);
      }else{hud.hidden=true;toast.hidden=true;run=null;}
    }
    if(!nowActive)return;
    actors.forEach((a,index)=>{
      const visual=visuals.get(a.id);
      const sway=Math.sin(elapsed*1.7+index)*5;
      visual.avatar.setLocalEulerAngles(0,index*72+sway,0);
      visual.arms[0]?.setLocalEulerAngles(Math.sin(elapsed*2+index)*8,0,0);
      visual.arms[1]?.setLocalEulerAngles(-Math.sin(elapsed*2+index)*8,0,0);
    });
    if(run?.status==="ACTIVE"){
      const remaining=client.remainingMs(run.deadlineAt);
      hud.textContent=`🧟 인간을 찾아라 · ${Math.ceil(remaining/1000)}초 · 실수 ${run.wrongCount??0}회`;
      if(remaining<=0&&!busy){
        // Display-only timeout. The server is still the authority; the next submit/start resolves it.
        hud.textContent="🧟 시간 확인 중 · F로 다시 시도";
      }
    }else if(run?.status==="CLEARED")hud.textContent="🎉 생존자 발견 · CLEAR";
    else if(run?.status==="FAILED")hud.textContent="🧟 TIME OVER · 다시 도전 가능";
    else hud.textContent=`${client.phase?.()===MCM_2026_PHASE.ONSITE_LIVE?"🔴 LIVE · ":""}👤 좀비를 피해 인간을 찾아라 · 45초`;
    hud.hidden=false;
  }
  return Object.freeze({
    update,contextAction,start,
    status:()=>({active:active(),run:run?{runId:run.runId,status:run.status,deadlineAt:run.deadlineAt,wrongCount:run.wrongCount}:null,busy}),
    destroy(){clearTimeout(timer);hud.remove();toast.remove();for(const v of visuals.values())v.avatar.destroy();}
  });
}
