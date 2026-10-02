import { MCM_2026_EVENT, MCM_2026_EVENT_STATE } from "./event-data.js";
import { MCM_2026_PHASE, formatMcm2026Countdown, isMcm2026PlayablePhase, mcm2026MsUntilOutbreak } from "./event-phase.js";
import { rewardExpLine } from "../../progression/reward-exp-line.js";

const itemLabels=Object.freeze({
  "top.mcm_2026_survivor":"좀비대학교 생존자 상의",
  "furniture.mcm_2026_poster":"2026 일일호프 포스터",
  "badge.mcm_2026_landlord":"건물주 챌린지 배지",
  "badge.main_gate":"정문 첫걸음 배지"
});
function stateLabel(phase,countdown){
  if(phase===MCM_2026_PHASE.ONSITE_LIVE)return "🔴 좀비대학교 LIVE · 건물주 현장 행사 진행 중";
  if(phase===MCM_2026_PHASE.OUTBREAK)return "🧟 조사 진행 중 · 현장 행사 18:00 시작";
  if(phase===MCM_2026_PHASE.WARNING)return "⚠️ 오늘 00:00 조사 개시";
  if(phase===MCM_2026_PHASE.PRELUDE)return `🟡 이상징후 감지 · 조사 개시까지 ${countdown}`;
  if(phase===MCM_2026_PHASE.ENDED)return "⚫ 종료 · 획득 보상 정산 가능";
  if(phase===MCM_2026_PHASE.DISABLED)return "이벤트 비활성";
  return "🟡 곧 공개됩니다";
}
// Compact HUD chip: phase + objective guidance (shared quest arrow/metre formatter).
function chipLabel(phase,progress,countdown,guidance){
  const tail=guidance?` · ${guidance}`:"";
  if(phase===MCM_2026_PHASE.PRELUDE)return `🧟 좀비대학교 D-${countdown}`;
  if(phase===MCM_2026_PHASE.WARNING)return "⚠️ 오늘 00:00 조사 개시";
  if(phase===MCM_2026_PHASE.ENDED)return "⚫ 좀비대학교 종료";
  if(!isMcm2026PlayablePhase(phase))return "🧟 EVENT";
  const head=phase===MCM_2026_PHASE.ONSITE_LIVE?"🔴 좀비대학교 LIVE":"🧟 좀비대학교";
  if(progress?.stage==="STARTED")return `${head} · 조사 ${progress.investigated?.length??0}/3${tail}`;
  if(progress?.stage==="VENUE_UNLOCKED")return `${head} · 건물주${tail}`;
  if(progress?.stage==="COMPLETED")return `${head} · 완료`;
  return `${head}${tail}`;
}
export function shortMcm2026ChipLabel(phase,progress,countdown){
  if(phase===MCM_2026_PHASE.PRELUDE)return `🧟 D-${countdown}`;
  if(phase===MCM_2026_PHASE.WARNING)return "⚠️ 00:00";
  if(phase===MCM_2026_PHASE.ENDED)return "⚫ 종료";
  if(phase===MCM_2026_PHASE.ONSITE_LIVE)return "🔴 LIVE";
  if(!isMcm2026PlayablePhase(phase))return "🧟 EVENT";
  if(progress?.stage==="STARTED")return `🧟 ${progress.investigated?.length??0}/3`;
  if(progress?.stage==="VENUE_UNLOCKED")return "🧟 건물주";
  if(progress?.stage==="COMPLETED")return "🧟 완료";
  return "🧟 이벤트";
}
function progressLabel(progress){
  if(!progress)return "로그인하면 진행 상황을 확인할 수 있어요.";
  if(progress.stage==="NOT_STARTED")return "아직 조사를 시작하지 않았습니다.";
  if(progress.stage==="STARTED")return `이상현상 조사 중 · ${progress.investigated?.length??0}/3`;
  if(progress.stage==="VENUE_UNLOCKED")return "수상한 학생 3명 확인 완료 · 건물주로 이동하세요.";
  if(progress.stage==="COMPLETED")return "좀비대학교 조사 완료";
  return "진행 상태 확인 중";
}
// One toast line per server Reward entry, or null when the entry has nothing to show.
export function rewardLine(entry){
  if(!entry)return null;
  if(entry.grantType==="CURRENCY")return `+${entry.granted||entry.requested} 인덕코인`;
  // P1a: EXP only as the server settled it (see reward-exp-line.js); never estimated here.
  if(entry.grantType==="EXP")return rewardExpLine(entry);
  const label=itemLabels[entry.targetId]??entry.targetId;
  return entry.status==="SKIPPED"?`${label} · 이미 보유`:`${label} 획득`;
}
// Toast text and duration for one claim result, or null. Pure: no progression/wallet state is touched.
export function rewardToastMessage(result){
  if(!result)return null;
  if(result.status==="PREVIEW")return {text:"🧪 QA PREVIEW · 실제 보상은 지급되지 않습니다.",ms:3200};
  if(result.status==="REWARD_FAILED")return {text:"보상 정산에 실패했어요. 완료 기록은 보존됐으며 다시 시도할 수 있습니다.",ms:3200};
  const lines=(result.rewardResult?.entries??[]).map(rewardLine).filter(Boolean);
  const heading=result.status==="ALREADY_CLAIMED"?"이미 정산된 보상입니다":"🎁 보상 획득";
  return {text:[heading,...lines].join("\n"),ms:4500};
}
// P1c0: one toast element, shown FIFO. A message never replaces the one on screen: it waits for it
// to end, then a short gap, then shows for its own duration. No dedupe: every server result is shown.
export const TOAST_QUEUE_GAP_MS=150;
export function createToastQueue({element,gapMs=TOAST_QUEUE_GAP_MS,setTimer=setTimeout,clearTimer=clearTimeout,now=()=>Date.now()}={}){
  const pending=[];
  let phase="idle",timer=null,until=0,destroyed=false;
  function showNext(){
    timer=null;
    const next=pending.shift();
    if(!next){phase="idle";until=0;return;}
    phase="showing";element.textContent=next.text;element.hidden=false;until=now()+next.ms;
    try { next.onShow?.(); } catch { /* Presentation observers never block the toast lane. */ }
    timer=setTimer(endCurrent,next.ms);
  }
  function endCurrent(){
    element.hidden=true;
    if(!pending.length){timer=null;phase="idle";until=0;return;}
    phase="gap";until=now()+gapMs;timer=setTimer(showNext,gapMs);
  }
  return Object.freeze({
    say(text,ms,onShow=null){
      if(destroyed)return;
      pending.push({text:String(text),ms,onShow:typeof onShow==="function"?onShow:null});
      if(phase==="idle")showNext();
    },
    /** Time until the whole lane is idle: the current toast (or gap) plus every queued toast and gap. */
    remainingMs(){
      if(phase==="idle")return 0;
      let total=Math.max(0,until-now());
      pending.forEach((item,index)=>{total+=(phase==="gap"&&index===0?0:gapMs)+item.ms;});
      return Math.max(1,total);
    },
    get length(){return pending.length+(phase==="showing"?1:0);},
    destroy(){destroyed=true;if(timer!==null)clearTimer(timer);timer=null;pending.length=0;phase="idle";until=0;element.hidden=true;}
  });
}
// A World status raised while the reward toast lane is busy waits until the lane is idle. It re-checks
// right before showing, so a reward queued after the wait was computed pushes it back again. One
// deferred status at a time: a newer one replaces an older one that has not shown yet.
export function createStatusAfterReward({remainingMs,show,gapMs=TOAST_QUEUE_GAP_MS,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer=null;
  return function showAfterReward(message){
    if(timer!==null)clearTimer(timer);
    timer=null;
    const attempt=()=>{
      const wait=remainingMs();
      if(wait>0){timer=setTimer(attempt,wait+gapMs);return;}
      timer=null;show(message);
    };
    attempt();
    return true;
  };
}
function ensureStyle(doc){
  if(doc.getElementById("mcm-2026-client-style"))return;
  const style=doc.createElement("style");style.id="mcm-2026-client-style";style.textContent=`
    .mcm26-chip{position:fixed;right:var(--world-right-rail-right,max(12px,env(safe-area-inset-right)));top:var(--world-right-rail-event-top,calc(max(66px,env(safe-area-inset-top) + 56px) + 120px));z-index:65;border:1px solid #ffffff38;border-radius:999px;background:#28131deb;color:#fff;padding:9px 13px;font:800 13px system-ui;cursor:pointer;white-space:nowrap}
    .mcm26-chip[hidden],.mcm26-modal[hidden],.mcm26-toast[hidden]{display:none!important}
    .mcm26-modal{position:fixed;inset:0;z-index:130;display:grid;place-items:center;background:#05070ab8;padding:16px}
    .mcm26-card{width:min(540px,100%);max-height:82vh;overflow:auto;border:1px solid #ffffff25;border-radius:22px;background:#11191d;color:#f8f6f6;box-shadow:0 24px 80px #0009}
    .mcm26-hero{padding:22px;background:radial-gradient(circle at 90% 12%,#ad274c99,transparent 38%),linear-gradient(145deg,#39131f,#11191d 66%)}
    .mcm26-hero h2{margin:5px 0;font-size:28px}.mcm26-hero p{margin:0;color:#eadde1}.mcm26-body{padding:20px 22px 24px}.mcm26-body p,.mcm26-body li{font:14px/1.55 system-ui}
    .mcm26-state{display:inline-flex;margin-top:12px;padding:6px 9px;border-radius:999px;background:#ffffff12;font:800 12px system-ui}
    .mcm26-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.mcm26-actions a{border:1px solid #ffffff2e;border-radius:11px;background:#ffffff0e;color:#fff;padding:10px 13px;font:800 13px system-ui;text-decoration:none}
    .mcm26-close{float:right;border:0;background:#ffffff12;color:white;border-radius:50%;width:34px;height:34px;font-size:20px}
    .mcm26-toast{position:fixed;left:50%;bottom:calc(100px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:140;width:max-content;max-width:min(420px,calc(100vw - 28px));box-sizing:border-box;background:#121419f2;color:#fff;border:1px solid #ffffff28;border-radius:14px;padding:12px 16px;font:800 13px/1.5 system-ui;box-shadow:0 12px 36px #0007;white-space:pre-line;pointer-events:none}
    @media(max-width:560px){.mcm26-toast{bottom:max(212px,calc(env(safe-area-inset-bottom) + 170px))}body:has(#transport-action:not([hidden])) .mcm26-toast{bottom:max(286px,calc(env(safe-area-inset-bottom) + 244px))}body[data-movement-state="MOUNT_FLIGHT"]:has(#transport-action:not([hidden])) .mcm26-toast{bottom:max(374px,calc(env(safe-area-inset-bottom) + 332px))}}
    @media(max-width:420px) and (pointer:coarse){.mcm26-toast{bottom:max(262px,calc(env(safe-area-inset-bottom) + 234px))}body[data-movement-state="MOUNT_FLIGHT"]:has(#transport-action:not([hidden])) .mcm26-toast{bottom:max(340px,calc(env(safe-area-inset-bottom) + 312px))}}
    @media(max-width:560px){.mcm26-chip{min-height:36px;padding:7px 10px;font-size:0;line-height:1}.mcm26-chip::after{content:attr(data-short-label);font:800 12px/1 system-ui}.mcm26-modal{padding:9px;align-items:end}.mcm26-card{border-radius:20px 20px 12px 12px;max-height:84vh}.mcm26-hero{padding:19px}.mcm26-body{padding:17px 19px 21px}}
  `;doc.head.appendChild(style);
}

export function createMcm2026EventUi({client,getGuidance=()=>"",onOpenChange=()=>{},doc=globalThis.document}={}){
  if(!client||!doc?.body)throw Error("MCM_EVENT_UI_REQUIRED");
  ensureStyle(doc);
  const chip=doc.createElement("button");chip.type="button";chip.className="mcm26-chip";chip.textContent="🧟 EVENT";chip.hidden=true;
  const modal=doc.createElement("section");modal.className="mcm26-modal";modal.hidden=true;modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
  modal.innerHTML=`<article class="mcm26-card"><header class="mcm26-hero"><button class="mcm26-close" type="button" aria-label="닫기">×</button><div style="font:900 11px system-ui;letter-spacing:.1em;color:#ff9db0">INHA WORLD × 문콘경</div><h2></h2><p></p><span class="mcm26-state"></span></header><div class="mcm26-body"></div></article>`;
  const toast=doc.createElement("div");toast.className="mcm26-toast";toast.hidden=true;toast.setAttribute("role","status");
  doc.body.append(chip,modal,toast);
  modal.querySelector("h2").textContent=MCM_2026_EVENT.title;
  modal.querySelector(".mcm26-hero p").textContent=MCM_2026_EVENT.subtitle;
  let open=false,clock=0,renderedKey="";

  function countdown(){return formatMcm2026Countdown(mcm2026MsUntilOutbreak(client.presentationNow()));}
  function dDay(){return String(Math.max(0,Math.ceil(mcm2026MsUntilOutbreak(client.presentationNow())/86_400_000)));}
  function renderChip(){
    const snapshot=client.state,phase=client.phase();
    // Signed-out players still see the public teaser; progress stays behind sign-in.
    const publicPhase=phase===MCM_2026_PHASE.PRELUDE||phase===MCM_2026_PHASE.WARNING||isMcm2026PlayablePhase(phase);
    chip.hidden=!client.preview&&(phase===MCM_2026_PHASE.ENDED||phase===MCM_2026_PHASE.DISABLED||(!snapshot&&!publicPhase));
    chip.dataset.phase=phase;
    const countdown=dDay();
    const label=chipLabel(phase,snapshot?.progress,countdown,getGuidance());
    const shortLabel=shortMcm2026ChipLabel(phase,snapshot?.progress,countdown);
    chip.dataset.shortLabel=shortLabel;
    chip.setAttribute("aria-label",label);
    if(chip.textContent!==label)chip.textContent=label;
  }
  function stateText(){return `${client.preview?"🧪 QA PREVIEW · 보상 없음 · ":""}${stateLabel(client.phase(),countdown())}`;}
  function render(){
    const snapshot=client.state,phase=client.phase();
    const eventState=snapshot?.eventState??null;
    renderChip();
    if(!client.preview&&(phase===MCM_2026_PHASE.ENDED||phase===MCM_2026_PHASE.DISABLED)){
      if(open)close();
      return snapshot;
    }
    const label=stateText();
    modal.querySelector(".mcm26-state").textContent=label;
    const progress=snapshot?.progress;
    const ended=eventState===MCM_2026_EVENT_STATE.ENDED;
    renderedKey=label;
    modal.querySelector(".mcm26-body").innerHTML=`
      <p><strong>🧟 게임 조사 · 9월 30일 00:00 ~ 10월 1일 01:00</strong><br><strong>🎉 현장 행사 · 9월 30일 18:00 ~ 10월 1일 01:00</strong><br>📍 ${MCM_2026_EVENT.locationLabel}<br>주최 · ${MCM_2026_EVENT.organizer}</p>
      <p>게임 속 조사와 보상은 현장 참여 여부와 관계없이 누구나 같은 조건으로 진행됩니다.</p>
      <p><strong>${progressLabel(progress)}</strong></p>
      ${progress?.stage==="VENUE_UNLOCKED"?'<p>📍 지도 표시를 따라 건물주 입구로 이동하세요.</p>':""}
      ${ended&&progress?.completedAt?'<p>정산되지 않은 획득 보상은 이벤트 종료 뒤에도 안전하게 다시 받을 수 있습니다.</p>':""}
      <h3>주요 프로그램</h3><ul>${MCM_2026_EVENT.programs.map(item=>`<li>${item}</li>`).join("")}</ul>
      <div class="mcm26-actions"><a href="${MCM_2026_EVENT.externalUrl}" target="_blank" rel="noopener noreferrer">공식 인스타그램 ↗</a></div>`;
    return snapshot;
  }
  function openInfo(){
    const phase=client.phase();
    if(!client.preview&&(phase===MCM_2026_PHASE.ENDED||phase===MCM_2026_PHASE.DISABLED))return false;
    render();
    if(open)return false;
    open=true;
    modal.hidden=false;
    onOpenChange(true);
    return true;
  }
  // Phases move with time, not only with server reads: refresh the chip (and an open modal) a few times a second.
  function update(dt){
    clock+=Math.min(dt??0,.25);
    if(clock<.25)return;
    clock=0;renderChip();
    if(open&&renderedKey!==stateText())render();
  }
  function close(){
    if(!open)return false;
    open=false;
    modal.hidden=true;
    onOpenChange(false);
    return true;
  }
  const toastQueue=createToastQueue({element:toast});
  function say(message,ms=3200,onShow=null){toastQueue.say(message,ms,onShow);}
  // Lets the World status line wait until the whole reward toast lane (current + queued) is idle (P1a/P1c0).
  function toastRemainingMs(){return toastQueue.remainingMs();}
  function showReward(result,{onShown=null}={}){
    const message=rewardToastMessage(result);
    if(message)say(message.text,message.ms,onShown);
  }
  chip.addEventListener("click",openInfo);modal.querySelector(".mcm26-close").addEventListener("click",close);
  modal.addEventListener("pointerdown",event=>{if(event.target===modal)close();});
  const off=client.onChange(()=>{render();});
  render();
  return Object.freeze({
    openInfo,close,render,update,say,showReward,toastRemainingMs,
    get openState(){return open;},
    destroy(){close();off?.();toastQueue.destroy();chip.remove();modal.remove();toast.remove();}
  });
}
