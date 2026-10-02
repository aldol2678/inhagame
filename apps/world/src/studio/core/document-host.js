const freeze = value => value && typeof value === "object" ? Object.freeze({ ...value }) : null;

export class StudioDocumentHost {
  constructor() {
    this.records = new Map();
    this.validation = new Map();
  }

  attach(moduleId, adapter) {
    if (!moduleId || !adapter) throw new Error("E_STUDIO_DOCUMENT_HOST_ATTACH");
    this.records.set(moduleId, { adapter, status: freeze(adapter.getStatus?.() ?? {}) });
    return adapter;
  }

  detach(moduleId) {
    this.records.delete(moduleId);
    this.validation.delete(moduleId);
  }

  updateStatus(moduleId, status) {
    const record = this.records.get(moduleId);
    if (!record) return false;
    record.status = freeze(status ?? {});
    return true;
  }

  getStatus(moduleId) {
    return this.records.get(moduleId)?.status ?? Object.freeze({ ready: false, mounted: false, moduleId });
  }

  getAdapter(moduleId) {
    return this.records.get(moduleId)?.adapter ?? null;
  }

  getValidation(moduleId) {
    return this.validation.get(moduleId) ?? null;
  }

  async save(moduleId) { return this.#call(moduleId, "save"); }
  async togglePreview(moduleId) { return this.#call(moduleId, "togglePreview"); }

  async validate(moduleId) {
    const result = await this.#call(moduleId, "validate");
    this.validation.set(moduleId, freeze(result));
    return result;
  }

  async undo(moduleId) { return this.#call(moduleId, "undo"); }
  async redo(moduleId) { return this.#call(moduleId, "redo"); }
  async getContent(moduleId) { return this.#call(moduleId, "getContent"); }
  async getInspector(moduleId) { return this.#call(moduleId, "getInspector"); }
  async selectContent(moduleId, kind, id) {
    const adapter = this.getAdapter(moduleId);
    const status = this.getStatus(moduleId);
    if (!adapter || !status.ready) throw new Error(`E_STUDIO_DOCUMENT_NOT_READY:${moduleId}`);
    if (typeof adapter.selectContent !== "function") throw new Error(`E_STUDIO_DOCUMENT_COMMAND_UNSUPPORTED:${moduleId}:selectContent`);
    return adapter.selectContent(kind, id);
  }

  async updateInspector(moduleId, kind, id, field, value) {
    const adapter = this.getAdapter(moduleId);
    const status = this.getStatus(moduleId);
    if (!adapter || !status.ready) throw new Error(`E_STUDIO_DOCUMENT_NOT_READY:${moduleId}`);
    if (typeof adapter.updateInspector !== "function") throw new Error(`E_STUDIO_DOCUMENT_COMMAND_UNSUPPORTED:${moduleId}:updateInspector`);
    return adapter.updateInspector(kind, id, field, value);
  }

  async #call(moduleId, method) {
    const adapter = this.getAdapter(moduleId);
    const status = this.getStatus(moduleId);
    if (!adapter || !status.ready) throw new Error(`E_STUDIO_DOCUMENT_NOT_READY:${moduleId}`);
    if (typeof adapter[method] !== "function") throw new Error(`E_STUDIO_DOCUMENT_COMMAND_UNSUPPORTED:${moduleId}:${method}`);
    return adapter[method]();
  }
}

export const createStudioDocumentHost = () => new StudioDocumentHost();
