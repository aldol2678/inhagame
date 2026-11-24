import {
  MCM_2026_EVENT_ID,
  MCM_2026_EVENT_STATE,
  MCM_2026_PROGRESS_STAGE
} from "./event-data.js";
import { MCM_2026_SCHEDULE, mcm2026ServerStateAt, resolveMcm2026Phase } from "./event-phase.js";
import { readGuestSessionId } from "../../activity/session-id.js";

// AUTH (migrated 2026-11-20, Tier 4 guest-open — A-3): the live paths authenticate with the
// v0.1 guest session id in the `X-Session-Id` header only — no other credential header is
// sent. The id is read lazily by readGuestSessionId() (the single source; null when absent —
// never fabricated). Read: GET /api/world-mcm-event. Landlord run:
// POST /api/world-mcm-landlord-run (empty body). Landlord choice:
// POST /api/world-mcm-landlord-choice { runId, actorId }. Claims:
// POST /api/world-mcm-claim { claim: "main" | "landlord_first_clear" }.
// The server answers 200 + the result, or an HTTP status with { error: <server refusal code> }.
// Live advance is NOT available: advance_mcm_2026_event_v1 is server-only in Tier 4 (no HTTP
// endpoint, no client call in the original — the old /api/world-quest Bearer POST was the
// pre-Tier-4 quest path and is gone), so advance() throws MCM_ADVANCE_UNAVAILABLE outside
// preview. The preview branch still advances locally, unchanged.
// Before: refresh/startRun/submitRun/claim called getClient().rpc() on the signed-in
// permanent-account client. That path is gone; only the transport changed — the preview
// logic, server-offset tracking and boundary refresh are unchanged.
export const MCM_EVENT_API_PATH = "/api/world-mcm-event";
export const MCM_LANDLORD_RUN_API_PATH = "/api/world-mcm-landlord-run";
export const MCM_LANDLORD_CHOICE_API_PATH = "/api/world-mcm-landlord-choice";
export const MCM_CLAIM_API_PATH = "/api/world-mcm-claim";

const ACTOR_IDS = Object.freeze(["ZUE-MG-001","ZUE-MG-002","ZUE-MG-003","ZUE-MG-004","ZUE-MG-005"]);

const BOUNDARY_REFRESH_MS=5_000;

// Untimed preview stays playable at any real time (legacy QA). A timed preview (?mcmAt=) mimics the
// server window on MCM_2026_SCHEDULE so every live phase can be reviewed without a database.
function previewState(now,timed) {
  const iso=new Date(now).toISOString();
  return {
    eventId:MCM_2026_EVENT_ID,
    eventState:timed?mcm2026ServerStateAt(now):MCM_2026_EVENT_STATE.ACTIVE,
    startsAt:timed?MCM_2026_SCHEDULE.outbreakStartsAt:iso,
    endsAt:timed?MCM_2026_SCHEDULE.endsAt:new Date(now+86_400_000).toISOString(),serverNow:iso,
    progress:{stage:MCM_2026_PROGRESS_STAGE.NOT_STARTED,investigated:[],startedAt:null,venueUnlockedAt:null,completedAt:null},
    landlord:{firstClearedAt:null,activeRun:null}
  };
}
const clone = value => value == null ? value : structuredClone(value);
// Tier 4 fetch helper: X-Session-Id only, no Bearer. Throws MCM_AUTH_REQUIRED when
// there is no session, the server refusal code on a non-2xx, or
// MCM_PROGRESS_UNAVAILABLE when the server gives no code.
async function fetchMcm(getSessionId, fetcher, path, init = {}) {
  let sessionId = null;
  try { sessionId = await getSessionId?.() ?? null; } catch { sessionId = null; }
  if (!sessionId) throw Error("MCM_AUTH_REQUIRED");
  const response = await fetcher(path, { ...init, headers: { ...(init.headers ?? {}), "X-Session-Id": sessionId } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(typeof data?.error === "string" && data.error ? data.error : "MCM_PROGRESS_UNAVAILABLE");
  return data;
}

export function createMcm2026EventClient({
  preview=false,
  previewTimed=false,
  getSessionId=readGuestSessionId,
  fetcher=fetch,
  mcmEndpoint=MCM_EVENT_API_PATH,
  landlordRunEndpoint=MCM_LANDLORD_RUN_API_PATH,
  landlordChoiceEndpoint=MCM_LANDLORD_CHOICE_API_PATH,
  claimEndpoint=MCM_CLAIM_API_PATH,
  clock={now:()=>Date.now()},
  randomBytes=length=>{
    const bytes=new Uint8Array(length);
    globalThis.crypto?.getRandomValues?.(bytes);
    return bytes;
  }
}={}){
  let signedIn=false;
  const timed=Boolean(preview&&previewTimed);
  let state=preview?previewState(clock.now(),timed):null;
  let serverOffsetMs=0;
  let pending=null;
  let previewRun=null;
  let lastBoundaryRefreshAt=-Infinity;
  const listeners=new Set();

  const publish=()=>{for(const listener of listeners){try{listener(status());}catch{}}};
  const applyServerState=next=>{
    if(!next||next.eventId!==MCM_2026_EVENT_ID) throw Error("MCM_STATE_INVALID");
    if(next.serverNow){
      const server=Date.parse(next.serverNow);
      if(Number.isFinite(server))serverOffsetMs=server-clock.now();
    }
    state=clone(next);
    publish();
    return state;
  };
  const status=()=>Object.freeze({
    preview:Boolean(preview),signedIn:Boolean(signedIn),pending:Boolean(pending),
    state:clone(state),serverOffsetMs,phase:phase()
  });
  const presentationNow=()=>clock.now()+serverOffsetMs;
  const phase=()=>resolveMcm2026Phase({eventState:state?.eventState??null,nowMs:presentationNow()});
  const previewGate=()=>{
    if(!timed)return;
    state.eventState=mcm2026ServerStateAt(clock.now());state.serverNow=new Date(clock.now()).toISOString();
    if(state.eventState!==MCM_2026_EVENT_STATE.ACTIVE){publish();throw Error("EVENT_NOT_ACTIVE");}
  };
  const remainingMs=deadlineAt=>{
    const deadline=Date.parse(deadlineAt??"");
    return Number.isFinite(deadline)?Math.max(0,deadline-presentationNow()):0;
  };

  async function refresh(){
    if(preview){
      if(timed){state.eventState=mcm2026ServerStateAt(clock.now());state.serverNow=new Date(clock.now()).toISOString();}
      publish();return clone(state);
    }
    if(!signedIn)return null;
    return applyServerState(await fetchMcm(getSessionId,fetcher,mcmEndpoint));
  }

  async function advance(action){
    if(preview){
      if(action!=="status")previewGate();
      const now=new Date(clock.now()).toISOString();
      const next=clone(state);
      next.serverNow=now;
      if(action==="start"&&next.progress.stage===MCM_2026_PROGRESS_STAGE.NOT_STARTED){
        next.progress.stage=MCM_2026_PROGRESS_STAGE.STARTED;next.progress.startedAt=now;
      }else if(action.startsWith("investigate_")&&next.progress.stage===MCM_2026_PROGRESS_STAGE.STARTED){
        const key=action.slice("investigate_".length);
        if(!next.progress.investigated.includes(key))next.progress.investigated.push(key);
        next.progress.investigated.sort();
        if(next.progress.investigated.length===3){
          next.progress.stage=MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED;
          next.progress.venueUnlockedAt??=now;
        }
      }
      state=next;publish();return clone(state);
    }
    // A-3: advance_mcm_2026_event_v1 is server-only in Tier 4 (no HTTP endpoint and
    // no client call in the original — the old /api/world-quest Bearer POST was the
    // pre-Tier-4 quest path and is gone). The preview branch above still advances
    // locally; a live advance is unavailable.
    throw Error("MCM_ADVANCE_UNAVAILABLE");
  }

  async function startRun(){
    if(preview){
      previewGate();
      if(previewRun?.status==="ACTIVE")return publicPreviewRun(previewRun,true);
      const secret=ACTOR_IDS[(randomBytes(1)[0]??0)%ACTOR_IDS.length];
      const now=clock.now();
      previewRun={runId:`preview-${now}`,status:"ACTIVE",survivor:secret,startedAt:new Date(now).toISOString(),
        deadlineAt:new Date(now+45_000).toISOString(),wrongCount:0};
      state.landlord.activeRun={runId:previewRun.runId,startedAt:previewRun.startedAt,deadlineAt:previewRun.deadlineAt,wrongCount:0};
      publish();return publicPreviewRun(previewRun,false);
    }
    if(!signedIn)throw Error("MCM_AUTH_REQUIRED");
    const data=await fetchMcm(getSessionId,fetcher,landlordRunEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    if(data?.serverNow){
      const server=Date.parse(data.serverNow);if(Number.isFinite(server))serverOffsetMs=server-clock.now();
    }
    await refresh().catch(()=>null);
    return data;
  }

  function publicPreviewRun(run,resumed){
    return {runId:run.runId,status:run.status,resumed,startedAt:run.startedAt,deadlineAt:run.deadlineAt,
      serverNow:new Date(clock.now()).toISOString(),durationMs:45_000,wrongPenaltyMs:5_000,
      wrongCount:run.wrongCount,actorIds:[...ACTOR_IDS]};
  }

  async function submitRun(runId,actorId){
    if(preview){
      if(!previewRun||previewRun.runId!==runId)throw Error("RUN_NOT_FOUND");
      if(previewRun.status==="ACTIVE")previewGate();
      const now=clock.now();
      if(previewRun.status==="ACTIVE"&&now>Date.parse(previewRun.deadlineAt))previewRun.status="FAILED";
      let correct=null,firstClear=false;
      if(previewRun.status==="ACTIVE"){
        correct=actorId===previewRun.survivor;
        if(correct){
          previewRun.status="CLEARED";firstClear=!state.landlord.firstClearedAt;
          state.landlord.firstClearedAt??=new Date(now).toISOString();
          if(state.progress.stage===MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED){
            state.progress.stage=MCM_2026_PROGRESS_STAGE.COMPLETED;state.progress.completedAt??=new Date(now).toISOString();
          }
        }else{
          previewRun.wrongCount+=1;
          previewRun.deadlineAt=new Date(Date.parse(previewRun.deadlineAt)-5000).toISOString();
          if(now>Date.parse(previewRun.deadlineAt))previewRun.status="FAILED";
        }
      }
      state.landlord.activeRun=previewRun.status==="ACTIVE"
        ?{runId,startedAt:previewRun.startedAt,deadlineAt:previewRun.deadlineAt,wrongCount:previewRun.wrongCount}:null;
      state.serverNow=new Date(now).toISOString();publish();
      return {runId,status:previewRun.status,correct,firstClear,wrongCount:previewRun.wrongCount,
        deadlineAt:previewRun.deadlineAt,serverNow:state.serverNow,firstClearedAt:state.landlord.firstClearedAt};
    }
    if(!signedIn)throw Error("MCM_AUTH_REQUIRED");
    const data=await fetchMcm(getSessionId,fetcher,landlordChoiceEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({runId,actorId})});
    if(data?.serverNow){
      const server=Date.parse(data.serverNow);if(Number.isFinite(server))serverOffsetMs=server-clock.now();
    }
    if(data?.status!=="ACTIVE")await refresh().catch(()=>null);
    return data;
  }

  async function claim(kind){
    if(preview)return {claimType:kind,status:"PREVIEW",replayed:false,rewardStatus:"PREVIEW",rewardResult:{entries:[]}};
    if(!signedIn)throw Error("MCM_AUTH_REQUIRED");
    return fetchMcm(getSessionId,fetcher,claimEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({claim:kind==="LANDLORD_FIRST_CLEAR"?"landlord_first_clear":"main"})});
  }

  // The server state only changes when it is read again. When projected server time crosses the
  // window edge the client re-reads once (throttled) and returns that read; it never flips eventState by itself.
  function refreshIfStale(){
    if(!state||pending||(!preview&&!signedIn))return null;
    const now=presentationNow();
    const startsAt=Date.parse(state.startsAt??""),endsAt=Date.parse(state.endsAt??"");
    const stale=(state.eventState===MCM_2026_EVENT_STATE.SCHEDULED&&now>=startsAt)
      ||(state.eventState===MCM_2026_EVENT_STATE.ACTIVE&&now>=endsAt);
    if(!stale||clock.now()-lastBoundaryRefreshAt<BOUNDARY_REFRESH_MS)return null;
    lastBoundaryRefreshAt=clock.now();
    return refresh().catch(()=>null);
  }

  return Object.freeze({
    status,phase,refreshIfStale,
    get state(){return clone(state);},
    get preview(){return preview;},
    get previewTimed(){return timed;},
    onChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    setSignedIn(value){
      signedIn=Boolean(value)||preview;
      if(!signedIn&&!preview){state=null;serverOffsetMs=0;publish();return Promise.resolve(null);}
      return refresh().catch(()=>null);
    },
    refresh,advance,startRun,submitRun,
    claimLandlord:()=>claim("LANDLORD_FIRST_CLEAR"),
    claimMain:()=>claim("MAIN_CLEAR"),
    remainingMs,presentationNow
  });
}
