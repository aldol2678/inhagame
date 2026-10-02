import { migrateWorld, parseWorld } from "../editor/world-serialization.js";
import { AssetResolver } from "./asset-resolver.js";
import { createDefaultComponentRegistry } from "./component-registry.js";
import { RuntimeWorld } from "./runtime-world.js";

const errorCode = error => /^([A-Z][A-Z0-9_]+):/.exec(error?.message ?? "")?.[1] ?? "R_WORLD_INVALID";

export async function loadWorldDocument(source, context, { registry = createDefaultComponentRegistry() } = {}) {
  const runtime = new RuntimeWorld(null, context);
  let world;
  try {
    const candidate = typeof source === "string" ? parseWorld(source) : source?.snapshot?.() ?? source;
    world = migrateWorld(candidate);
    runtime.worldId = world.worldId;
  } catch (error) {
    runtime.state = "fatal";
    runtime.diagnose("ERROR", errorCode(error), { detail: String(error) });
    return runtime;
  }

  try {
    runtime.root = context.createRoot(world);
  } catch (error) {
    runtime.state = "fatal";
    runtime.diagnose("ERROR", "R_WORLD_CREATE_FAILED", { detail: String(error) });
    return runtime;
  }

  const assets = new AssetResolver(world.assets, context);
  for (const entity of world.entities) {
    try { runtime.addBinding(entity, context.createEntity(entity)); }
    catch (error) {
      runtime.diagnose("WARNING", "R_ENTITY_CREATE_FAILED", { entityId: entity.id, detail: String(error) });
    }
  }
  for (const entity of world.entities) {
    const binding = runtime.getEntity(entity.id);
    if (!binding) continue;
    try {
      const parent = runtime.getEntity(entity.parentId)?.runtimeObject ?? runtime.root;
      context.attach(parent, binding.runtimeObject);
      context.setLocalTransform(binding.runtimeObject, entity.transform);
      binding.runtimeObject.enabled = entity.enabled;
      if (entity.parentId && parent === runtime.root) {
        runtime.diagnose("WARNING", "R_PARENT_DEGRADED", { entityId: entity.id, detail: entity.parentId });
        binding.status = "degraded";
      }
    } catch (error) {
      binding.status = "failed";
      runtime.diagnose("WARNING", "R_ENTITY_CREATE_FAILED", { entityId: entity.id, detail: String(error) });
    }
  }

  for (const stage of registry.stages()) {
    const operations = [];
    for (const entity of world.entities) {
      const binding = runtime.getEntity(entity.id);
      if (!binding || binding.status === "failed" || !entity.enabled) continue;
      for (const [name, data] of Object.entries(entity.components)) {
        const adapter = registry.get(name);
        if (!adapter) {
          if (stage === registry.stages()[0]) runtime.diagnose("WARNING", "R_UNKNOWN_COMPONENT", { entityId: entity.id, component: name });
          continue;
        }
        if ((adapter.stage ?? 1) !== stage) continue;
        operations.push(Promise.resolve().then(() => adapter.apply(binding, data, { runtime, context, assets })).then(() => {
          if (adapter.dispose) runtime.disposers.push(() => adapter.dispose(binding, context));
        }).catch(error => {
          binding.status = "degraded";
          runtime.diagnose("WARNING", "R_COMPONENT_APPLY_FAILED", { entityId: entity.id, component: name, detail: String(error) });
        }));
      }
    }
    await Promise.all(operations);
  }
  if (runtime.state === "fatal") await runtime.dispose();
  return runtime;
}
