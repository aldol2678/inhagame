import { selectNearbyPlayers } from "./nearby-players.js";
import { Relationship } from "./social-client.js";

export function createNearbyPanel({ toggle, panel, getRemotes, getPosition, getZoneId, getSelfUserId,
  isBlocked, relationshipOf, getAvailability, onInspect, onWave, onOpen = () => {}, onOpenChange = () => {}, doc = document }) {
  let open = false;
  let visible = new Set();
  let timer = null;
  let lastKey = null;
  const make = (tag, text, className = "") => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function render() {
    if (!open) return;
    const state = getAvailability();
    const rows = state === "online" ? selectNearbyPlayers({
      remotes: getRemotes(), position: getPosition(), selfUserId: getSelfUserId(), zoneId: getZoneId(),
      blocked: isBlocked, previouslyVisible: visible
    }) : [];
    visible = new Set(rows.map(row => row.userId));
    const key = JSON.stringify([state, rows.map(row => [row.userId, row.sessionId, row.displayName,
      row.proximity, relationshipOf(row.userId)])]);
    if (key === lastKey) return;
    lastKey = key;
    const header = make("div", undefined, "nearby-head");
    const title = make("h2", `주변 ${rows.length}명`);
    const close = make("button", "×", "nearby-close");
    close.type = "button"; close.setAttribute("aria-label", "주변 닫기"); close.addEventListener("click", () => setOpen(false));
    header.append(title, close);
    const body = make("div", undefined, "nearby-list");
    if (state !== "online" || rows.length === 0) {
      const message = state === "guest" ? "로그인하면 주변 플레이어를 볼 수 있어요."
        : state === "indoor" ? "캠퍼스로 나가면 주변 플레이어를 볼 수 있어요."
          : state === "connecting" ? "현재 구역에 연결하는 중이에요."
            : state !== "online" ? "연결이 끊겼어요."
              : "15m 안에 다른 플레이어가 없어요.";
      body.append(make("p", message, "nearby-empty"));
    }
    for (const row of rows) {
      const button = make("button", undefined, "nearby-row");
      button.type = "button";
      button.dataset.userId = row.userId;
      const friend = relationshipOf(row.userId) === Relationship.FRIENDS;
      button.append(make("strong", row.displayName || "플레이어"), make("span", `${friend ? "친구 · " : ""}${row.proximity}`));
      button.addEventListener("click", () => {
        const opening = onInspect(row.sessionId);
        setOpen(false);
        void opening;
      });
      body.append(button);
    }
    const wave = make("button", "👋 근처에 손 흔들기", "nearby-wave");
    wave.type = "button";
    wave.disabled = state !== "online";
    wave.addEventListener("click", () => { setOpen(false); onWave(); });
    const hint = make("p", "손 흔들기는 주변 모두에게 보여요.", "nearby-hint");
    const focusedId = doc.activeElement?.dataset?.userId;
    panel.replaceChildren(header, body, wave, hint);
    if (focusedId) [...body.children].find(child => child.dataset?.userId === focusedId)?.focus?.();
  }

  function setOpen(next) {
    if (open === !!next) return open;
    open = !!next;
    panel.hidden = !open;
    onOpenChange(open);
    toggle.setAttribute("aria-expanded", String(open));
    clearInterval(timer); timer = null;
    if (open) {
      onOpen(); render(); timer = setInterval(render, 500);
    } else { visible.clear(); lastKey = null; toggle.focus?.(); }
    return open;
  }
  toggle.addEventListener("click", () => setOpen(!open));
  doc.addEventListener("keydown", event => { if (open && event.code === "Escape") setOpen(false); });
  return { get open() { return open; }, setOpen, render, destroy() { clearInterval(timer); } };
}
