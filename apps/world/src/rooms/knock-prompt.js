// Housing H3 · owner-side knock prompt. DOM only; the answer is the server's (respond_room_knock_v1).
// It renders into a node the owner Room HUD keeps as its footer, so it shares the HUD's slot and layout.
// One knock at a time: "🚪 <friend>님이 노크했어요 · [들어오게 하기] [나중에]". A knock that expires
// while shown is dropped; later knocks wait in arrival order.

export const KNOCK_PROMPT_TEXT = Object.freeze({
  title: (name) => `🚪 ${name}님이 노크했어요`,
  accept: "들어오게 하기",
  decline: "나중에",
  answering: "전달하는 중…",
  failed: "대답을 전하지 못했어요. 다시 눌러 주세요."
});

export function createKnockPrompt({
  root, respond = async () => null, now = () => Date.now(), doc = globalThis.document
} = {}) {
  const queue = [];
  let current = null;
  let busy = false;
  let note = "";
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const expired = (knock) => {
    const at = Date.parse(knock?.expiresAt ?? "");
    return Number.isFinite(at) && at <= now();
  };

  function render() {
    root.replaceChildren();
    while (!current && queue.length) {
      const next = queue.shift();
      if (!expired(next)) current = next;
    }
    if (!current) { root.hidden = true; return; }
    root.hidden = false;
    root.setAttribute?.("role", "group");
    root.setAttribute?.("aria-live", "assertive");
    root.append(el("strong", "room-knock-title", KNOCK_PROMPT_TEXT.title(current.visitorDisplayName)));
    if (note) root.append(el("span", "room-knock-note", note));
    const actions = el("div", "room-knock-actions");
    for (const [accept, label, className] of [[true, KNOCK_PROMPT_TEXT.accept, "room-knock-accept"],
      [false, KNOCK_PROMPT_TEXT.decline, "room-knock-decline"]]) {
      const button = el("button", className, busy ? KNOCK_PROMPT_TEXT.answering : label);
      button.type = "button";
      button.disabled = busy;
      button.addEventListener("click", () => void answer(accept));
      actions.append(button);
    }
    root.append(actions);
  }

  async function answer(accept) {
    if (!current || busy) return false;
    const knock = current;
    busy = true; note = ""; render();
    try {
      await respond(knock, accept);
      if (current === knock) current = null;
      return true;
    } catch {
      note = KNOCK_PROMPT_TEXT.failed;
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  return {
    push(knock) {
      if (!knock?.knockId || current?.knockId === knock.knockId || queue.some(k => k.knockId === knock.knockId)) return false;
      queue.push(knock);
      if (!current) render();
      return true;
    },
    // Drop knocks that are no longer pending (expired, or the owner left the room).
    prune() {
      for (let i = queue.length - 1; i >= 0; i -= 1) if (expired(queue[i])) queue.splice(i, 1);
      if (current && !busy && expired(current)) { current = null; note = ""; }
      render();
    },
    // Keep only knocks the server still lists as pending (answered elsewhere, expired, withdrawn).
    retain(pendingIds) {
      const keep = new Set(pendingIds);
      for (let i = queue.length - 1; i >= 0; i -= 1) if (!keep.has(queue[i].knockId)) queue.splice(i, 1);
      if (current && !busy && !keep.has(current.knockId)) { current = null; note = ""; }
      render();
    },
    clear() { queue.length = 0; current = null; note = ""; busy = false; render(); },
    answer,
    get current() { return current; },
    get pending() { return queue.length + (current ? 1 : 0); }
  };
}
