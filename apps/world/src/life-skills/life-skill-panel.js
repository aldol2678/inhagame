// INHA WORLD Life Progression / Skill Tree panel v1.
// Presentation follows server snapshots. canRankUp / unavailableReason are displayed, never recomputed here.

import { LIFE_PROGRESSION_STATE } from "./life-progression-client.js";
import { LIFE_SKILL_TREE_REGISTRY } from "./life-skill-tree-registry.js";

const TREE_NAMES = Object.freeze({
  "life_tree.fishing":"낚시",
  "life_tree.woodcutting":"벌목",
  "life_tree.farming":"농업",
  "life_tree.sailing":"항해"
});
const TREE_ICONS = Object.freeze({
  "life_tree.fishing":"🎣",
  "life_tree.woodcutting":"🪓",
  "life_tree.farming":"🌾",
  "life_tree.sailing":"⛵"
});
const REASON_TEXT = Object.freeze({
  INACTIVE:"준비 중",
  MAX_RANK:"최대 랭크",
  LIFE_LEVEL_REQUIRED:"생활레벨 부족",
  LIFE_SKILL_LEVEL_REQUIRED:"숙련레벨 부족",
  PREREQUISITE_REQUIRED:"선행 스킬 필요",
  INSUFFICIENT_SP:"SP 부족"
});
const ERROR_TEXT = Object.freeze({
  LIFE_SKILL_NODE_INACTIVE:"아직 활성화되지 않은 생활 스킬이에요.",
  LIFE_LEVEL_REQUIRED:"생활레벨이 부족해요.",
  LIFE_SKILL_LEVEL_REQUIRED:"생활 숙련도가 부족해요.",
  LIFE_SKILL_PREREQUISITE_REQUIRED:"먼저 필요한 스킬을 올려주세요.",
  INSUFFICIENT_LIFE_SKILL_POINTS:"스킬포인트가 부족해요.",
  LIFE_SKILL_NODE_MAX_RANK:"이미 최대 랭크예요.",
  IDEMPOTENCY_CONFLICT:"요청 상태가 충돌했어요. 다시 열어 확인해주세요.",
  FAILED:"생활 스킬 요청을 완료하지 못했어요."
});

const fmt = (value) => Number(value).toLocaleString("ko-KR");

export function lifeProgressText(snapshot) {
  if (!snapshot) return null;
  if (snapshot.isMaxLevel) return "생활 Lv." + snapshot.level + " · " + fmt(snapshot.totalXp) + " EXP";
  return "생활 Lv." + snapshot.level + " · " + fmt(snapshot.totalXp) + " / " + fmt(snapshot.nextLevelXp) + " EXP";
}

export function lifeTreeName(treeId) {
  return TREE_NAMES[treeId] ?? treeId;
}

export function lifeNodeView(node) {
  const definition = LIFE_SKILL_TREE_REGISTRY.get(node.nodeId);
  const name = definition?.displayName ?? node.nodeId;
  const prerequisites = node.prerequisites.map((entry) => {
    const def = LIFE_SKILL_TREE_REGISTRY.get(entry.nodeId);
    return (def?.displayName ?? entry.nodeId) + " " + entry.currentRank + "/" + entry.requiredRank;
  });
  const reasonText = node.canRankUp ? null : REASON_TEXT[node.unavailableReason] ?? "사용 불가";
  return Object.freeze({
    nodeId:node.nodeId,
    name,
    rankText:String(node.rank) + " / " + String(node.maxRank),
    costText:String(node.pointCost) + " SP",
    levelText:"생활 Lv." + String(node.requiredLifeLevel),
    prerequisites,
    canRankUp:node.canRankUp,
    reasonText,
    maxed:node.rank >= node.maxRank
  });
}

export function createLifeSkillPanel({
  panel,
  life,
  onStatus=()=>{},
  onOpenChange=()=>{},
  doc=globalThis.document
}={}) {
  if (!panel || !life) throw new Error("Life Skill panel requires panel and client");

  const el=(tag,className,text)=>{
    const node=doc.createElement(tag);
    if(className) node.className=className;
    if(text!==undefined) node.textContent=text;
    return node;
  };
  let open=false;
  let closeButton=null;

  async function runMutation(action) {
    const result=await action();
    if(result.outcome==="SUCCESS") onStatus("생활 스킬이 갱신됐어요.");
    else if(result.outcome==="REFUSED") onStatus(ERROR_TEXT[result.code] ?? "지금은 이 생활 스킬을 변경할 수 없어요.");
    else if(result.outcome!=="STALE") onStatus(ERROR_TEXT[result.code] ?? ERROR_TEXT.FAILED);
    return result;
  }

  function renderTabs(snapshot) {
    const tabs=el("div","life-tree-tabs");
    tabs.setAttribute("role","tablist");
    for(const tree of snapshot.trees) {
      const label=(TREE_ICONS[tree.treeId] ?? "🌱") + " " + lifeTreeName(tree.treeId) +
        (tree.status==="ACTIVE" ? "" : " · 준비중");
      const button=el("button","life-tree-tab",label);
      button.type="button";
      button.dataset.treeId=tree.treeId;
      button.dataset.status=tree.status;
      button.setAttribute("role","tab");
      button.setAttribute("aria-pressed",String(tree.treeId===life.selectedTreeId));
      button.addEventListener("click",()=>void life.selectTree(tree.treeId));
      tabs.append(button);
    }
    return tabs;
  }

  function renderNode(node) {
    const view=lifeNodeView(node);
    const card=el("li","life-skill-node" + (view.canRankUp ? " life-skill-node-ready" : ""));
    card.dataset.nodeId=view.nodeId;
    card.dataset.reason=node.unavailableReason ?? "";
    const head=el("div","life-skill-node-head");
    head.append(el("strong","life-skill-node-name",view.name),el("span","life-skill-node-rank",view.rankText));
    card.append(head);
    const meta=el("div","life-skill-node-meta");
    meta.append(el("span","",view.levelText),el("span","",view.costText));
    if(view.prerequisites.length) meta.append(el("span","life-skill-node-prereq","선행 · " + view.prerequisites.join(" · ")));
    card.append(meta);
    const foot=el("div","life-skill-node-foot");
    const state=el("span","life-skill-node-state",view.maxed ? "완료" : (view.reasonText ?? "해금 가능"));
    const pending=life.isPending("rank-up",view.nodeId);
    const button=el("button","life-skill-rank-button",pending ? "처리 중…" : (view.maxed ? "최대" : "+1 랭크"));
    button.type="button";
    button.disabled=!view.canRankUp || pending;
    button.addEventListener("click",()=>void runMutation(()=>life.rankUp(view.nodeId)));
    foot.append(state,button);
    card.append(foot);
    return card;
  }

  function render() {
    if(!open) return;
    const progression=life.state===LIFE_PROGRESSION_STATE.READY ? life.progression : null;
    const tree=life.state===LIFE_PROGRESSION_STATE.READY ? life.tree : null;

    const head=el("div","shop-panel-head");
    const titles=el("div","shop-panel-titles");
    const title=el("h2","","🌱 생활 성장");
    title.id="life-skill-panel-title";
    titles.append(title);
    if(progression) {
      titles.append(el("p","life-progression-summary",lifeProgressText(progression)));
      titles.append(el("p","life-sp-summary","스킬포인트 " + fmt(progression.skillPointsBalance) + " SP · 사용 " +
        fmt(progression.skillPointsSpent) + " SP"));
    }
    closeButton=el("button","profile-close","×");
    closeButton.type="button";
    closeButton.setAttribute("aria-label","생활 성장 닫기");
    closeButton.addEventListener("click",()=>setOpen(false));
    head.append(titles,closeButton);

    const body=el("div","shop-panel-body life-skill-panel-body");
    if(life.state===LIFE_PROGRESSION_STATE.SIGNED_OUT) {
      body.append(el("p","shop-empty","로그인한 INHAGAME 계정만 생활 성장을 이용할 수 있어요."));
    } else if(life.state===LIFE_PROGRESSION_STATE.LOADING) {
      body.append(el("p","shop-empty","생활 성장 정보를 불러오는 중…"));
    } else if(life.state===LIFE_PROGRESSION_STATE.UNAVAILABLE) {
      body.append(el("p","shop-empty","생활 성장 정보를 불러오지 못했어요."));
      const retry=el("button","shop-retry","다시 시도");
      retry.type="button";
      retry.addEventListener("click",()=>void life.refresh("retry"));
      body.append(retry);
    } else if(progression) {
      body.append(renderTabs(progression));
      if(!tree) {
        body.append(el("p","shop-empty","표시할 생활 스킬트리가 없어요."));
      } else {
        const treeHead=el("div","life-tree-head");
        const treeTitle=el("div","");
        treeTitle.append(
          el("strong","",(TREE_ICONS[tree.treeId] ?? "🌱") + " " + lifeTreeName(tree.treeId)),
          el("span","life-tree-status",tree.status==="ACTIVE" ? "ACTIVE" : "준비 중")
        );
        treeHead.append(treeTitle);
        if(tree.canReset) {
          const pending=life.isPending("reset",tree.treeId);
          const reset=el("button","life-tree-reset",pending ? "초기화 중…" : "트리 초기화 · +" + tree.spentPoints + " SP");
          reset.type="button";
          reset.disabled=pending;
          reset.addEventListener("click",()=>void runMutation(()=>life.resetTree(tree.treeId)));
          treeHead.append(reset);
        }
        body.append(treeHead);
        if(tree.status!=="ACTIVE") body.append(el("p","life-tree-note","이 생활 스킬트리는 아직 준비 중이에요. 노드 구조는 미리 볼 수 있어요."));
        const list=el("ul","life-skill-nodes");
        list.append(...tree.nodes.map(renderNode));
        body.append(list);
      }
    }

    panel.dataset.state=life.state;
    panel.replaceChildren(head,body);
  }

  function setOpen(next) {
    const value=Boolean(next);
    if(value===open) return open;
    open=value;
    panel.hidden=!open;
    if(!open) {
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if(life.accountId) void life.refresh("open");
    return true;
  }

  life.onChange(()=>render());
  panel.addEventListener("pointerdown",(event)=>event.stopPropagation());
  doc.addEventListener("keydown",(event)=>{ if(open && event.code==="Escape") setOpen(false); });

  return {
    get open(){ return open; },
    setOpen,render,
    status:()=>({ open,selectedTreeId:life.selectedTreeId })
  };
}
