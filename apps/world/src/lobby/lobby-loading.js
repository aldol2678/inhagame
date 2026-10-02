export const WORLD_LOADING_PHASES = Object.freeze({
  BOOT: Object.freeze({ progress: 6, message: "인하월드를 여는 중…" }),
  RENDERER: Object.freeze({ progress: 18, message: "그래픽 장치를 준비하고 있어요" }),
  WORLD: Object.freeze({ progress: 36, message: "캠퍼스 지형을 준비하고 있어요" }),
  CHARACTER: Object.freeze({ progress: 54, message: "인덕이를 불러오고 있어요" }),
  STREAMING: Object.freeze({ progress: 76, message: "캠퍼스 시설을 배치하고 있어요" }),
  ONLINE: Object.freeze({ progress: 90, message: "온라인 연결을 확인하고 있어요" }),
  READY: Object.freeze({ progress: 100, message: "정문을 열고 있어요" })
});

export function createWorldLoading({
  root,
  messageElement,
  detailElement,
  barElement,
  percentElement,
  continueButton,
  slowAfterMs = 6500,
  fadeMs = 240,
  clock = { now: () => Date.now() },
  timers = {
    setTimeout: globalThis.setTimeout?.bind(globalThis),
    clearTimeout: globalThis.clearTimeout?.bind(globalThis)
  }
} = {}) {
  if (!root) return null;
  const startedAt = clock.now();
  let phase = "BOOT";
  let essentialReady = false;
  let slow = false;
  let finished = false;

  const render = () => {
    const spec = WORLD_LOADING_PHASES[phase] ?? WORLD_LOADING_PHASES.BOOT;
    root.dataset.phase = phase;
    root.dataset.state = finished ? "DONE" : slow ? "SLOW" : "LOADING";
    if (messageElement) messageElement.textContent = spec.message;
    if (barElement) {
      barElement.style.width = `${spec.progress}%`;
      barElement.setAttribute?.("aria-valuenow", String(spec.progress));
    }
    if (percentElement) percentElement.textContent = `${spec.progress}%`;
    if (detailElement) detailElement.textContent = slow
      ? essentialReady
        ? "기본 월드는 준비됐어요. NPC와 온라인 기능은 입장 후 이어서 연결됩니다."
        : "조금 오래 걸리고 있어요. 필수 월드를 계속 준비하고 있습니다."
      : "필수 월드부터 준비하고, 소셜·NPC 기능은 뒤에서 이어서 연결합니다.";
    if (continueButton) continueButton.hidden = !(slow && essentialReady && !finished);
  };

  const slowTimer = timers.setTimeout?.(() => {
    if (finished) return;
    slow = true;
    render();
  }, slowAfterMs);

  const setPhase = (next) => {
    if (finished || !WORLD_LOADING_PHASES[next]) return false;
    const currentProgress = WORLD_LOADING_PHASES[phase]?.progress ?? 0;
    if (WORLD_LOADING_PHASES[next].progress < currentProgress) return false;
    phase = next;
    render();
    return true;
  };

  const setEssentialReady = (value = true) => {
    essentialReady = value === true;
    render();
    return essentialReady;
  };

  const finish = ({ degraded = false, early = false } = {}) => {
    if (finished) return false;
    finished = true;
    phase = "READY";
    timers.clearTimeout?.(slowTimer);
    render();
    if (detailElement) detailElement.textContent = early
      ? "기본 월드로 먼저 들어갑니다. 나머지 기능은 이어서 연결됩니다."
      : degraded
        ? "일부 부가 기능 없이 먼저 시작합니다."
        : "준비 완료";
    if (continueButton) continueButton.hidden = true;
    root.classList.add("is-leaving");
    timers.setTimeout?.(() => { root.hidden = true; }, fadeMs);
    return true;
  };

  const fail = (message = "월드를 시작하지 못했습니다.", detail = "브라우저 그래픽 지원과 네트워크 연결을 확인해 주세요.") => {
    timers.clearTimeout?.(slowTimer);
    slow = false;
    finished = false;
    root.dataset.state = "ERROR";
    if (messageElement) messageElement.textContent = message;
    if (detailElement) detailElement.textContent = detail;
    if (continueButton) continueButton.hidden = true;
    return true;
  };

  continueButton?.addEventListener?.("click", () => {
    if (essentialReady) finish({ degraded: true, early: true });
  });

  render();
  return {
    setPhase,
    setEssentialReady,
    finish,
    fail,
    status: () => ({
      phase,
      essentialReady,
      slow,
      finished,
      elapsedMs: Math.max(0, clock.now() - startedAt)
    })
  };
}

export function getWorldLoading() {
  return globalThis.__INHA_WORLD_LOADING__ ?? null;
}

if (typeof document !== "undefined") {
  globalThis.__INHA_WORLD_LOADING__ = createWorldLoading({
    root: document.getElementById("world-loading"),
    messageElement: document.getElementById("world-loading-message"),
    detailElement: document.getElementById("world-loading-detail"),
    barElement: document.getElementById("world-loading-bar"),
    percentElement: document.getElementById("world-loading-percent"),
    continueButton: document.getElementById("world-loading-continue")
  });
}
