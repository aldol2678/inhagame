export const EDITOR_TOOLS = Object.freeze(["select", "move", "rotate", "scale"]);

export class EditorState {
  constructor() {
    this.activeTool = "select";
    this.selectedEntityId = null;
    this.transformSpace = "world";
    this.translateSnap = 0;
    this.rotateSnap = 0;
    this._listeners = new Set();
  }

  setTool(tool) {
    if (!EDITOR_TOOLS.includes(tool)) throw new Error(`E_EDITOR_TOOL_UNKNOWN:${tool}`);
    if (tool === this.activeTool) return false;
    this.activeTool = tool;
    this._emit("tool-changed");
    return true;
  }

  select(entityId) {
    const next = entityId || null;
    if (next === this.selectedEntityId) return false;
    this.selectedEntityId = next;
    this._emit("selection-changed");
    return true;
  }

  clearSelection() {
    return this.select(null);
  }

  setTransformSpace(space) {
    if (!["world", "local"].includes(space)) throw new Error(`E_TRANSFORM_SPACE_UNKNOWN:${space}`);
    if (space === this.transformSpace) return false;
    this.transformSpace = space;
    this._emit("space-changed");
    return true;
  }

  setSnap(kind, value) {
    const allowed = kind === "move" ? [0, 0.1, 0.5, 1] : kind === "rotate" ? [0, 5, 15, 45] : null;
    if (!allowed || !allowed.includes(value)) throw new Error(`E_SNAP_INVALID:${kind}:${value}`);
    const key = kind === "move" ? "translateSnap" : "rotateSnap";
    if (this[key] === value) return false;
    this[key] = value;
    this._emit("snap-changed");
    return true;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit(type) {
    const event = Object.freeze({
      type,
      activeTool: this.activeTool,
      selectedEntityId: this.selectedEntityId,
      transformSpace: this.transformSpace,
      translateSnap: this.translateSnap,
      rotateSnap: this.rotateSnap
    });
    for (const listener of this._listeners) listener(event);
  }
}
