// Local name lookup over the current map's resolved POIs. Search never owns discovery,
// gates, destinations or movement; activation hands the current POI back to the map.
import { MAP_POI_STATES } from "./full-map-presentation.js";

const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, "");
export const isMapCompositionEvent = event => event?.isComposing === true || event?.keyCode === 229;

export function createFullMapSearch({ root, documentLike, getPois, onSelect }) {
  if (!root) return null;
  const create = (tag, className) => {
    const node = documentLike.createElement(tag);
    node.className = className;
    return node;
  };
  const input = create("input", "full-map-search-input");
  input.type = "search";
  input.placeholder = "장소 이름 검색";
  input.setAttribute("aria-label", "지도 장소 이름 검색");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("enterkeyhint", "search");
  const clear = create("button", "full-map-search-clear");
  clear.type = "button";
  clear.textContent = "지우기";
  clear.setAttribute("aria-label", "장소 검색어 지우기");
  const panel = create("div", "full-map-search-panel");
  const status = create("p", "full-map-search-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = create("ul", "full-map-search-results");
  list.setAttribute("aria-label", "장소 검색 결과");
  panel.appendChild(status);
  panel.appendChild(list);
  root.appendChild(input);
  root.appendChild(clear);
  root.appendChild(panel);
  const nodes = new Map();
  let composing = false;
  let expanded = false;

  const currentResults = () => {
    const query = normalize(input.value);
    return query ? getPois().filter(poi => poi.visible !== false && poi.validPosition !== false &&
      Number.isFinite(poi.x) && Number.isFinite(poi.z) && normalize(poi.title).includes(query)) : [];
  };

  function select(id) {
    if (composing) return;
    // Resolve again at activation: account/progress changes cannot leave an old searchable gate.
    const poi = currentResults().find(value => value.poiId === id);
    if (poi) {
      expanded = false;
      panel.hidden = true;
      onSelect(poi);
    } else {
      onSelect(null);
      refresh();
    }
  }

  function refresh() {
    if (composing) return;
    const query = normalize(input.value);
    const results = currentResults();
    const active = documentLike.activeElement;
    const wasResult = list.contains?.(active);
    const keep = new Set(results.map(poi => poi.poiId));
    for (const [id, entry] of nodes) {
      if (keep.has(id)) continue;
      list.removeChild(entry.item);
      nodes.delete(id);
    }
    for (const [index, poi] of results.entries()) {
      let entry = nodes.get(poi.poiId);
      if (!entry) {
        const item = create("li", "full-map-search-item");
        const button = create("button", "full-map-search-result");
        button.type = "button";
        button.dataset.poiId = poi.poiId;
        button.addEventListener("click", () => select(poi.poiId));
        button.addEventListener("keydown", event => {
          if (composing || isMapCompositionEvent(event)) return;
          const key = event.key || event.code;
          if (key !== "ArrowUp" && key !== "ArrowDown") return;
          const live = currentResults();
          const index = live.findIndex(value => value.poiId === poi.poiId);
          const next = key === "ArrowDown" ? live[index + 1] : live[index - 1];
          event.preventDefault?.();
          if (next) nodes.get(next.poiId)?.button.focus?.();
          else if (key === "ArrowUp") input.focus?.();
        });
        item.appendChild(button);
        entry = { item, button };
        nodes.set(poi.poiId, entry);
        list.appendChild(item);
      }
      if (list.children[index] !== entry.item) list.insertBefore(entry.item, list.children[index] ?? null);
      entry.button.textContent = `${poi.title} · ${(MAP_POI_STATES[poi.presentation] ?? MAP_POI_STATES.UNKNOWN).label}`;
      entry.button.dataset.presentation = poi.presentation;
    }
    clear.hidden = !input.value;
    status.textContent = !query ? "" : results.length ? `${results.length}개 장소` : "검색 결과가 없어요";
    panel.hidden = !query || !expanded;
    if ((wasResult && !list.contains?.(active)) || (active === clear && clear.hidden)) input.focus?.();
    else if (wasResult && documentLike.activeElement !== active) active.focus?.({ preventScroll: true });
  }

  function reset() {
    composing = false;
    expanded = false;
    input.value = "";
    refresh();
  }
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; expanded = true; refresh(); });
  input.addEventListener("input", event => {
    if (composing || isMapCompositionEvent(event)) return;
    expanded = true;
    refresh();
  });
  input.addEventListener("focus", () => { expanded = true; refresh(); });
  input.addEventListener("keydown", event => {
    const key = event.key || event.code;
    if (composing || isMapCompositionEvent(event)) {
      // Chromium's type=search Escape default clears the field even during IME,
      // cancelling its composition without a compositionend event. Keep the IME
      // lifecycle intact; the next ordinary Escape can still close the map.
      if (key === "Escape") event.preventDefault?.();
      return;
    }
    if (key !== "ArrowDown" && key !== "Enter" && key !== "NumpadEnter") return;
    expanded = true;
    refresh();
    const first = currentResults()[0];
    event.preventDefault?.();
    if (!first) return;
    if (key === "ArrowDown") nodes.get(first.poiId)?.button.focus?.();
    else select(first.poiId);
  });
  clear.addEventListener("click", () => { reset(); input.focus?.(); });
  reset();
  return { refresh, reset, get composing() { return composing; } };
}
