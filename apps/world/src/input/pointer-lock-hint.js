export function pointerLockHintModel(status = {}) {
  if (status?.finePointer !== true || status?.supported !== true || status?.desired !== true) {
    return Object.freeze({ visible: false, state: "HIDDEN", text: "" });
  }
  if (status.locked === true) {
    return Object.freeze({ visible: false, state: "LOCKED", text: "" });
  }
  if (status.pending === true) {
    return Object.freeze({ visible: true, state: "PENDING", text: "마우스 고정 중…" });
  }
  if (status.lastError) {
    return Object.freeze({
      visible: true,
      state: "FALLBACK",
      text: "마우스 고정을 사용할 수 없어 드래그로 시점을 조작합니다."
    });
  }
  if (status.awaitingGesture === true) {
    return Object.freeze({
      visible: true,
      state: "READY",
      text: "Esc로 커서 해제 · 게임 화면을 클릭하면 다시 고정"
    });
  }
  return Object.freeze({ visible: false, state: "HIDDEN", text: "" });
}

export function bindPointerLockHint(element) {
  if (!element) {
    return Object.freeze({
      update: () => pointerLockHintModel(),
      status: () => ({ visible: false, state: "HIDDEN", text: "" })
    });
  }

  let current = pointerLockHintModel();

  function update(status) {
    current = pointerLockHintModel(status);
    element.hidden = !current.visible;
    element.dataset.state = current.state;
    element.textContent = current.text;
    return current;
  }

  return Object.freeze({
    update,
    status: () => current
  });
}
