// INHA WORLD · Mobility Book P0.8.
// Player-facing discovery UI over Mobility Registry. It does not grant ownership. Favorites and the
// future Active Mount preference are local UI preferences only until a server Active Mount authority lands.

import {
  getPlayerVisibleMobility,
  mobilityMatchesFilter,
  mobilityMatchesQuery
} from "./mobility-registry.js";

export const MOBILITY_FAVORITES_STORAGE_KEY = "inhagame-mobility-book-favorites-v1";
export const ACTIVE_MOUNT_STORAGE_KEY = "inhagame-active-mount-v1";

const DOMAIN_TEXT = Object.freeze({
  GROUND: "지상",
  WATER_SURFACE: "수상",
  WATER_SUBMERGED: "수중",
  AIR: "공중",
  SPACE: "우주"
});

export function readMobilityFavorites(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(MOBILITY_FAVORITES_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeMobilityFavorites(favorites, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(MOBILITY_FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
    return true;
  } catch {
    return false;
  }
}

export function readActiveMountId(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem?.(ACTIVE_MOUNT_STORAGE_KEY);
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function writeActiveMountId(mountId, storage = globalThis.localStorage) {
  try {
    if (mountId) storage?.setItem?.(ACTIVE_MOUNT_STORAGE_KEY, mountId);
    else storage?.removeItem?.(ACTIVE_MOUNT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const domainText = (domain) => DOMAIN_TEXT[domain] ?? domain;
const statusClass = (definition) => definition.availability === "EXPERIMENTAL" ? "experimental"
  : definition.availability === "LOCKED_PROGRESS" ? "event"
  : definition.availability === "AVAILABLE" ? "available" : "soon";

export function createMobilityBook({
  panel,
  definitions = getPlayerVisibleMobility(),
  onOpenChange = () => {},
  onSummon = () => false,
  onLocate = () => false,
  onStatus = () => false,
  storage = globalThis.localStorage,
  doc = globalThis.document
} = {}) {
  if (!panel) throw new Error("Mobility Book requires its panel");

  const visibleDefinitions = definitions.filter((definition) => definition.availability !== "HIDDEN");
  const favorites = readMobilityFavorites(storage);
  let activeMountId = readActiveMountId(storage);
  let open = false;
  let filter = "ALL";
  let query = "";
  let favoriteOnly = false;
  let selectedId = visibleDefinitions[0]?.mobilityId ?? null;

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const filtered = () => visibleDefinitions.filter((definition) =>
    mobilityMatchesFilter(definition, filter) &&
    mobilityMatchesQuery(definition, query) &&
    (!favoriteOnly || favorites.has(definition.mobilityId))
  );

  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    writeMobilityFavorites(favorites, storage);
    render();
  }

  function setActive(definition) {
    if (!definition?.activeEligible || !definition.mountId) return false;
    activeMountId = definition.mountId;
    writeActiveMountId(activeMountId, storage);
    onStatus(`기본 탈것 · ${definition.displayName}`);
    render();
    return true;
  }

  async function runPrimary(definition) {
    if (!definition) return false;
    let result = false;
    if (definition.primaryAction === "SUMMON_TEST" && definition.summonEnabled) {
      result = await onSummon(definition);
    } else if (definition.primaryAction === "LOCATE_TEST") {
      if (definition.locateStatus) {
        onStatus(definition.locateStatus);
        result = true;
      } else {
        result = await onLocate(definition);
      }
    } else {
      onStatus(definition.activeBlockedReason || "아직 이용할 수 없어요.");
    }
    return result !== false;
  }

  function renderCard(definition) {
    const card = el("article", "mobility-card");
    card.dataset.mobilityId = definition.mobilityId;
    if (selectedId === definition.mobilityId) card.dataset.selected = "true";

    const main = el("button", "mobility-card-main");
    main.type = "button";
    main.setAttribute("aria-label", `${definition.displayName} 상세 보기`);
    main.addEventListener("click", () => {
      selectedId = definition.mobilityId;
      render();
    });

    const art = el("span", "mobility-card-art", definition.emoji);
    art.setAttribute("aria-hidden", "true");
    const copy = el("span", "mobility-card-copy");
    copy.append(el("strong", "mobility-card-name",
      `${definition.displayName}${Boolean(definition.mountId) && activeMountId === definition.mountId ? " · 기본" : ""}`));
    copy.append(el("span", "mobility-card-category", definition.category));
    const domains = el("span", "mobility-card-domains");
    for (const domain of definition.domains) domains.append(el("span", "mobility-domain-chip", domainText(domain)));
    copy.append(domains);
    copy.append(el("span", `mobility-status mobility-status-${statusClass(definition)}`, definition.statusLabel));
    main.append(art, copy);

    const favorite = el("button", `mobility-favorite${favorites.has(definition.mobilityId) ? " on" : ""}`,
      favorites.has(definition.mobilityId) ? "★" : "☆");
    favorite.type = "button";
    favorite.setAttribute("aria-label", `${definition.displayName} 즐겨찾기`);
    favorite.setAttribute("aria-pressed", String(favorites.has(definition.mobilityId)));
    favorite.addEventListener("click", () => toggleFavorite(definition.mobilityId));

    card.append(main, favorite);
    return card;
  }

  function renderDetail(definition) {
    const detail = el("section", "mobility-detail");
    if (!definition) {
      detail.append(el("p", "shop-empty", "조건에 맞는 탈것이 없어요."));
      return detail;
    }

    const hero = el("div", "mobility-detail-hero");
    hero.append(el("span", "mobility-detail-emoji", definition.emoji));
    const title = el("div", "mobility-detail-title");
    title.append(el("span", "mobility-detail-category", definition.category));
    title.append(el("h3", "", definition.displayName));
    const tags = el("div", "mobility-detail-tags");
    tags.append(el("span", `mobility-status mobility-status-${statusClass(definition)}`, definition.statusLabel));
    for (const domain of definition.domains) tags.append(el("span", "mobility-domain-chip", domainText(domain)));
    title.append(tags);
    hero.append(title);
    detail.append(hero);

    detail.append(el("p", "mobility-detail-description", definition.description));

    const facts = el("div", "mobility-facts");
    const seats = definition.seats.length ? `${definition.seats.length}명` : "없음";
    for (const [label, value] of [
      ["좌석", seats],
      ["이용 상태", definition.accessLabel],
      [definition.summonUX === "DOCK" ? "이용 방식" : "소환 방식", definition.summonLabel],
      ["기본 탈것", Boolean(definition.mountId) && activeMountId === definition.mountId ? "현재 기본" : definition.activeEligible ? "설정 가능" : "설정 불가"]
    ]) {
      const item = el("div", "mobility-fact");
      item.append(el("span", "", label), el("strong", "", value));
      facts.append(item);
    }
    detail.append(facts);

    const hint = el("p", "mobility-summon-hint", definition.summonHint);
    detail.append(hint);

    const tech = el("details", "mobility-tech");
    tech.append(el("summary", "", "기술 정보 보기"));
    const techGrid = el("div", "mobility-tech-grid");
    for (const [key, value] of Object.entries(definition.technical)) {
      const item = el("div", "mobility-tech-item");
      item.append(el("span", "", key), el("strong", "", value));
      techGrid.append(item);
    }
    tech.append(techGrid);
    detail.append(tech);

    const actions = el("div", "mobility-actions");
    const primary = el("button", "mobility-primary", definition.primaryLabel);
    primary.type = "button";
    primary.disabled = definition.primaryAction !== "LOCATE_TEST" && !definition.summonEnabled;
    primary.addEventListener("click", async () => {
      primary.disabled = true;
      try {
        const ok = await runPrimary(definition);
        if (ok) setOpen(false);
      } finally {
        if (open) primary.disabled = definition.primaryAction !== "LOCATE_TEST" && !definition.summonEnabled;
      }
    });

    const active = el("button", "mobility-secondary",
      Boolean(definition.mountId) && activeMountId === definition.mountId ? "✓ 기본 탈것" : "기본 탈것 설정");
    active.type = "button";
    active.disabled = !definition.activeEligible || !definition.mountId || Boolean(definition.mountId) && activeMountId === definition.mountId;
    active.addEventListener("click", () => setActive(definition));

    const favorite = el("button", "mobility-secondary",
      favorites.has(definition.mobilityId) ? "★ 즐겨찾기 해제" : "☆ 즐겨찾기");
    favorite.type = "button";
    favorite.addEventListener("click", () => toggleFavorite(definition.mobilityId));
    actions.append(primary, active, favorite);
    detail.append(actions);

    if (!definition.activeEligible) {
      detail.append(el("p", "mobility-action-note", definition.activeBlockedReason));
    }
    return detail;
  }

  function render() {
    if (!open) return;

    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const heading = el("h2", "", "🛞 탈것");
    heading.id = "mobility-book-title";
    titles.append(heading, el("p", "mobility-book-summary",
      `표시 ${filtered().length} · 실험중 ${visibleDefinitions.filter((d) => d.availability === "EXPERIMENTAL").length}`));
    const close = el("button", "profile-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "탈것 닫기");
    close.addEventListener("click", () => setOpen(false));
    head.append(titles, close);

    const body = el("div", "mobility-book-body");
    const browser = el("div", "mobility-browser");

    const filters = el("div", "mobility-filters");
    for (const [id, label] of [["ALL","전체"],["GROUND","지상"],["WATER","수상"],["AIR","공중"],["TRANSIT","교통"],["SPACE","우주"]]) {
      const button = el("button", `mobility-filter${filter === id ? " active" : ""}`, label);
      button.type = "button";
      button.dataset.filter = id;
      button.addEventListener("click", () => { filter = id; render(); });
      filters.append(button);
    }
    browser.append(filters);

    const searchRow = el("div", "mobility-search-row");
    const search = el("input", "mobility-search");
    search.type = "search";
    search.placeholder = "탈것 이름 검색";
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      const next = filtered();
      if (!next.some((d) => d.mobilityId === selectedId)) selectedId = next[0]?.mobilityId ?? null;
      render();
      const replacement = panel.querySelector(".mobility-search");
      replacement?.focus();
      replacement?.setSelectionRange?.(query.length, query.length);
    });
    const favoritesOnly = el("button", `mobility-favorite-only${favoriteOnly ? " active" : ""}`, favoriteOnly ? "★" : "☆");
    favoritesOnly.type = "button";
    favoritesOnly.setAttribute("aria-label", "즐겨찾기만 보기");
    favoritesOnly.setAttribute("aria-pressed", String(favoriteOnly));
    favoritesOnly.addEventListener("click", () => { favoriteOnly = !favoriteOnly; render(); });
    searchRow.append(search, favoritesOnly);
    browser.append(searchRow);

    const list = el("div", "mobility-list");
    const current = filtered();
    if (!current.some((d) => d.mobilityId === selectedId)) selectedId = current[0]?.mobilityId ?? null;
    if (!current.length) list.append(el("p", "shop-empty", "조건에 맞는 탈것이 없어요."));
    else for (const definition of current) list.append(renderCard(definition));
    browser.append(list);

    const selected = visibleDefinitions.find((definition) => definition.mobilityId === selectedId) ?? current[0] ?? null;
    body.append(browser, renderDetail(selected));
    panel.replaceChildren(head, body);
    panel.dataset.state = "READY";
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (!open) {
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    panel.querySelector(".profile-close")?.focus?.();
    return true;
  }

  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    get open() { return open; },
    get activeMountId() { return activeMountId; },
    setOpen,
    render,
    status: () => ({ open, filter, query, favoriteOnly, selectedId, activeMountId })
  };
}
