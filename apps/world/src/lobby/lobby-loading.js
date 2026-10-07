export const WORLD_LOADING_PHASES = Object.freeze({
  BOOT: Object.freeze({ progress: 6, message: "인하월드를 여는 중…" }),
  RENDERER: Object.freeze({ progress: 18, message: "그래픽 장치를 준비하고 있어요" }),
  WORLD: Object.freeze({ progress: 36, message: "캠퍼스 지형을 준비하고 있어요" }),
  CHARACTER: Object.freeze({ progress: 54, message: "인덕이를 불러오고 있어요" }),
  STREAMING: Object.freeze({ progress: 76, message: "캠퍼스 시설을 배치하고 있어요" }),
  ONLINE: Object.freeze({ progress: 90, message: "온라인 연결을 확인하고 있어요" }),
  ASSETS: Object.freeze({ progress: 94, message: "캐릭터 모델을 마저 준비하고 있어요" }),
  RENDERING: Object.freeze({ progress: 98, message: "첫 화면을 렌더링하고 있어요" }),
  READY: Object.freeze({ progress: 100, message: "정문을 열고 있어요" })
});

export function createWorldLoading({
  root,
  messageElement,
  detailElement,
  barElement,
  percentElement,
  continueButton,
  interactionRoot,
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
  let renderReady = false;
  let slow = false;
  let finished = false;
  if (interactionRoot) interactionRoot.inert = true;

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
      ? "조금 오래 걸리고 있어요. 화면이 준비될 때까지 로딩을 계속합니다."
      : "캐릭터와 첫 화면 렌더링이 끝나면 접속 화면이 열립니다.";
    if (continueButton) continueButton.hidden = true;
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

  const setRenderReady = (value = true) => { renderReady = value === true; return renderReady; };

  const finish = ({ degraded = false } = {}) => {
    if (finished || !essentialReady || !renderReady) return false;
    finished = true;
    phase = "READY";
    timers.clearTimeout?.(slowTimer);
    render();
    if (detailElement) detailElement.textContent = degraded
      ? "일부 부가 기능 없이 먼저 시작합니다."
      : "준비 완료";
    if (continueButton) continueButton.hidden = true;
    if (interactionRoot) interactionRoot.inert = false;
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

  render();
  return {
    setPhase,
    setEssentialReady,
    setRenderReady,
    finish,
    fail,
    status: () => ({
      phase,
      essentialReady,
      renderReady,
      slow,
      finished,
      elapsedMs: Math.max(0, clock.now() - startedAt)
    })
  };
}

// Wait for actual scene frames after critical assets settle, not just JS initialization.
// postrender precedes PlayCanvas frameEnd, so drain WebGPU in a microtask after submission.
export function waitForWorldRender({
  app,
  ready = Promise.resolve(),
  isSceneReady = () => true,
  renderedFrames = 3,
  timeoutMs = 60000,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  timers = globalThis
} = {}) {
  return new Promise((resolve, reject) => {
    let assetsReady = false;
    let frames = 0;
    let draining = false;
    let settled = false;
    const cleanup = () => {
      timers.clearTimeout(timeout);
      app.off("postrender", onRender);
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({ renderedFrames: frames });
    };
    const onRender = () => {
      if (settled || draining || !assetsReady) return;
      try {
        if (!isSceneReady()) { frames = 0; return; }
        if (++frames < renderedFrames) return;
        draining = true;
        Promise.resolve().then(async () => {
          await app.graphicsDevice?.wgpu?.queue?.onSubmittedWorkDone?.();
          // Leave a browser paint opportunity while the opaque loader is still present.
          requestFrame(() => requestFrame(() => finish()));
        }).catch(finish);
      } catch (error) { finish(error); }
    };
    const timeout = timers.setTimeout(() => finish(new Error("Initial world rendering timed out")), timeoutMs);
    app.on("postrender", onRender);
    Promise.resolve(ready).then(() => { assetsReady = true; }, finish);
  });
}

export function getWorldLoading() {
  return globalThis.__INHA_WORLD_LOADING__ ?? null;
}

export function installWorldBootDiagnostics({ target = globalThis, loading = getWorldLoading() } = {}) {
  if (!target?.addEventListener || !loading) return () => {};
  let bootEntered = false;
  const safeText = value => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  const report = (kind, value) => {
    if (bootEntered) return;
    const message = safeText(value?.message ?? value?.reason?.message ?? value?.reason ?? value);
    loading.fail(
      "초기 로딩 중 오류가 발생했습니다.",
      `진단: ${kind}${message ? ` · ${message}` : ""} · 새로고침 후에도 반복되면 이 문구를 알려주세요.`
    );
  };
  const onError = event => report("BOOT_SCRIPT_ERROR", event?.error ?? event?.message);
  const onRejection = event => report("BOOT_PROMISE_REJECTION", event);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return {
    markBootEntered() { bootEntered = true; },
    destroy() {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
    }
  };
}

if (typeof document !== "undefined") {
  globalThis.__INHA_WORLD_LOADING__ = createWorldLoading({
    root: document.getElementById("world-loading"),
    messageElement: document.getElementById("world-loading-message"),
    detailElement: document.getElementById("world-loading-detail"),
    barElement: document.getElementById("world-loading-bar"),
    percentElement: document.getElementById("world-loading-percent"),
    continueButton: document.getElementById("world-loading-continue"),
    interactionRoot: document.getElementById("world-lobby")
  });
  globalThis.__INHA_WORLD_BOOT_DIAGNOSTICS__ = installWorldBootDiagnostics();
}
