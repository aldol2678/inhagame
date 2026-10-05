const copy = value => structuredClone(value);

export class MusicCommands {
  constructor(document, { limit = 150 } = {}) {
    this.document = document;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this._listeners = new Set();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit() {
    for (const listener of this._listeners) listener(this);
  }

  execute(label, action) {
    const before = this.document.snapshot();
    const revision = this.document.revision;
    const result = action();
    if (this.document.revision === revision) return result;
    const after = this.document.snapshot();
    this.undoStack.push({ label, before: copy(before), after: copy(after) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._emit();
    return result;
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    this.document.restoreSnapshot(command.before, `undo:${command.label}`);
    this.redoStack.push(command);
    this._emit();
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    this.document.restoreSnapshot(command.after, `redo:${command.label}`);
    this.undoStack.push(command);
    this._emit();
    return true;
  }

  clear() {
    if (!this.undoStack.length && !this.redoStack.length) return false;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._emit();
    return true;
  }

  updateAsset(id, patch, label = "Edit Asset") {
    return this.execute(label, () => this.document.updateAsset(id, patch));
  }

  addCue(candidate) {
    return this.execute("Add Cue", () => this.document.addCue(candidate));
  }

  updateCue(id, patch, label = "Edit Cue") {
    return this.execute(label, () => this.document.updateCue(id, patch));
  }

  removeCue(id) {
    return this.execute("Remove Cue", () => this.document.removeCue(id));
  }

  duplicateCue(id, nextId) {
    const source = this.document.getCue(id);
    if (!source) throw new Error(`E_MUSIC_CUE_NOT_FOUND:${id}`);
    return this.addCue({
      ...source,
      id: nextId,
      name: `${source.name} Copy`
    });
  }

  addBinding(candidate) {
    return this.execute("Add Binding", () => this.document.addBinding(candidate));
  }

  updateBinding(id, patch, label = "Edit Binding") {
    return this.execute(label, () => this.document.updateBinding(id, patch));
  }

  removeBinding(id) {
    return this.execute("Remove Binding", () => this.document.removeBinding(id));
  }

  duplicateBinding(id, nextId) {
    const source = this.document.getBinding(id);
    if (!source) throw new Error(`E_MUSIC_BINDING_NOT_FOUND:${id}`);
    return this.addBinding({ ...source, id: nextId, enabled: false });
  }
}
