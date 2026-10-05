export function createAccompanyPanel({ panel, controller, getSelfUserId, doc = document }) {
  const node = (tag, text) => { const element = doc.createElement(tag); element.textContent = text; return element; };
  function action(label, run) {
    const button = node("button", label); button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if ((await run()) === false) render("지금은 함께 갈 수 없어요. 같은 장소에서 다시 시도해 주세요.");
      } catch { render("지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요."); }
      finally { button.disabled = false; }
    });
    return button;
  }
  function render(error = "") {
    const { session, canRestore } = controller.status();
    panel.replaceChildren();
    panel.hidden = !session && !canRestore;
    if (panel.hidden) return;
    if (session) {
      const incoming = session.inviteeId === getSelfUserId();
      const title = session.state === "active"
        ? `${session.peerName}님과 ${controller.poiName}로 함께 가는 중`
        : incoming ? `${session.peerName}님이 ${controller.poiName}까지 함께 가자고 해요`
          : `${session.peerName}님의 응답을 기다리고 있어요`;
      panel.append(node("strong", title));
      const actions = node("div", ""); actions.className = "accompany-actions";
      if (session.state === "offered" && incoming) {
        actions.append(action("수락", () => controller.respond(true)), action("거절", () => controller.respond(false)));
      } else actions.append(action(session.state === "active" ? "그만두기" : "제안 취소", () => controller.end()));
      panel.append(actions);
    } else if (canRestore) {
      panel.append(node("strong", "동행이 끝났어요."), action("이전 목적지 다시 안내", () => controller.restorePrior()));
    }
    if (error) { const message = node("p", error); message.setAttribute("role", "status"); panel.append(message); }
  }
  controller.onChange(() => render());
  render();
  return { render };
}
