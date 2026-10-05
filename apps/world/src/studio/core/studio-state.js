const LAYOUTS = new Set(["desktop", "compact", "mobile"]);
const BOTTOM_TABS = new Set(["console", "validation", "history"]);

export class StudioState {
  constructor({ activeModuleId = "world" } = {}) {
    this.activeModuleId = activeModuleId;
    this.activeBottomTab = "console";
    this.contentOpen = false;
    this.inspectorOpen = false;
    this.bottomOpen = true;
    this.layoutMode = "desktop";
    this._listeners = new Set();
  }

  snapshot() {
    return Object.freeze({
      activeModuleId: this.activeModuleId,
      activeBottomTab: this.activeBottomTab,
      contentOpen: this.contentOpen,
      inspectorOpen: this.inspectorOpen,
      bottomOpen: this.bottomOpen,
      layoutMode: this.layoutMode
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  setActiveModule(id) {
    const next = String(id || "").trim();
    if (!next || next === this.activeModuleId) return false;
    this.activeModuleId = next;
    this._emit("module");
    return true;
  }

  setBottomTab(tab) {
    if (!BOTTOM_TABS.has(tab)) throw new Error(`E_STUDIO_BOTTOM_TAB_INVALID:${tab}`);
    if (tab === this.activeBottomTab) return false;
    this.activeBottomTab = tab;
    this._emit("bottom-tab");
    return true;
  }

  setPanel(panel, open) {
    if (!["content", "inspector"].includes(panel)) throw new Error(`E_STUDIO_PANEL_INVALID:${panel}`);
    const key = panel === "content" ? "contentOpen" : "inspectorOpen";
    const next = Boolean(open);
    if (this[key] === next) return false;
    this[key] = next;
    this._emit("panel");
    return true;
  }

  setLayoutMode(mode) {
    if (!LAYOUTS.has(mode)) throw new Error(`E_STUDIO_LAYOUT_INVALID:${mode}`);
    if (mode === this.layoutMode) return false;
    this.layoutMode = mode;
    if (mode === "desktop") {
      this.contentOpen = false;
      this.inspectorOpen = false;
    }
    this._emit("layout");
    return true;
  }

  _emit(type) {
    const event = Object.freeze({ type, ...this.snapshot() });
    for (const listener of this._listeners) listener(event);
  }
}
