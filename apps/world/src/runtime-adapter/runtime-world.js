export class RuntimeWorld {
  constructor(worldId, context) {
    this.worldId = worldId;
    this.context = context;
    this.root = null;
    this.state = "ready";
    this.bindings = new Map();
    this.objectIds = new WeakMap();
    this.diagnostics = [];
    this.spawns = new Map();
    this.triggers = new Map();
    this.locations = new Map();
    this.disposers = [];
    this.disposed = false;
  }

  getEntity(id) { return this.bindings.get(id) ?? null; }
  getObject(id) { return this.getEntity(id)?.runtimeObject ?? null; }
  getEntityId(object) {
    for (let current = object; current; current = current.parent) {
      const id = this.objectIds.get(current);
      if (id) return id;
    }
    return null;
  }

  addBinding(source, runtimeObject) {
    const binding = { entityId: source.id, runtimeObject, source, status: "ready", components: new Map() };
    this.bindings.set(source.id, binding);
    this.objectIds.set(runtimeObject, source.id);
    return binding;
  }

  diagnose(severity, code, { entityId, component, assetId, refId, detail } = {}) {
    const diagnostic = { severity, code, worldId: this.worldId };
    for (const [key, value] of Object.entries({ entityId, component, assetId, refId, detail })) {
      if (value !== undefined) diagnostic[key] = value;
    }
    this.diagnostics.push(diagnostic);
    if (severity === "ERROR") this.state = "fatal";
    else if (this.state !== "fatal") this.state = "ready-with-warnings";
    return diagnostic;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.reverse()) {
      try { await dispose(); }
      catch (error) { this.diagnose("WARNING", "R_DISPOSE_FAILED", { detail: String(error) }); }
    }
    this.spawns.clear();
    this.triggers.clear();
    this.locations.clear();
    this.bindings.clear();
    if (this.root) this.context.destroyRoot(this.root);
    this.root = null;
  }
}
