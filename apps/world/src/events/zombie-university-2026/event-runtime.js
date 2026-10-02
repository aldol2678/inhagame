import * as pc from "playcanvas";
import { createHumanAvatar } from "../../../npc-factory/dev-human-avatar.mjs";
import { npcNameplateOffset } from "../../../npc-factory/npc-dimensions.mjs";
import { formatQuestGuidance } from "../../../npc-factory/quest-guidance.mjs";
import { metersToWorld } from "../../world-scale.js";
import {
  MCM_2026_EVENT_STATE,
  MCM_2026_INVESTIGATION_ACTIONS,
  MCM_2026_INVESTIGATION_KEYS,
  MCM_2026_NPC_IDS,
  MCM_2026_PROGRESS_STAGE,
  MCM_2026_TEASER_LINES
} from "./event-data.js";
import { MCM_2026_ROUTE } from "./event-route.js";
import {
  MCM_2026_PHASE,
  MCM_2026_TALK,
  formatMcm2026Countdown,
  isMcm2026PlayablePhase,
  mcm2026ActorVisible,
  mcm2026MsUntilOutbreak,
  mcm2026TalkMode
} from "./event-phase.js";

const TALK_RADIUS=metersToWorld(3);
const LABEL_RADIUS=metersToWorld(8);
const ACTORS=Object.freeze([
  Object.freeze({id:MCM_2026_NPC_IDS.GUIDE,name:"문콘경 생존대원",position:MCM_2026_ROUTE.guide,
    dialogue:["후문 건너 문화의거리 쪽에서 이상현상이 확인되고 있어요.","수상한 학생 세 명과 직접 이야기해 보고 상태를 확인해 주세요."]}),
  Object.freeze({id:MCM_2026_NPC_IDS.STAGGERING,name:"비틀거리는 좀비",position:MCM_2026_ROUTE.staggering,
    dialogue:["나 멀쩡해... 길이 두 개로 보일 뿐이야...","건물주... 어디였더라... 문화의거리 안쪽이었나..."]}),
  Object.freeze({id:MCM_2026_NPC_IDS.DANCING,name:"춤추는 좀비",position:MCM_2026_ROUTE.dancing,
    dialogue:["23시... 댄스 타임... 아직 멀었나...?","멈추려고 했는데 몸이 말을 안 들어..."]}),
  Object.freeze({id:MCM_2026_NPC_IDS.HUNGRY,name:"배고픈 좀비",position:MCM_2026_ROUTE.hungry,
    dialogue:["식량... 필요해... 건물주 쪽에 있다고 들었어...","무료 식량... 게임... 이 길 안쪽으로 계속 가면 돼..."]})
]);
const LIVE_GUIDE_LINE="지금 건물주에서 좀비대학교 LIVE 행사가 진행 중이에요! 게임 속 조사는 현장 참여와 상관없이 그대로 할 수 있어요.";
const APPEARANCE=Object.freeze({
  [MCM_2026_NPC_IDS.GUIDE]:{height:1,presentation:"female",skin_tone:1,hair_style:"ponytail",hair_color:"#29242c",outfit_style:"jacket",outfit_color:"#253f59",accent_color:"#cf445c",accessory:"badge"},
  [MCM_2026_NPC_IDS.STAGGERING]:{height:1.01,presentation:"male",skin_tone:1,skin_color_override:"#74866d",eye_color_override:"#d9d58a",mouth_color_override:"#5f3438",face_mark_color:"#7a2f38",hair_style:"sidepart",hair_color:"#242628",outfit_style:"shirt",outfit_color:"#51424a",accent_color:"#8d3648",accessory:"messenger"},
  [MCM_2026_NPC_IDS.DANCING]:{height:.98,presentation:"female",skin_tone:0,skin_color_override:"#819477",eye_color_override:"#e1dc91",mouth_color_override:"#633239",face_mark_color:"#7e303d",hair_style:"bob",hair_color:"#252429",outfit_style:"hoodie",outfit_color:"#384b5a",accent_color:"#96354d",accessory:"headphones"},
  [MCM_2026_NPC_IDS.HUNGRY]:{height:1.03,presentation:"male",skin_tone:2,skin_color_override:"#6d8068",eye_color_override:"#d2ce82",mouth_color_override:"#583239",face_mark_color:"#702d37",hair_style:"short",hair_color:"#232629",outfit_style:"sweater",outfit_color:"#534b38",accent_color:"#8c5735",accessory:"backpack"}
});
const byId=new Map(ACTORS.map(actor=>[actor.id,actor]));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

function applyZombiePose(actorId,visual){
  if(actorId===MCM_2026_NPC_IDS.GUIDE)return;
  if(actorId===MCM_2026_NPC_IDS.STAGGERING){
    visual.arms[0]?.setLocalEulerAngles(-34,0,-34);
    visual.arms[1]?.setLocalEulerAngles(-55,0,28);
    visual.legs[0]?.setLocalEulerAngles(0,0,-9);
    visual.legs[1]?.setLocalEulerAngles(0,0,13);
  }else if(actorId===MCM_2026_NPC_IDS.HUNGRY){
    visual.arms[0]?.setLocalEulerAngles(-64,0,-10);
    visual.arms[1]?.setLocalEulerAngles(-64,0,10);
    visual.legs[0]?.setLocalEulerAngles(0,0,-7);
    visual.legs[1]?.setLocalEulerAngles(0,0,7);
  }
}

function ensureStyle(doc){
  if(doc.getElementById("mcm26-npc-style"))return;
  const style=doc.createElement("style");style.id="mcm26-npc-style";style.textContent=`
    #mcm26-npc-labels{position:fixed;inset:0;z-index:60;pointer-events:none}
    .mcm26-npc-tag{position:absolute;transform:translate(-50%,-100%) scale(.88);transform-origin:50% 100%;padding:3px 7px;border:2px solid #cf445c;border-radius:8px;background:#241923e8;color:#fff;font:700 12px system-ui;white-space:nowrap;text-shadow:0 1px 2px #000}
    .mcm26-dialogue{position:fixed;left:50%;bottom:115px;transform:translateX(-50%);z-index:102;width:min(420px,calc(100vw - 16px));padding:12px;border:1px solid #c7677d;border-radius:14px;background:#211821f5;color:#fff;box-shadow:0 12px 42px #0009}
    .mcm26-dialogue[hidden]{display:none!important}.mcm26-dialogue strong{font-size:17px}.mcm26-dialogue p{margin:10px 0;line-height:1.5}.mcm26-dialogue button{min-height:40px;border:1px solid #ffffff33;border-radius:9px;background:#4a2633;color:#fff;padding:7px 10px;font-weight:800}
    .mcm26-dialogue .close{float:right;width:34px;border-radius:50%;padding:0}
  `;doc.head.appendChild(style);
}
export function createMcm2026EventRuntime({
  app,campusRoot,player,orbit,client,onInfo=()=>{},onStatus=()=>{},onDialogueChange=()=>{},doc=globalThis.document
}={}){
  if(!app||!campusRoot||!player||!orbit?.camera||!client||!doc?.body)throw Error("MCM_EVENT_RUNTIME_REQUIRED");
  ensureStyle(doc);
  const visuals=new Map(),labels=new Map();
  const labelLayer=doc.createElement("div");labelLayer.id="mcm26-npc-labels";doc.body.append(labelLayer);
  for(const actor of ACTORS){
    const copy={...actor,position:{...actor.position},dialogue:[...actor.dialogue]};
    const visual=createHumanAvatar(campusRoot,copy,APPEARANCE[actor.id]);
    visual.avatar.setLocalPosition(copy.position.x,0,copy.position.z);
    visual.marker.enabled=false;
    visual.identityMarker.enabled=true;
    applyZombiePose(actor.id,visual);
    visuals.set(actor.id,visual);
    const label=doc.createElement("span");label.className="mcm26-npc-tag";label.textContent=actor.name;label.hidden=true;labelLayer.append(label);labels.set(actor.id,label);
  }
  const panel=doc.createElement("section");panel.className="mcm26-dialogue";panel.hidden=true;panel.setAttribute("role","dialog");
  panel.innerHTML='<button class="close" type="button" aria-label="닫기">×</button><strong></strong><p></p><div class="actions"></div>';
  doc.body.append(panel);
  const speaker=panel.querySelector("strong"),line=panel.querySelector("p"),actions=panel.querySelector(".actions");
  let activeId=null,busy=false,elapsed=0;
  const projected=new pc.Vec3();
  const closeDialogue=()=>{
    if(!activeId)return false;
    activeId=null;panel.hidden=true;actions.replaceChildren();onDialogueChange(false);return true;
  };
  panel.querySelector(".close").addEventListener("click",closeDialogue);

  function current(){return client.state;}
  function nearest(){
    const phase=client.phase(),p=player.getLocalPosition();
    return ACTORS.filter(actor=>mcm2026ActorVisible(actor.id,phase))
      .map(actor=>({actor,distance:dist(p,actor.position)})).sort((a,b)=>a.distance-b.distance)[0]??null;
  }
  function investigated(id){
    const key=MCM_2026_INVESTIGATION_KEYS[id];
    return key?current()?.progress?.investigated?.includes(key)===true:false;
  }
  function setLine(actor,text){
    const wasOpen=Boolean(activeId);
    activeId=actor.id;speaker.textContent=actor.name;line.textContent=text;actions.replaceChildren();panel.hidden=false;
    if(!wasOpen)onDialogueChange(true);
    const info=doc.createElement("button");info.type="button";info.textContent="좀비대학교 행사 정보";info.addEventListener("click",onInfo);actions.append(info);
  }
  async function talk(actor){
    if(busy)return false;
    // A talk exactly at a window edge re-reads the server first; the server still decides.
    const reread=client.refreshIfStale();
    if(reread){busy=true;try{await reread;}finally{busy=false;}}
    const state=current(),phase=client.phase(),progress=state?.progress;
    const mode=mcm2026TalkMode({phase,eventState:state?.eventState??null});
    if(mode===MCM_2026_TALK.TEASER){
      const countdown=actor.id===MCM_2026_NPC_IDS.GUIDE&&phase===MCM_2026_PHASE.PRELUDE
        ?` (조사 개시까지 ${formatMcm2026Countdown(mcm2026MsUntilOutbreak(client.presentationNow()))})`:"";
      setLine(actor,`${MCM_2026_TEASER_LINES[phase][actor.id]}${countdown}`);
      return true;
    }
    if(mode===MCM_2026_TALK.ENDED){
      setLine(actor,progress?.completedAt
        ?"좀비대학교 조사는 모두 끝났어요. 당신의 생존 기록과 보상은 그대로 남아 있어요. 함께해 줘서 고마워요!"
        :"좀비대학교 조사는 모두 끝났어요. 함께해 줘서 고마워요. 다음 이상현상 때 다시 만나요!");
      return true;
    }
    if(mode===MCM_2026_TALK.LOGIN){
      setLine(actor,actor.id===MCM_2026_NPC_IDS.GUIDE?"조사는 로그인한 학생만 참여할 수 있어요. 로그인 후 다시 말을 걸어 주세요.":actor.dialogue[0]);
      return true;
    }
    if(mode!==MCM_2026_TALK.PLAY){setLine(actor,"지금은 이벤트를 진행할 수 없습니다.");return true;}
    const live=phase===MCM_2026_PHASE.ONSITE_LIVE;
    setLine(actor,live&&actor.id===MCM_2026_NPC_IDS.GUIDE?LIVE_GUIDE_LINE:actor.dialogue[0]);
    if(actor.id===MCM_2026_NPC_IDS.GUIDE){
      if(progress?.stage===MCM_2026_PROGRESS_STAGE.NOT_STARTED){
        busy=true;
        try{
          const result=await client.advance("start");
          if(result){line.textContent=`${live?"🔴 LIVE · ":""}좋아요. 문화의거리 쪽으로 이동하면서 수상한 학생 세 명과 직접 이야기해 주세요. 순서는 상관없어요.`;onStatus("🧟 후문의 이상현상 조사를 시작했어요.");}
        }catch{line.textContent="이벤트 진행 상태를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";}
        finally{busy=false;}
      }else if(progress?.stage===MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED){
        line.textContent=live?"세 명 모두 확인했군요. 지금 건물주에서 행사가 한창이에요! 지도에 표시된 건물주 입구로 이동해 주세요.":"세 명 모두 확인했군요. 지도에 표시된 건물주 입구로 이동해 주세요.";
      }else if(progress?.stage===MCM_2026_PROGRESS_STAGE.COMPLETED){
        line.textContent="조사는 끝났어요. 보상 정산이 남아 있다면 다시 시도할 수 있어요.";
      }else{
        line.textContent="문화의거리 안쪽으로 이동하면서 수상한 학생들과 직접 이야기해 보세요.";
      }
      return true;
    }
    if(progress?.stage===MCM_2026_PROGRESS_STAGE.NOT_STARTED){
      line.textContent=`${actor.dialogue[0]} 생존대원에게 먼저 상황을 물어보는 게 좋겠어...`;return true;
    }
    const action=MCM_2026_INVESTIGATION_ACTIONS[actor.id];
    if(!action||investigated(actor.id)){
      line.textContent=actor.dialogue[1]??actor.dialogue[0];return true;
    }
    busy=true;
    try{
      const result=await client.advance(action);
      if(result){
        const count=result.progress?.investigated?.length??0;
        line.textContent=`${actor.dialogue[0]} 조사 기록 ${count}/3.`;
        if(result.progress?.stage===MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED)onStatus("📍 조사 완료 · 건물주 입구가 지도에 표시됐어요.");
      }
    }catch{line.textContent="조사 기록을 서버에 남기지 못했어요. 다시 대화해 주세요.";}
    finally{busy=false;}
    return true;
  }
  function contextAction(){
    if(activeId)return null;
    const target=nearest();
    if(!target||target.distance>TALK_RADIUS)return null;
    return {id:"mcm-event-npc",icon:"🧟",label:`${target.actor.name}과 대화`,priority:305,distance:target.distance,
      trigger:()=>{void talk(target.actor);return true;}};
  }
  function mapTarget(){
    const state=current(),progress=state?.progress;
    if(!progress)return null;
    if(state.eventState!==MCM_2026_EVENT_STATE.ACTIVE||!isMcm2026PlayablePhase(client.phase()))return null;
    if(progress.stage===MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED)return {
      stage:"mcm.venue",...MCM_2026_ROUTE.venue.position,kind:"quest-venue",label:"건물주 · 좀비대학교 입장"
    };
    if(progress.stage===MCM_2026_PROGRESS_STAGE.NOT_STARTED)return {
      stage:"mcm.guide",...MCM_2026_ROUTE.guide,kind:"quest-npc",label:"문콘경 생존대원"
    };
    if(progress.stage!==MCM_2026_PROGRESS_STAGE.STARTED)return null;
    const next=ACTORS.slice(1).find(actor=>!investigated(actor.id));
    return next?{stage:`mcm.${next.id}`,...next.position,kind:"quest-npc",label:next.name}:null;
  }
  function update(dt){
    elapsed+=Math.min(dt??0,.05);
    client.refreshIfStale();
    const phase=client.phase(),p=player.getLocalPosition(),rect=app.graphicsDevice.canvas.getBoundingClientRect();
    for(const actor of ACTORS){
      const visual=visuals.get(actor.id),visible=mcm2026ActorVisible(actor.id,phase);
      visual.avatar.enabled=visible;
      const label=labels.get(actor.id);
      if(!visible){label.hidden=true;continue;}
      const distance=dist(p,actor.position);
      if(distance>LABEL_RADIUS){label.hidden=true;continue;}
      const world=visual.avatar.getPosition();
      projected.set(world.x,world.y+npcNameplateOffset(visual.appearance.height),world.z);
      const screen=orbit.camera.camera.worldToScreen(projected);
      label.hidden=screen.z<=0||screen.x<0||screen.y<0||screen.x>rect.width||screen.y>rect.height;
      if(!label.hidden){label.style.left=`${screen.x+rect.left}px`;label.style.top=`${screen.y+rect.top}px`;}
      if(actor.id===MCM_2026_NPC_IDS.DANCING&&!activeId){
        visual.arms[0]?.setLocalEulerAngles(0,0,-35+Math.sin(elapsed*5)*25);
        visual.arms[1]?.setLocalEulerAngles(0,0,35-Math.sin(elapsed*5)*25);
      }
    }
    if(activeId){
      const actor=byId.get(activeId);
      if(!actor||dist(p,actor.position)>metersToWorld(5))closeDialogue();
    }
  }
  // Direction + distance to the current objective, via the shared quest HUD formatter.
  function guidance(){
    const target=mapTarget();
    return target?formatQuestGuidance(target,player.getLocalPosition(),Number.isFinite(orbit.yaw)?orbit.yaw:0):"";
  }
  return Object.freeze({
    update,contextAction,mapTarget,guidance,
    isDialogueOpen:()=>Boolean(activeId),
    closeDialogue,
    status:()=>({activeConversation:activeId,nearest:nearest()?.actor?.id??null,phase:client.phase(),state:client.state}),
    destroy(){closeDialogue();panel.remove();labelLayer.remove();for(const v of visuals.values())v.avatar.destroy();}
  });
}
