// INHA WORLD · Life Skill Book panel. Presentation only: ranks, costs, lock reasons,
// reset availability and cooldown come from the server views in life-skill-book-client.js. Names come
// from the code Registries; an id the Registry does not know is shown as-is, never hidden or guessed.
// Only Fishing P1's two implemented effects have verified display copy. The server still applies
// every effect at cast start; this panel never sends modifiers or predicts an attempt's timing.
// Buttons are enabled only when the server said canUnlock / canReset; the server re-checks on click.

import { LIFE_SKILL_REGISTRY } from "./life-skill-registry.js";
import { LIFE_SKILL_TREE_REGISTRY } from "./life-progression-registry.js";
import { LIFE_SKILL_BOOK_STATE } from "./life-skill-book-client.js";

export const LIFE_SKILL_BOOK_TEXT = Object.freeze({
  title: "📘 생활 스킬",
  signedOut: "로그인한 INHAGAME 계정만 생활 스킬을 볼 수 있어요.",
  loading: "생활 스킬을 불러오는 중…",
  unavailable: "생활 스킬을 불러오지 못했어요.",
  retry: "다시 시도",
  empty: "아직 열린 생활 스킬이 없어요.",
  back: "← 목록",
  treeLoading: "스킬트리를 불러오는 중…",
  treeUnavailable: "스킬트리를 불러오지 못했어요.",
  treeEmpty: "아직 공개된 스킬트리 노드가 없어요.",
  unlock: "익히기",
  rankUp: "랭크 업",
  maxRank: "최고 랭크",
  working: "처리하는 중…",
  reset: "트리 초기화 (무료)",
  resetConfirm: "정말 초기화할까요? 한 번 더 누르면 초기화돼요",
  resetEmpty: "초기화할 투자 SP가 없어요",
  failed: "요청을 처리하지 못했어요. 다시 시도해 주세요.",
  hiddenPrerequisite: "미공개 노드",
  fishingEffectTiming: "보유 랭크 기준이에요. 효과 변경은 다음 낚시 시작부터 적용돼요. 진행 중인 낚시는 바뀌지 않아요."
});

// Mirrors private.world_fishing_skill_effects_v1, not the Registry's placeholder descriptions.
// Fail closed if a future server view changes this version's supported rank contract.
const FISHING_EFFECTS_P1 = Object.freeze({
  "life.node.fishing.steady_hands": Object.freeze({
    perRank: "랭크당 입질 후 반응 시간 +250ms",
    amount: (rank) => `반응 시간 +${rank * 250}ms`
  }),
  "life.node.fishing.fish_sense": Object.freeze({
    perRank: "랭크당 입질 대기 시간 -250ms",
    amount: (rank) => `입질 대기 시간 -${rank * 250}ms`,
    limit: "대기 범위의 최솟값·최댓값에 적용돼요. 대기는 1ms 미만으로 줄어들지 않아요."
  })
});

/** Copy only: current server-owned rank → the verified P1 modifier, never a gameplay input. */
export function fishingEffectLines(node) {
  const effect = Object.hasOwn(FISHING_EFFECTS_P1, node?.nodeId) ? FISHING_EFFECTS_P1[node.nodeId] : null;
  if (!effect || node.maxRank !== 3 || !Number.isInteger(node.rank) || node.rank < 0 || node.rank > 3) return [];
  return [
    effect.perRank,
    `현재 · 랭크 ${node.rank}/${node.maxRank} · ${node.rank === 0 ? "미보유 (효과 없음)" : effect.amount(node.rank)}`,
    node.rank < node.maxRank
      ? `다음 · 랭크 ${node.rank + 1}/${node.maxRank} · ${effect.amount(node.rank + 1)}`
      : "다음 · 최대 단계에 도달했어요",
    `최대 · 랭크 ${node.maxRank}/${node.maxRank} · ${effect.amount(node.maxRank)}`,
    ...(effect.limit ? [effect.limit] : [])
  ];
}

const LOCK_TEXT = Object.freeze({
  MAX_RANK: () => "최고 랭크",
  PREREQUISITE: () => "선행 노드가 필요해요",
  LIFE_LEVEL: () => "생활 레벨이 부족해요",
  SKILL_LEVEL: (node) => `스킬 Lv ${node.requiredSkillLevel} 필요`,
  SP: (node) => `SP ${node.nextRankCost} 필요`
});

const REFUSAL_TEXT = Object.freeze({
  LIFE_SP_INSUFFICIENT: "SP가 부족해요.",
  LIFE_NODE_PREREQUISITE_LOCKED: "선행 노드가 필요해요.",
  LIFE_SKILL_LEVEL_REQUIRED: "스킬 레벨이 부족해요.",
  LIFE_LEVEL_REQUIRED: "생활 레벨이 부족해요.",
  LIFE_NODE_MAX_RANK: "이미 최고 랭크예요.",
  LIFE_TREE_RESET_COOLDOWN: "아직 다시 초기화할 수 없어요.",
  LIFE_TREE_RESET_EMPTY: "초기화할 투자 SP가 없어요.",
  LIFE_SKILL_NOT_FOUND: "지금은 열려 있지 않은 생활 스킬이에요.",
  LIFE_NODE_NOT_FOUND: "지금은 열려 있지 않은 노드예요."
});

export const skillName = (skillId) => LIFE_SKILL_REGISTRY.get(skillId)?.displayName ?? skillId;
export const nodeName = (nodeId) => LIFE_SKILL_TREE_REGISTRY.get(nodeId)?.displayName ?? nodeId;

/** "XP 1200 / 1500" for the current level band, or "최고 레벨 · XP 19500". Display text of server numbers. */
export function xpLine(skill) {
  return skill.isMaxLevel ? `최고 레벨 · XP ${skill.totalXp}` : `XP ${skill.totalXp} / ${skill.nextLevelXp}`;
}

/** Server ISO time → local display string. Display only; the server decides the cooldown. */
export function resetTimeText(iso, locale = "ko-KR") {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso
    : date.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function lockText(node) {
  return node.canUnlock ? null : (LOCK_TEXT[node.lockReason]?.(node) ?? node.lockReason);
}

export function createLifeSkillBookPanel({ panel, book, onOpenChange = () => {}, doc = globalThis.document } = {}) {
  if (!panel || !book) throw new Error("Life Skill Book panel requires its panel and book client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick, disabled = false) => {
    const node = el("button", className, text);
    node.type = "button";
    node.disabled = disabled;
    node.addEventListener("click", () => { if (!node.disabled) onClick(); });
    return node;
  };

  let open = false;
  let closeButton = null;
  let notice = null;
  let confirmReset = false;

  function noticeFor(result) {
    if (result.outcome === "REFUSED") return REFUSAL_TEXT[result.code] ?? LIFE_SKILL_BOOK_TEXT.failed;
    if (result.outcome === "FAILED") return LIFE_SKILL_BOOK_TEXT.failed;
    return null;
  }

  function renderSkillList(body, snapshot) {
    if (!snapshot.skills.length) {
      body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.empty));
      return;
    }
    const list = el("ul", "life-skill-list");
    for (const skill of snapshot.skills) {
      const item = el("li", "inventory-item life-skill-row");
      item.dataset.skillId = skill.skillId;
      const openButton = button("life-skill-open", `${skillName(skill.skillId)} · Lv ${skill.level} ›`, () => {
        notice = null;
        confirmReset = false;
        void book.selectSkill(skill.skillId);
      });
      item.append(openButton, el("p", "inventory-item-description", xpLine(skill)),
        el("p", "inventory-item-description life-skill-sp", `SP ${skill.sp.available} / ${skill.sp.earned}`));
      list.append(item);
    }
    body.append(list);
  }

  function renderNode(node) {
    const card = el("li", `inventory-item life-node${node.canUnlock ? " life-node-ready" : ""}`);
    card.dataset.nodeId = node.nodeId;
    card.dataset.lockReason = node.lockReason ?? "";
    card.append(el("strong", "inventory-item-name", `${nodeName(node.nodeId)} · ${node.rank}/${node.maxRank}`));
    for (const line of fishingEffectLines(node)) {
      card.append(el("p", "inventory-item-description life-node-effect", line));
    }
    const facts = [`스킬 Lv ${node.requiredSkillLevel}`];
    if (node.nextRankCost !== null) facts.push(`다음 랭크 SP ${node.nextRankCost}`);
    card.append(el("p", "inventory-item-description life-node-facts", facts.join(" · ")));
    if (node.prerequisites.length) {
      const prerequisites = el("ul", "life-node-prerequisites");
      for (const p of node.prerequisites) {
        const name = p.visible ? nodeName(p.nodeId) : LIFE_SKILL_BOOK_TEXT.hiddenPrerequisite;
        const row = el("li", p.met ? "life-prerequisite-met" : "life-prerequisite-missing",
          `${p.met ? "✓" : "✗"} ${name} 랭크 ${p.requiredRank}`);
        prerequisites.append(row);
      }
      card.append(prerequisites);
    }
    const lock = lockText(node);
    if (lock && node.lockReason !== "MAX_RANK") card.append(el("p", "shop-hint life-node-lock", lock));
    const label = node.rank >= node.maxRank ? LIFE_SKILL_BOOK_TEXT.maxRank
      : book.pending ? LIFE_SKILL_BOOK_TEXT.working
      : node.rank === 0 ? LIFE_SKILL_BOOK_TEXT.unlock : LIFE_SKILL_BOOK_TEXT.rankUp;
    card.append(button("shop-offer-buy life-node-unlock", label, async () => {
      notice = null;
      confirmReset = false;
      notice = noticeFor(await book.unlockNode(node.nodeId));
      render();
    }, !node.canUnlock || book.pending));
    return card;
  }

  function renderTree(body, tree) {
    const skill = tree.skill;
    const header = el("div", "inventory-item life-tree-summary");
    header.append(el("strong", "inventory-item-name", `${skillName(skill.skillId)} · Lv ${skill.level}`),
      el("p", "inventory-item-description", xpLine(skill)),
      el("p", "inventory-item-description life-skill-sp", `사용 가능 SP ${skill.sp.available} / 획득 ${skill.sp.earned}`));
    body.append(header);

    if (tree.nodes.some((node) => fishingEffectLines(node).length)) {
      header.append(el("p", "inventory-item-description life-tree-effect-timing", LIFE_SKILL_BOOK_TEXT.fishingEffectTiming));
    }

    if (!tree.nodes.length) body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.treeEmpty));
    else {
      const nodes = el("ul", "life-node-list");
      const ordered = [...tree.nodes].sort((a, b) =>
        a.requiredSkillLevel - b.requiredSkillLevel || a.nodeId.localeCompare(b.nodeId));
      for (const node of ordered) nodes.append(renderNode(node));
      body.append(nodes);
    }

    const reset = el("div", "inventory-item life-tree-reset");
    reset.dataset.canReset = String(tree.reset.canReset);
    if (tree.reset.resetBlockedBy === "COOLDOWN" && tree.reset.nextResetAt) {
      reset.append(el("p", "inventory-item-description", `다음 초기화 가능: ${resetTimeText(tree.reset.nextResetAt)}`));
    } else if (tree.reset.resetBlockedBy === "EMPTY") {
      reset.append(el("p", "inventory-item-description", LIFE_SKILL_BOOK_TEXT.resetEmpty));
    }
    reset.append(button("shop-retry life-tree-reset-button",
      book.pending ? LIFE_SKILL_BOOK_TEXT.working : confirmReset ? LIFE_SKILL_BOOK_TEXT.resetConfirm : LIFE_SKILL_BOOK_TEXT.reset,
      async () => {
        if (!confirmReset) { confirmReset = true; render(); return; }
        confirmReset = false;
        notice = noticeFor(await book.resetTree(skill.skillId));
        render();
      }, !tree.reset.canReset || book.pending));
    body.append(reset);
  }

  function render() {
    if (!open) return;
    const snapshot = book.state === LIFE_SKILL_BOOK_STATE.READY ? book.book : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", LIFE_SKILL_BOOK_TEXT.title);
    title.id = "life-skill-book-title";
    titles.append(title);
    if (snapshot) titles.append(el("p", "shop-panel-level", `생활 레벨 ${snapshot.lifeLevel.level}`));
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "생활 스킬 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body life-skill-book-body");
    if (book.state === LIFE_SKILL_BOOK_STATE.SIGNED_OUT) body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.signedOut));
    else if (book.state === LIFE_SKILL_BOOK_STATE.LOADING) body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.loading));
    else if (!snapshot) {
      body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.unavailable),
        button("shop-retry", LIFE_SKILL_BOOK_TEXT.retry, () => void book.refresh("retry")));
    } else if (book.selectedSkillId) {
      body.append(button("shop-retry life-skill-back", LIFE_SKILL_BOOK_TEXT.back, () => {
        notice = null;
        confirmReset = false;
        book.clearSelection();
      }));
      if (book.treeState === LIFE_SKILL_BOOK_STATE.UNAVAILABLE) {
        body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.treeUnavailable),
          button("shop-retry life-tree-retry", LIFE_SKILL_BOOK_TEXT.retry, () => {
            notice = null;
            confirmReset = false;
            void book.selectSkill(book.selectedSkillId);
          }));
      } else if (book.tree?.skill.skillId === book.selectedSkillId) renderTree(body, book.tree);
      else body.append(el("p", "shop-empty", LIFE_SKILL_BOOK_TEXT.treeLoading));
    } else renderSkillList(body, snapshot);
    if (notice) body.append(el("p", "shop-hint life-skill-notice", notice));
    panel.dataset.state = book.state;
    panel.dataset.treeState = book.treeState ?? "";
    panel.dataset.skill = book.selectedSkillId ?? "";
    panel.replaceChildren(head, body);
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (!open) {
      notice = null;
      confirmReset = false;
      book.clearSelection();
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    // Opening re-reads the server views; it never acts.
    if (book.accountId) void book.refresh("open");
    return true;
  }

  book.onChange(() => render());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    setOpen,
    render,
    get open() { return open; },
    status() { return { open, state: book.state, selectedSkillId: book.selectedSkillId }; }
  };
}
