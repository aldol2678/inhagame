export class ComponentAdapterRegistry {
  constructor(adapters = []) {
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (!adapter || typeof adapter.name !== "string" || typeof adapter.apply !== "function") {
      throw new TypeError("Component adapter needs a name and apply function");
    }
    if (this.adapters.has(adapter.name)) throw new Error(`R_ADAPTER_DUPLICATE:${adapter.name}`);
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  get(name) { return this.adapters.get(name) ?? null; }
  stages() { return [...new Set([...this.adapters.values()].map(adapter => adapter.stage ?? 1))].sort((a, b) => a - b); }
}

async function registerReference(kind, data, binding, runtime, context) {
  binding.components.set(kind, structuredClone(data));
  const policy = context.refPolicy?.(kind, data) ?? "soft";
  if (context.resolveRef) {
    let target;
    try { target = await context.resolveRef(kind, data.refId); }
    catch { target = null; }
    if (target == null || target === false) {
      runtime.diagnose(policy === "strong" ? "ERROR" : "WARNING", "R_REF_NOT_FOUND", {
        entityId: binding.entityId, component: kind, refId: data.refId
      });
      binding.status = "degraded";
      return;
    }
  }
  const record = { entityId: binding.entityId, refId: data.refId, data: structuredClone(data), runtimeObject: binding.runtimeObject };
  const targetMap = kind === "game.spawn" ? runtime.spawns : runtime.triggers;
  const register = kind === "game.spawn" ? context.registerSpawn : context.registerTrigger;
  if (register) {
    const dispose = await register(record);
    if (typeof dispose === "function") runtime.disposers.push(dispose);
  }
  targetMap.set(binding.entityId, record);
}

export function createDefaultComponentRegistry() {
  return new ComponentAdapterRegistry([
    {
      name: "core.renderable", stage: 0,
      async apply(binding, data, { runtime, context, assets }) {
        try {
          const resource = await assets.resolve(data.assetId);
          const visual = await context.createRenderable(resource, data, binding);
          context.attach(binding.runtimeObject, visual);
          binding.components.set("core.renderable", { assetId: data.assetId, visual, placeholder: false });
        } catch (error) {
          binding.status = "degraded";
          runtime.diagnose("WARNING", "R_ASSET_LOAD_FAILED", {
            entityId: binding.entityId, component: "core.renderable", assetId: data.assetId, detail: String(error)
          });
          const placeholder = context.createPlaceholder?.(binding, data);
          if (placeholder) context.attach(binding.runtimeObject, placeholder);
          binding.components.set("core.renderable", { assetId: data.assetId, visual: placeholder ?? null, placeholder: true });
        }
      }
    },
    {
      name: "world.building", stage: 1,
      apply(binding, data, { context, runtime }) {
        const record = structuredClone(data);
        if (data.footprint && context.createBuildingMass &&
          (!binding.components.has("core.renderable") || binding.components.get("core.renderable").placeholder)) {
          const { visual, dispose } = context.createBuildingMass(data, binding);
          context.attach(binding.runtimeObject, visual);
          record.visual = visual;
          if (dispose) runtime.disposers.push(dispose);
        }
        binding.components.set("world.building", record);
      }
    },
    {
      name: "world.path", stage: 1,
      apply(binding, data, { context }) {
        const visual = context.createPath(data, binding);
        context.attach(binding.runtimeObject, visual);
        binding.components.set("world.path", { data: structuredClone(data), visual });
      }
    },
    {
      name: "world.structure", stage: 1,
      apply(binding, data, { context }) {
        const visual = context.createStructure(data, binding);
        context.attach(binding.runtimeObject, visual);
        binding.components.set("world.structure", { data: structuredClone(data), visual });
      }
    },
    {
      name: "inha.location", stage: 1,
      async apply(binding, data, { runtime, context }) {
        const record = { entityId: binding.entityId, data: structuredClone(data), runtimeObject: binding.runtimeObject };
        binding.components.set("inha.location", structuredClone(data));
        runtime.locations.set(binding.entityId, record);
        const dispose = await context.registerLocation?.(record);
        if (typeof dispose === "function") runtime.disposers.push(dispose);
      }
    },
    { name: "game.spawn", stage: 2, apply(binding, data, { runtime, context }) {
      return registerReference("game.spawn", data, binding, runtime, context);
    } },
    { name: "game.trigger", stage: 2, apply(binding, data, { runtime, context }) {
      return registerReference("game.trigger", data, binding, runtime, context);
    } }
  ]);
}
