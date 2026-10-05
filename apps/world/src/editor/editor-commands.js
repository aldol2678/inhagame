import { normalizeEntity } from "./world-document.js";

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class EditorCommands {
  constructor(world, state, { limit = 150 } = {}) {
    this.world = world;
    this.state = state;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.transformDraft = null;
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

  _record(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._emit();
  }

  execute(command) {
    if (this.transformDraft) throw new Error("E_TRANSFORM_ACTIVE");
    command.redo();
    this._record(command);
    return true;
  }

  executeCompound(label, parts) {
    if (!parts.length) return false;
    let completed = 0;
    return this.execute({
      label,
      redo: () => {
        try {
          for (const part of parts) {
            part.redo();
            completed += 1;
          }
        } catch (error) {
          for (let index = completed - 1; index >= 0; index -= 1) parts[index].undo();
          throw error;
        } finally {
          completed = 0;
        }
      },
      undo: () => {
        for (let index = parts.length - 1; index >= 0; index -= 1) parts[index].undo();
      }
    });
  }

  undo() {
    if (this.transformDraft) this.cancelTransform();
    const command = this.undoStack.at(-1);
    if (!command) return false;
    command.undo();
    this.undoStack.pop();
    this.redoStack.push(command);
    if (this.state.selectedEntityId && !this.world.hasEntity(this.state.selectedEntityId)) this.state.clearSelection();
    this._emit();
    return true;
  }

  redo() {
    if (this.transformDraft) this.cancelTransform();
    const command = this.redoStack.at(-1);
    if (!command) return false;
    command.redo();
    this.redoStack.pop();
    this.undoStack.push(command);
    this._emit();
    return true;
  }

  addEntity(candidate) {
    const entity = normalizeEntity(candidate);
    this.execute({
      label: "Add Entity",
      redo: () => {
        this.world.addEntity(entity);
        this.state.select(entity.id);
      },
      undo: () => this.world.removeEntity(entity.id)
    });
    return entity;
  }

  addAsset(candidate) {
    const asset = copy(candidate);
    this.execute({
      label: "Add Asset",
      redo: () => this.world.addAsset(asset),
      undo: () => this.world.removeAsset(asset.id)
    });
    return asset;
  }

  duplicateEntity(id) {
    const source = this.world.getEntity(id);
    if (!source) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    let nextId = `${id}.copy`;
    for (let suffix = 2; this.world.hasEntity(nextId); suffix += 1) nextId = `${id}.copy-${suffix}`;
    const clone = {
      ...source,
      id: nextId,
      name: `${source.name} Copy`,
      transform: {
        ...source.transform,
        position: [source.transform.position[0] + 1, source.transform.position[1], source.transform.position[2] + 1]
      }
    };
    return this.addEntity(clone);
  }

  removeEntity(id) {
    const before = this.world.getEntity(id);
    if (!before) return false;
    const index = this.world.listEntities().findIndex(entity => entity.id === id);
    this.execute({
      label: "Remove Entity",
      redo: () => this.world.removeEntity(id),
      undo: () => this.world.addEntity(before, { index })
    });
    if (this.state.selectedEntityId === id) this.state.clearSelection();
    return true;
  }

  replaceEntity(id, candidate, label = "Edit Entity") {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    const after = copy(candidate);
    if (same(before, after)) return false;
    this.execute({
      label,
      redo: () => this.world.replaceEntity(id, after),
      undo: () => this.world.replaceEntity(id, before)
    });
    return true;
  }

  setTransform(id, transform) {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    return this.replaceEntity(id, { ...before, transform: copy(transform) }, "Set Transform");
  }

  renameEntity(id, name) {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    return this.replaceEntity(id, { ...before, name: name.trim() }, "Rename Entity");
  }

  setEnabled(id, enabled) {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    return this.replaceEntity(id, { ...before, enabled }, "Set Enabled");
  }

  setTags(id, tags) {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    return this.replaceEntity(id, { ...before, tags: [...tags] }, "Set Tags");
  }

  setComponentField(id, component, field, value) {
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    const components = copy(before.components);
    components[component] = { ...(components[component] || {}), [field]: copy(value) };
    return this.replaceEntity(id, { ...before, components }, "Set Component Field");
  }

  beginTransform(id, mode) {
    if (this.transformDraft) throw new Error("E_TRANSFORM_ACTIVE");
    const before = this.world.getEntity(id);
    if (!before) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    this.transformDraft = { id, mode, before: before.transform };
    return copy(before.transform);
  }

  previewTransform(transform) {
    const draft = this.transformDraft;
    if (!draft) throw new Error("E_TRANSFORM_NOT_ACTIVE");
    this.world.previewEntityTransform(draft.id, copy(transform));
  }

  commitTransform(transform = null) {
    const draft = this.transformDraft;
    if (!draft) return false;
    try {
      if (transform) this.previewTransform(transform);
      this.world.assertValid();
      const after = this.world.getEntity(draft.id).transform;
      this.transformDraft = null;
      if (same(draft.before, after)) return false;
      const id = draft.id;
      this._record({
        label: "Set Transform",
        redo: () => this.world.updateEntity(id, { transform: after }),
        undo: () => this.world.updateEntity(id, { transform: draft.before })
      });
      return true;
    } catch (error) {
      this.cancelTransform();
      throw error;
    }
  }

  cancelTransform() {
    const draft = this.transformDraft;
    if (!draft) return false;
    this.transformDraft = null;
    const current = this.world.getEntity(draft.id);
    if (current) this.world.replaceEntity(draft.id, { ...current, transform: draft.before });
    return true;
  }
}
