import { isQuestRewardResult } from '../../npc-factory/quest-reward-shape.mjs';
import { FIRST_CAMPUS_REWARD_ID } from '../next-discovery.js';

// This is a local presentation-recovery intent, never Quest progress or entitlement.
// The server still derives the receipt key and validates its owner; no reward is stored here.
const KEY = 'inhagame-first-campus-presentation-v1:';
export function createFirstCampusCompletion({storage=undefined,getFunnel=()=>null}={}) {
  if(storage===undefined){try{storage=globalThis.sessionStorage??null;}catch{storage=null;}}
  let account=null,generation=0,pending=false,receipt=null;
  const persist=()=>{if(!account)return;try{if(pending)storage?.setItem?.(KEY+account,'pending');else storage?.removeItem?.(KEY+account);}catch{/* best effort; in-memory recovery still works */}};
  function setAccount(next){
    next=typeof next==='string'&&next?next:null;
    if(next===account)return;
    account=next;generation++;receipt=null;pending=false;
    if(account)try{pending=storage?.getItem?.(KEY+account)==='pending';}catch{/* unavailable storage */}
  }
  function begin(){if(!account)return false;pending=true;persist();return true;}
  function accept(reward){
    if(!account||!isQuestRewardResult(reward)||reward.rewardId!==FIRST_CAMPUS_REWARD_ID||reward.status!=='SUCCESS'||
       typeof reward.rewardTransactionId!=='string'||!reward.rewardTransactionId||(!pending&&reward.replayed))return null;
    if(receipt?.transaction===reward.rewardTransactionId)return receipt.token;
    begin();
    const gen=generation,owner=account;
    const token=Object.freeze({isCurrent:()=>gen===generation&&owner===account});
    receipt={transaction:reward.rewardTransactionId,token,toast:null,growthReady:false,rewardSeen:false,growthSeen:false,nextSeen:false};
    getFunnel()?.firstReward();
    return token;
  }
  function trackToast(token,toast){if(token?.isCurrent()&&receipt?.token===token)receipt.toast=toast;}
  function growthReadback(change){
    if(!receipt||change?.accountId!==account||change.reason!=='core15-first-campus-reward')return;
    receipt.growthReady=change.state==='READY'&&Number.isSafeInteger(change.snapshot?.level)&&change.snapshot.level>=1&&
      Number.isSafeInteger(change.snapshot?.totalExp)&&change.snapshot.totalExp>=0;
  }
  function observe({growthVisible=false,nextGoalVisible=false}={}){
    if(!receipt||!receipt.token.isCurrent())return;
    const funnel=getFunnel();
    if(!receipt.rewardSeen&&receipt.toast?.isVisible?.()===true){receipt.rewardSeen=true;funnel?.rewardSeen();}
    if(!receipt.growthSeen&&receipt.rewardSeen&&receipt.growthReady&&growthVisible){receipt.growthSeen=true;funnel?.growthSeen();}
    if(!receipt.nextSeen&&receipt.growthSeen&&nextGoalVisible){receipt.nextSeen=true;funnel?.nextGoalSeen();}
    if(receipt.rewardSeen&&receipt.growthSeen&&receipt.nextSeen){pending=false;persist();}
  }
  return {setAccount,begin,accept,trackToast,growthReadback,observe,needsRecovery:()=>pending&&!receipt};
}

// A returned state/readback is not proof the player could see the rendered surface.
export function isElementVisible(element){
  const doc=element?.ownerDocument;
  if(!element||element.isConnected!==true||doc?.visibilityState==='hidden')return false;
  for(let node=element;node;node=node.parentElement){
    if(node.hidden)return false;
    const style=doc?.defaultView?.getComputedStyle?.(node);
    if(style&&(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0'))return false;
  }
  const view=doc?.defaultView;
  return Array.from(element.getClientRects?.()??[]).some(rect=>rect.width>0&&rect.height>0&&
    (rect.right===undefined||rect.right>0)&&(rect.bottom===undefined||rect.bottom>0)&&
    (!Number.isFinite(view?.innerWidth)||rect.left<view.innerWidth)&&
    (!Number.isFinite(view?.innerHeight)||rect.top<view.innerHeight));
}
