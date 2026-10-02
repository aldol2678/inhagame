// Compact local-chat UI: toggle button, one-line input, short recent feed. DOM only.
// All chat text is rendered with textContent (never innerHTML). The input is a real <input>,
// so PlayerController, the V camera toggle and emote shortcuts ignore keys typed into it.
// Enter opens/sends (not while an IME is composing), Esc closes and hands the keys back.

import { CHAT_MAX_LENGTH } from "./local-chat.js";

export const CHAT_FEED_VISIBLE = 5;
export const CHAT_FEED_EXPANDED = 12;
export const CHAT_PREVIEW_MS = 8000;

const FEEDBACK = Object.freeze({
  sent: "",
  empty: "",
  too_long: `${CHAT_MAX_LENGTH}자까지 보낼 수 있어요.`,
  malformed: "보낼 수 없는 메시지예요.",
  rate_limited: "잠시 후에 보내 주세요. (5초에 3개까지)",
  repeated: "같은 메시지를 연달아 보낼 수 없어요.",
  moderated: "보낼 수 없는 표현이 있어요.",
  offline: "온라인 연결이 돌아오면 다시 보내 주세요.",
  signed_out: "INHAGAME에 로그인하면 채팅할 수 있어요.",
  local_room: "실내 공간은 아직 혼자만 있는 공간이라 채팅이 연결되지 않아요."
});

const isTyping = (target) => !!target?.closest?.("input, textarea, select, [contenteditable]");

export function createChatPanel({
  toggle,
  form,
  input,
  feedList,
  hint,
  getChat,
  onFocusChat = () => {},
  onOpenChange = () => {},
  shouldIgnoreShortcut = () => false,
  doc = document,
  win = globalThis.window
}) {
  let open = false;
  let feedEntries = [];
  let fadeTimer = null;
  let previewFaded = false;

  const setTimer = typeof win?.setTimeout === "function" ? win.setTimeout.bind(win) : null;
  const clearTimer = typeof win?.clearTimeout === "function" ? win.clearTimeout.bind(win) : null;

  function clearPreviewTimer() {
    if (fadeTimer == null) return;
    clearTimer?.(fadeTimer);
    fadeTimer = null;
  }

  function setPreviewFaded(next) {
    previewFaded = Boolean(next);
    feedList.setAttribute("data-faded", String(previewFaded));
  }

  function schedulePreviewFade() {
    clearPreviewTimer();
    if (open || feedEntries.length === 0 || !setTimer) return;
    fadeTimer = setTimer(() => {
      fadeTimer = null;
      if (open || feedEntries.length === 0) return;
      setPreviewFaded(true);
    }, CHAT_PREVIEW_MS);
  }

  function renderCurrentFeed({ resetFade = false } = {}) {
    const limit = open ? CHAT_FEED_EXPANDED : CHAT_FEED_VISIBLE;
    const recent = feedEntries.slice(-limit);
    feedList.replaceChildren();
    for (const entry of recent) {
      const item = doc.createElement("li");
      if (entry.self) item.className = "chat-self";
      const name = doc.createElement("span");
      name.className = "chat-name";
      name.textContent = entry.name;
      const text = doc.createElement("span");
      text.className = "chat-text";
      text.textContent = entry.text;
      item.append(name, text);
      feedList.append(item);
    }
    feedList.hidden = recent.length === 0;
    feedList.setAttribute("data-mode", open ? "EXPANDED" : "PREVIEW");

    if (open || resetFade) setPreviewFaded(false);
    if (open) clearPreviewTimer();
    else if (resetFade) schedulePreviewFade();
  }

  function setOpen(next, { focus = true } = {}) {
    const chat = getChat();
    if (next && !chat?.signedIn) { hint.textContent = FEEDBACK.signed_out; return false; }
    const changed = open !== next;
    open = next;
    form.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    renderCurrentFeed({ resetFade: true });
    if (open) {
      if (changed) onOpenChange(true);
      onFocusChat();
      if (focus) input.focus?.();
    } else {
      input.blur?.();
      hint.textContent = "";
      if (changed) onOpenChange(false);
    }
    return true;
  }

  function renderFeed(entries) {
    feedEntries = Array.isArray(entries) ? entries : [];
    renderCurrentFeed({ resetFade: true });
  }

  function send() {
    const chat = getChat();
    if (!chat) return "signed_out";
    if (!input.value.trim()) {
      input.value = "";
      setOpen(false);
      return "empty";
    }
    const { result } = chat.submit(input.value);
    hint.textContent = FEEDBACK[result] ?? "";
    if (result === "sent") {
      input.value = "";
      setOpen(false);
    }
    return result;
  }

  function refreshAvailability() {
    const chat = getChat();
    const signedIn = !!chat?.signedIn;
    toggle.setAttribute("aria-disabled", String(!signedIn));
    toggle.title = signedIn ? "채팅 (Enter)" : FEEDBACK.signed_out;
    toggle.classList?.[signedIn ? "remove" : "add"]("chat-disabled");
    if (!signedIn && open) setOpen(false);
  }

  toggle.addEventListener("click", () => {
    if (!getChat()?.signedIn) { hint.textContent = FEEDBACK.signed_out; return; }
    setOpen(!open);
  });
  for (const element of [toggle, form]) element.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") { event.preventDefault?.(); send(); return; }
    if (event.code === "Escape") { event.preventDefault?.(); setOpen(false); }
  });
  form.addEventListener("submit", (event) => { event.preventDefault?.(); send(); });
  doc.addEventListener("keydown", (event) => {
    if (open || shouldIgnoreShortcut() || event.repeat || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
    if (!getChat()?.signedIn) return;
    event.preventDefault?.();
    setOpen(true);
  });

  return {
    get open() { return open; },
    get previewFaded() { return previewFaded; },
    get renderedCount() { return feedList.children.length; },
    setOpen,
    send,
    renderFeed,
    refreshAvailability
  };
}
