import test from "node:test";
import assert from "node:assert/strict";
import { createModuleRegistry } from "../src/studio/core/module-registry.js";
import { worldModule } from "../src/studio/modules/world/world-module.js";
import { audioModule } from "../src/studio/modules/audio/audio-module.js";
import { npcModule } from "../src/studio/modules/npc/npc-module.js";
import { eventModule } from "../src/studio/modules/event/event-module.js";
import { gameplayModule } from "../src/studio/modules/gameplay/gameplay-module.js";

const modules = [worldModule, audioModule, npcModule, eventModule, gameplayModule];

test("Studio S0 registry exposes five ordered modules", () => {
  const registry = createModuleRegistry(modules);
  assert.deepEqual(registry.listModules().map(module => module.id), ["world", "audio", "npc", "event", "gameplay"]);
  assert.equal(registry.getModule("world")?.legacyHref, "/editor/");
  assert.equal(registry.getModule("audio")?.legacyHref, "/editor/music/");
  assert.equal(registry.getModule("npc")?.status, "planned");
  assert.equal(registry.getModule("missing"), null);
});

test("Studio registry rejects duplicate IDs", () => {
  const registry = createModuleRegistry([worldModule]);
  assert.throws(() => registry.registerModule({ ...worldModule }), /E_STUDIO_MODULE_DUPLICATE:world/);
});

test("Studio registry freezes normalized descriptors", () => {
  const registry = createModuleRegistry([worldModule]);
  const module = registry.getModule("world");
  assert.equal(Object.isFrozen(module), true);
  assert.equal(Object.isFrozen(module.capabilities), true);
  assert.equal(Object.isFrozen(module.contentSections), true);
  assert.equal(Object.isFrozen(module.contentSections[0].items), true);
  assert.throws(() => { module.label = "Mutated"; }, TypeError);
});
