// INHA WORLD · Creature Manager P1 presentation.
// Reads only the Creature Manager client snapshot. Party changes are requested through the client,
// which calls the self-only server RPC; this panel never changes ownership or party state locally.

import { CREATURE_MANAGER_STATE } from "./creature-manager-client.js";

const SPECIES_NAME = Object.freeze({
  "creature.species.duck": "오리",
  "creature.species.pageling": "페이지링",
  "creature.species.volti": "볼티",
  "creature.species.porong": "포롱"
});

const FORM_NAME = Object.freeze({
  "creature.form.duck.base": "기본 오리"
});

const MEMORY_NAME = Object.freeze({
  "memory.combat.victory": "전투 승리",
  "memory.life.fishing": "낚시",
  "memory.life.gathering": "채집",
  "memory.life.archaeology": "고고학"
});

const shortId = id => id ? id.slice(0, 8) : "—";
export const creatureName = creature => SPECIES_NAME[creature?.speciesId] ?? creature?.speciesId ?? "알 수 없는 동료";
export const creatureFormName = creature => FORM_NAME[creature?.currentFormId] ?? creature?.currentFormId ?? "형태 정보 없음";

export function creatureMemories(snapshot, creatureId) {
  return (snapshot?.memories ?? [])
    .filter(memory => memory.creatureId === creatureId)
    .map(memory => Object.freeze({
      tag: memory.memoryTag,
      label: MEMORY_NAME[memory.memoryTag] ?? memory.memoryTag,
      count: memory.memoryCount
    }));
}

export function partySlotViews(snapshot) {
  const byId = new Map((snapshot?.creatures ?? []).map(creature => [creature.creatureId, creature]));
  const party = snapshot?.party ?? { activeCreatureId: null, reserveCreatureIds: [] };
  const ids = [party.activeCreatureId, party.reserveCreatureIds[0] ?? null, party.reserveCreatureIds[1] ?? null];
  return Object.freeze(ids.map((id, index) => Object.freeze({
    slot: index === 0 ? "ACTIVE" : `RESERVE ${index}`,
    creatureId: id,
    creature: id ? byId.get(id) ?? null : null
  })));
}

export function createCreaturePanel({
  panel,
  manager,
  onOpenChange = () => {},
  onStatus = () => {},
  onPartyChanged = () => {},
  doc = globalThis.document
} = {}) {
  if (!panel || !manager) throw new Error("Creature panel requires panel and manager");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let closeButton = null;

  function renderSlot(view) {
    const row = el("li", `creature-party-slot${view.creature ? "" : " creature-party-slot-empty"}`);
    row.dataset.slot = view.slot;
    row.append(el("span", "creature-slot-label", view.slot));
    if (view.creature) {
      const text = el("span", "creature-slot-creature");
      text.append(el("strong", "", creatureName(view.creature)), el("small", "", creatureFormName(view.creature)));
      row.append(text);
    } else {
      row.append(el("span", "creature-slot-empty-text", "빈 슬롯"));
    }
    return row;
  }

  function renderCreature(creature, snapshot) {
    const active = snapshot.party.activeCreatureId === creature.creatureId;
    const inParty = active || snapshot.party.reserveCreatureIds.includes(creature.creatureId);
    const card = el("li", `creature-card${active ? " creature-card-active" : ""}`);
    card.dataset.creatureId = creature.creatureId;

    const head = el("div", "creature-card-head");
    const title = el("div", "creature-card-title");
    title.append(el("strong", "", `🦆 ${creatureName(creature)}`), el("span", "", creatureFormName(creature)));
    head.append(title, el("span", "creature-card-xp", `XP ${Number(creature.totalXp).toLocaleString("en-US")}`));
    card.append(head);

    const meta = el("div", "creature-card-meta");
    meta.append(
      el("span", "", creature.bondEntitled ? "교감 완료" : "획득"),
      el("span", "", inParty ? (active ? "ACTIVE" : "RESERVE") : "파티 밖"),
      el("span", "", `ID ${shortId(creature.creatureId)}`)
    );
    card.append(meta);

    const memories = creatureMemories(snapshot, creature.creatureId);
    const memoryWrap = el("div", "creature-memory-list");
    if (!memories.length) memoryWrap.append(el("span", "creature-memory-empty", "아직 쌓인 기억이 없어요."));
    else for (const memory of memories) {
      memoryWrap.append(el("span", "creature-memory-chip", `${memory.label} ×${memory.count}`));
    }
    card.append(memoryWrap);

    const actions = el("div", "creature-card-actions");
    const activate = el("button", "shop-buy creature-activate", active ? "현재 ACTIVE" : "ACTIVE로 설정");
    activate.type = "button";
    activate.disabled = active || manager.mutating;
    activate.addEventListener("click", async () => {
      const result = await manager.setActive(creature.creatureId);
      if (result.outcome === "CHANGED") {
        onStatus(`🦆 ${creatureName(creature)}가 ACTIVE 동료가 되었어요.`);
        onPartyChanged(result.party);
      } else if (result.reason === "PARTY_FULL") {
        onStatus("Creature 파티가 가득 찼어요. 파티 교체 UI 확장은 다음 단계에서 지원해요.");
      } else if (result.reason === "REVISION_CONFLICT") {
        onStatus("Creature 파티가 다른 곳에서 바뀌어 최신 상태를 다시 불러왔어요.");
      } else if (!active && result.reason !== "PENDING") {
        onStatus("Creature 파티를 변경하지 못했어요.");
      }
    });
    actions.append(activate);
    card.append(actions);
    return card;
  }

  function render() {
    if (!open) return;
    const snapshot = manager.state === CREATURE_MANAGER_STATE.READY ? manager.snapshot : null;

    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", "🐾 동료 Creature");
    title.id = "creature-panel-title";
    titles.append(title);
    if (snapshot) titles.append(el("p", "creature-summary", `보유 ${snapshot.creatures.length} · 파티 revision ${snapshot.party.revision}`));
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Creature 관리 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body");
    if (manager.state === CREATURE_MANAGER_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", "로그인한 INHAGAME 계정만 동료 Creature를 관리할 수 있어요."));
    } else if (manager.state === CREATURE_MANAGER_STATE.LOADING) {
      body.append(el("p", "shop-empty", "동료 Creature를 불러오는 중…"));
    } else if (manager.state === CREATURE_MANAGER_STATE.UNAVAILABLE) {
      body.append(el("p", "shop-empty", "Creature 정보를 불러오지 못했어요."));
      const retry = el("button", "shop-retry", "다시 시도");
      retry.type = "button";
      retry.addEventListener("click", () => void manager.refresh("retry"));
      body.append(retry);
    } else if (snapshot) {
      const partySection = el("section", "creature-party-section");
      partySection.append(el("h3", "creature-section-title", "파티"));
      const slots = el("ul", "creature-party-slots");
      slots.append(...partySlotViews(snapshot).map(renderSlot));
      partySection.append(slots);
      body.append(partySection);

      const ownedSection = el("section", "creature-owned-section");
      ownedSection.append(el("h3", "creature-section-title", "보유 Creature"));
      if (!snapshot.creatures.length) {
        ownedSection.append(el("p", "shop-empty", "아직 동료가 없어요. 월드에서 관찰하고 교감해 보세요."));
      } else {
        const list = el("ul", "creature-cards");
        list.append(...snapshot.creatures.map(creature => renderCreature(creature, snapshot)));
        ownedSection.append(list);
      }
      body.append(ownedSection);
    }

    panel.dataset.state = manager.state;
    panel.replaceChildren(head, body);
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (!open) {
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if (manager.accountId) void manager.refresh("open");
    return true;
  }

  manager.onChange(() => render());
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  doc.addEventListener("keydown", event => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return Object.freeze({
    get open() { return open; },
    setOpen,
    render,
    status: () => ({ open })
  });
}
