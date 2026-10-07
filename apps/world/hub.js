(() => {
  const classicEventBadge = document.getElementById("classicEventBadge");
  const classicEventEnd = Date.parse("2026-09-27T23:59:59.999+09:00");
  function updateClassicEventBadge() {
    if (classicEventBadge) classicEventBadge.hidden = Date.now() > classicEventEnd;
  }
  updateClassicEventBadge();
  const telemetry = window.InhaHubTelemetry;
  telemetry?.track("hub_visit", "home");
  setInterval(updateClassicEventBadge, 60000);
  const pages = new Set(["home", "ranking", "friends", "messages", "account", "settings"]);
  const storageKey = "inhagame-campus-settings-v1";
  const deviceSettingsKey = "inhagame-device-settings-v2";
  const sideInput = document.getElementById("joystick-side");
  const status = document.getElementById("settings-status");

  function render() {
    const requested = location.hash.slice(1);
    const current = pages.has(requested) ? requested : "home";
    document.querySelectorAll("[data-view]").forEach(view => {
      view.hidden = view.dataset.view !== current;
    });
    document.querySelectorAll("[data-panel]").forEach(button => {
      if (button.closest("nav")) {
        if (button.dataset.panel === current) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });
    document.title = current === "home" ? "INHAGAME · 인하오리 게임 허브" :
      `${{ ranking: "랭킹", friends: "친구", messages: "쪽지", account: "계정", settings: "설정" }[current]} · INHAGAME`;
  }

  document.querySelectorAll("[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
      if (location.hash === `#${button.dataset.panel}`) return;
      location.hash = button.dataset.panel;
      window.scrollTo(0, 0);
    });
  });

  try {
    const legacy = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const device = JSON.parse(localStorage.getItem(deviceSettingsKey) || "{}");
    const side = ["left", "right"].includes(legacy?.side)
      ? legacy.side
      : device?.controls?.joystickSide;
    if (["left", "right"].includes(side)) sideInput.value = side;
  } catch {
    status.textContent = "이 브라우저에서는 설정을 불러올 수 없습니다.";
  }

  function save() {
    try {
      const side = sideInput.value;
      // Registry v2 is the new device authority. Keep the v1 mirror during the rollback window.
      let device = {};
      try { device = JSON.parse(localStorage.getItem(deviceSettingsKey) || "{}"); } catch { device = {}; }
      if (!device || typeof device !== "object" || Array.isArray(device)) device = {};
      const controls = device.controls && typeof device.controls === "object" && !Array.isArray(device.controls)
        ? device.controls : {};
      localStorage.setItem(deviceSettingsKey, JSON.stringify({
        ...device,
        schemaVersion: 2,
        controls: { ...controls, joystickSide: side }
      }));

      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { saved = {}; }
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
      delete saved.size;
      localStorage.setItem(storageKey, JSON.stringify({ ...saved, side }));
      status.textContent = "설정이 저장되었습니다. 다음 캠퍼스 입장부터 적용됩니다.";
    } catch {
      status.textContent = "저장할 수 없습니다. 브라우저 저장소 설정을 확인해 주세요.";
    }
  }
  sideInput.addEventListener("change", save);
  window.addEventListener("hashchange", () => {
    render();
    const panel = pages.has(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    telemetry?.track("hub_panel_view", panel);
  });
  // The click event ID is the attribution key; game sites never receive a browser ID.
  document.addEventListener("click", event => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const destination = new URL(link.href, location.href);
    const target = {
      "duck.inhagame.app": "classic",
      "induckup.inhagame.app": "induckup",
      "survival.inhagame.app": "survival",
      "grow.inhagame.app": "induck-grow"
    }[destination.hostname];
    const campus = destination.origin === location.origin && destination.pathname === "/campus/";
    if (!target && !campus) return;
    const entryId = target
      ? telemetry?.track("hub_game_click", link.closest("[data-view]")?.dataset.view || "home", target)
      : telemetry?.track("campus_entry_click", "home", "campus");
    if (entryId) {
      destination.searchParams.set("ih_entry", entryId);
      if (target) {
        const acquisition = telemetry?.attribution?.();
        if (acquisition?.source && acquisition.source !== "unknown") {
          destination.searchParams.set("src", acquisition.source);
        }
        if (acquisition?.campaign) destination.searchParams.set("campaign", acquisition.campaign);
      }
      link.href = destination.href;
    }
  });

  // A card must actually reach the viewport before it contributes to exposure.
  const seenCards = new Set();
  const impressionObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.25) continue;
          const id = entry.target.dataset.gameId;
          if (id && !seenCards.has(id)) {
            seenCards.add(id);
            telemetry?.track("hub_card_impression", "home", id);
          }
          impressionObserver.unobserve(entry.target);
        }
      }, { threshold: 0.25 }) : null;
  function observeCards() {
    if (!impressionObserver) return;
    document.querySelectorAll("#game-cards .game-card[data-game-id]").forEach(card => {
      if (!seenCards.has(card.dataset.gameId)) impressionObserver.observe(card);
    });
  }
  observeCards();
  telemetry?.track("hub_panel_view", pages.has(location.hash.slice(1)) ? location.hash.slice(1) : "home");
  // A checked-in manifest is the source of truth; the HTML cards remain usable if loading fails.
  const gameOrigins = new Set([
    "https://duck.inhagame.app",
    "https://induckup.inhagame.app",
    "https://survival.inhagame.app",
    "https://grow.inhagame.app"
  ]);

  function checkedPlayUrl(value) {
    if (value === "/campus/?lobby=1") return value;
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return gameOrigins.has(url.origin) && !url.username && !url.password &&
        !url.search && !url.hash ? url.href : null;
    } catch {
      return null;
    }
  }

  function readCatalog(payload) {
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload.games) ||
        payload.games.length === 0) throw new Error("Unknown game catalog format");
    const seen = new Set();
    return payload.games.map((game) => {
      if (!game || typeof game.id !== "string" || !/^[a-z0-9-]+$/.test(game.id) ||
          seen.has(game.id) || typeof game.title !== "string" ||
          !game.title.trim() || game.title.length > 60 ||
          typeof game.description !== "string" || game.description.length > 160 ||
          !Number.isInteger(game.sortOrder) || game.sortOrder < 0 ||
          game.status !== "playable" && game.status !== "planned") {
        throw new Error("Invalid game catalog entry");
      }
      seen.add(game.id);
      const playUrl = game.status === "playable" ? checkedPlayUrl(game.playUrl) : null;
      if ((game.status === "playable" && !playUrl) ||
          (game.status === "planned" && game.playUrl != null)) {
        throw new Error("Invalid game link or status");
      }
      return { id: game.id, title: game.title, description: game.description,
        status: game.status, sortOrder: game.sortOrder, playUrl };
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  function makeGameCard(game) {
    const card = document.createElement("section");
    card.className = "card game-card";
    card.dataset.gameId = game.id;
    const heading = document.createElement("div");
    heading.className = "card-heading";
    const title = document.createElement("h2");
    title.textContent = game.title;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = game.status === "playable" ? "플레이 가능" : "준비 중";
    heading.append(title, badge);
    const description = document.createElement("p");
    description.textContent = game.description;
    card.append(heading, description);
    if (game.playUrl) {
      const link = document.createElement("a");
      link.className = "secondary";
      link.href = game.playUrl;
      const external = game.playUrl.startsWith("https://");
      link.textContent = game.title + (external ? " 플레이 ↗" : " 플레이 →");
      if (external) link.rel = "noopener noreferrer";
      card.append(link);
    }
    return card;
  }

  async function loadGameCatalog() {
    const container = document.getElementById("game-cards");
    if (!container) return;
    try {
      const response = await fetch("/data/game-catalog.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("Game catalog unavailable");
      // Campus is the hero experience on the home screen, not a duplicate game card.
      const games = readCatalog(await response.json()).filter((game) => game.id !== "campus");
      const existing = [...container.querySelectorAll(".game-card")];
      if (!existing.length) return;
      const fragment = document.createDocumentFragment();
      games.forEach((game) => {
        const card = makeGameCard(game);
        const extras = existing.find((old) => old.dataset.gameId === game.id)
          ?.querySelectorAll("[data-card-extra]");
        const link = card.querySelector("a");
        if (extras?.length && link) {
          const row = document.createElement("div");
          row.className = "classic-action-row";
          link.replaceWith(row);
          row.append(link, ...extras);
        }
        fragment.append(card);
      });
      container.insertBefore(fragment, existing[0]);
      existing.forEach((card) => { impressionObserver?.unobserve(card); card.remove(); });
      observeCards();
    } catch (error) {
      // The verified, static cards in index.html remain available offline.
      console.warn("Using fallback game cards:", error);
    }
  }

  render();
  void loadGameCatalog();
})();
