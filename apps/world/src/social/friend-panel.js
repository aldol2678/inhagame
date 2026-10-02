// Compact friends panel: 친구 / 받은 요청 / 보낸 요청 / 차단한 사용자. DOM only.
// Freshness: the database is authoritative. The panel loads when opened, after every mutation,
// when the tab returns to the foreground, and every POLL_MS while open (paused when closed).
// No always-on realtime channel is used for friend requests.

import { AVATARS, SocialError } from "./social-client.js";

export const FRIEND_PANEL_POLL_MS = 30000;

const SECTIONS = Object.freeze([
  ["incoming", "받은 요청"], ["friends", "친구"], ["outgoing", "보낸 요청"], ["blocked", "차단한 사용자"]
]);

export function createFriendPanel({ toggle, panel, social, onRelationshipChange = () => {}, onOpenChange = () => {}, doc = document,
  fallbackFocus = () => toggle,
  timers = { setInterval: globalThis.setInterval?.bind(globalThis), clearInterval: globalThis.clearInterval?.bind(globalThis) } }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let open = false;
  let poll = null;
  let data = null;
  let hint = "";
  let loads = 0;

  const act = (label, op, userId) => {
    const b = el("button", "", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        const state = await social[op](userId);
        onRelationshipChange(userId, state);
        hint = "";
      } catch (error) {
        hint = error instanceof SocialError && error.code === "SIGNED_OUT" ? "로그인이 필요해요." : "잠시 후 다시 시도해 주세요.";
      }
      await refresh();
    });
    return b;
  };

  function render() {
    panel.replaceChildren();
    const header = el("div", "friend-panel-head");
    header.append(el("h2", "", "친구"));
    const close = el("button", "profile-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "친구 닫기");
    close.addEventListener("click", () => setOpen(false));
    header.append(close);
    panel.append(header);
    if (!data) { panel.append(el("p", "friend-empty", "불러오는 중…")); return; }
    for (const [key, title] of SECTIONS) {
      const list = data[key];
      if (key === "blocked" && !list.length) continue;
      const section = el("section", "friend-section");
      section.dataset.section = key;
      section.append(el("h3", "", `${title} ${list.length}`));
      if (!list.length) section.append(el("p", "friend-empty", "없어요."));
      for (const person of list) {
        const row = el("div", "friend-row");
        row.dataset.userId = person.userId;
        row.append(el("span", "friend-avatar", AVATARS[person.avatar] ?? AVATARS.classic));
        const names = el("span", "friend-names");
        names.append(el("strong", "", person.nickname ?? ""));
        if (person.title && key === "friends") names.append(el("small", "", person.title));
        row.append(names);
        if (key === "friends") row.append(act("친구 삭제", "remove", person.userId));
        if (key === "incoming") row.append(act("수락", "accept", person.userId), act("거절", "reject", person.userId));
        if (key === "outgoing") row.append(act("취소", "cancel", person.userId));
        if (key === "blocked") row.append(act("차단 해제", "unblock", person.userId));
        section.append(row);
      }
      panel.append(section);
    }
    if (hint) panel.append(el("p", "friend-hint", hint));
  }

  async function refresh() {
    if (!open) return null;
    const mine = ++loads;
    try {
      const next = await social.mine();
      if (mine === loads && open) { data = next; render(); }
    } catch (error) {
      if (mine === loads && open) {
        hint = error instanceof SocialError && error.code === "SIGNED_OUT" ? "로그인이 필요해요." : "목록을 불러오지 못했어요.";
        render();
      }
    }
    return data;
  }

  function setOpen(next) {
    const nextOpen = Boolean(next);
    const changed = open !== nextOpen;
    open = nextOpen;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (changed) onOpenChange(open);
    if (poll) { timers.clearInterval?.(poll); poll = null; }
    if (open) {
      data = null;
      render();
      poll = timers.setInterval?.(() => void refresh(), FRIEND_PANEL_POLL_MS) ?? null;
      return refresh();
    }
    panel.replaceChildren();
    fallbackFocus?.()?.focus?.();
    return Promise.resolve(null);
  }

  toggle.addEventListener("click", () => { if (social.available) void setOpen(!open); });
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => { if (open && event.code === "Escape") void setOpen(false); });
  doc.addEventListener("visibilitychange", () => { if (open && doc.visibilityState !== "hidden") void refresh(); });

  return {
    get open() { return open; },
    get data() { return data; },
    setOpen,
    refresh,
    setAvailable(available) {
      toggle.hidden = !available;
      if (!available && open) void setOpen(false);
    }
  };
}
