(() => {
  // Only an explicit hub navigation is attributed to the hub. No account or browser ID crosses domains.
  const script = document.currentScript;
  const game = script?.dataset.game;
  const hosts = {
    "duck.inhagame.example": "classic",
    "induckup.inhagame.example": "induckup",
    "survival.inhagame.example": "survival",
    "grow.inhagame.example": "induck-grow",
    "inhagame.example": "campus"
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const params = new URL(location.href);
  const incoming = params.searchParams.get("ih_entry");
  const cacheKey = "inhagame-hub-entry-v1";
  let entry = incoming;
  // Stages the server already confirmed for this entry, so a new document in the same tab
  // (InduckUp home -> campaign, Survival reload) does not report them again.
  let confirmed = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    const fresh = saved?.game === game && Date.now() - saved.at < 30 * 60 * 1000;
    if (incoming && uuid.test(incoming)) {
      if (fresh && saved.entry === incoming) confirmed = saved.sent || [];
      else sessionStorage.setItem(cacheKey, JSON.stringify({ entry: incoming, game, at: Date.now() }));
    } else if (fresh) {
      entry = saved.entry;
      confirmed = saved.sent || [];
    }
  } catch { /* Private browsing may disable storage. */ }
  function remember(eventType) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (saved?.entry !== entry || saved.game !== game) return;
      saved.sent = [...new Set([...(saved.sent || []), eventType])];
      sessionStorage.setItem(cacheKey, JSON.stringify(saved));
    } catch { /* The server still rejects duplicates. */ }
  }
  if (incoming) {
    params.searchParams.delete("ih_entry");
    history.replaceState(history.state, "", params.pathname + params.search + params.hash);
  }
  if (!uuid.test(entry || "") || hosts[location.hostname] !== game) {
    window.InhaGameEntry = { landing() {}, play() {}, error() {}, result: () => false, clear() {}, retry() {}, ranked() {} };
    return;
  }
  const emitted = new Set(Array.isArray(confirmed) ? confirmed : []);
  function report(eventType) {
    if (emitted.has(eventType)) return false;
    emitted.add(eventType);
    const eventId = crypto.randomUUID();
    const body = JSON.stringify({ event_id: eventId, entry_id: entry, event_type: eventType, target: game });
    let attempt = 0;
    function send() {
      fetch("https://inhagame.example/api/hub-entry", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        keepalive: true, mode: "cors"
      }).then(response => {
        if (response.ok) remember(eventType);
        // 409: the click or the previous stage is not stored yet. Retry a few times.
        else if (response.status === 409 && attempt++ < 4) setTimeout(send, 700 * attempt);
      }).catch(() => { /* Gameplay must never depend on analytics. */ });
    }
    send();
    return true;
  }
  window.InhaGameEntry = {
    landing: () => report("game_landing"),
    play: () => report("game_play_start"),
    error: () => report("game_load_error"),
    result: () => report("game_first_result"),
    clear: () => report("game_first_clear"),
    retry: () => report("game_retry"),
    ranked: () => report("classic_ranked_start")
  };
  window.addEventListener("error", () => {
    if (!emitted.has("game_landing")) report("game_load_error");
  });
  window.addEventListener("unhandledrejection", () => {
    if (!emitted.has("game_landing")) report("game_load_error");
  });
  if (game === "classic") {
    const ready = () => {
      if (document.getElementById("startBtn")) report("game_landing");
      const resultPanel = document.getElementById("endOverlay");
      if (resultPanel) new MutationObserver(() => {
        if (resultPanel.classList.contains("hidden")) return;
        if (window.InhaGameEntry.result() &&
            document.getElementById("resultState")?.classList.contains("clear"))
          window.InhaGameEntry.clear();
      }).observe(resultPanel, { attributes: true, attributeFilter: ["class"] });
      document.getElementById("restartBtn")?.addEventListener("click", () => {
        if (emitted.has("game_first_result")) window.InhaGameEntry.retry();
      });
      const rankedMessage = document.getElementById("rankedLoadingMessage");
      if (rankedMessage) new MutationObserver(() => {
        if (rankedMessage.textContent?.includes("공식 기록 세션이 연결됐어요")) {
          window.InhaGameEntry.ranked();
        }
      }).observe(rankedMessage, { childList: true, characterData: true, subtree: true });
      document.getElementById("startBtn")?.addEventListener("click", () => {
        if (emitted.has("game_first_result")) window.InhaGameEntry.retry();
        const countdown = document.getElementById("countdownOverlay");
        if (!countdown) return;
        let wasCounting = !countdown.classList.contains("hidden");
        const observer = new MutationObserver(() => {
          if (!countdown.classList.contains("hidden")) wasCounting = true;
          if (wasCounting && countdown.classList.contains("hidden")) {
            observer.disconnect();
            const active = document.getElementById("homeGameBtn");
            if (active && !active.disabled) report("game_play_start");
          }
        });
        observer.observe(countdown, { attributes: true, attributeFilter: ["class"] });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
  }
  if (game === "induck-grow") {
    const ready = () => {
      report("game_landing");
      document.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        const action = button?.getAttribute("onclick")?.replace(/\s/g, "");
        if (action === "newGame()" || action === "continueGame()") {
          report("game_play_start");
        } else if ((action === "replaySame()" || action === "replayOther()") &&
                   emitted.has("game_first_result")) {
          report("game_retry");
        }
      });
      const finalScreen = document.getElementById("screen-final");
      if (finalScreen) new MutationObserver(() => {
        if (finalScreen.classList.contains("active")) report("game_first_result");
      }).observe(finalScreen, { attributes: true, attributeFilter: ["class"] });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
  }
})();