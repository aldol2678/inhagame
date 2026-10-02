// Social S1-D2 · Personal Room HUD. DOM only; every decision comes from the Room Session status
// and the server (privacy RPC). It sits in the Tour slot (top-left), which rooms hide, so it never
// overlaps the Mini-map rail on the right or the mobile action buttons at the bottom.
//
// Owner:   🏠 내 방 · N명 · [🔒 비공개 | 👥 친구 공개] (tap to switch) · [나가기]
// Visitor: 🏠 <owner>의 방 · 방문 중 · 편집 불가 · (주인 부재) · [나가기]

export const ROOM_VISIBILITY_TEXT = Object.freeze({ friends: "👥 친구 공개", private: "🔒 비공개" });

export function createRoomHud({ root, onLeave = () => false, onEdit = null, onSetVisibility = async () => null, doc = document }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let state = null;
  let pending = false;
  let note = "";

  function render() {
    root.replaceChildren();
    if (!state?.active) { root.hidden = true; delete root.dataset.role; return; }
    root.hidden = false;
    root.dataset.role = state.role ?? "";
    const owner = state.role === "owner";
    const title = el("strong", "room-hud-title", owner ? "🏠 내 방" : `🏠 ${state.ownerDisplayName ?? "친구"}의 방`);
    const meta = el("span", "room-hud-meta");
    const parts = [];
    if (state.phase === "CHECKING") parts.push("입장 확인 중…");
    else if (state.phase === "DEGRADED") parts.push("연결 중…");
    else if (state.phase === "LOCAL") parts.push("오프라인 · 혼자 있는 중");
    else parts.push(`${state.count}명`);
    if (!owner) parts.push("방문 중 · 편집 불가");
    if (!owner && state.phase === "READY" && !state.ownerPresent) parts.push("주인 부재");
    meta.textContent = parts.join(" · ");
    root.append(title, meta);

    const actions = el("div", "room-hud-actions");
    if (owner) {
      const visibility = state.visibility === "private" ? "private" : "friends";
      const privacy = el("button", "room-hud-privacy", pending ? "변경 중…" : ROOM_VISIBILITY_TEXT[visibility]);
      privacy.type = "button";
      privacy.disabled = pending || state.phase === "CHECKING";
      privacy.setAttribute("aria-label", `공개 범위: ${ROOM_VISIBILITY_TEXT[visibility]}. 눌러서 바꾸기`);
      privacy.addEventListener("click", () => void toggleVisibility(visibility === "private" ? "friends" : "private"));
      actions.append(privacy);
      if (onEdit) {
        const edit = el("button", "room-hud-edit", "꾸미기"); edit.type = "button";
        edit.disabled = state.phase === "CHECKING";
        edit.addEventListener("click", () => onEdit()); actions.append(edit);
      }
    }
    const leave = el("button", "room-hud-leave", "나가기");
    leave.type = "button";
    leave.addEventListener("click", () => { onLeave(); });
    actions.append(leave);
    root.append(actions);
    if (note) root.append(el("small", "room-hud-note", note));
  }

  async function toggleVisibility(next) {
    if (pending || state?.role !== "owner") return false;
    pending = true;
    note = "";
    render();
    try {
      const result = await onSetVisibility(next);
      note = result ? (next === "private" ? "이제 나만 들어올 수 있어요." : "이제 친구가 방문할 수 있어요.") : "공개 범위를 바꾸지 못했어요.";
      return !!result;
    } catch {
      note = "공개 범위를 바꾸지 못했어요.";
      return false;
    } finally {
      pending = false;
      render();
    }
  }

  return {
    update(next) {
      const wasActive = state?.active === true;
      state = next ?? null;
      if (!state?.active || !wasActive) note = "";
      render();
    },
    toggleVisibility,
    get visible() { return !root.hidden; },
    get pending() { return pending; }
  };
}
