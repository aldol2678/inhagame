export function createEditorWorldRuntime({
  enabled = false,
  app,
  parent,
  assetShadow,
  documentLike = globalThis.document,
  windowLike = globalThis.window,
  logger = console
} = {}) {
  let currentStatus = enabled ? { state: "loading" } : null;
  const label = enabled ? documentLike?.createElement?.("output") : null;

  if (label) {
    label.className = "editor-world-runtime-status";
    label.setAttribute("role", "status");
    label.textContent = "Saved Editor World · loading";
    documentLike.body?.append?.(label);
  }

  const ready = enabled
    ? (async () => {
        const [
          { EditorBrowserStore },
          { loadWorldDocument },
          { createPlayCanvasRuntimeContext, createSceneRegistries },
          { createEditorAssetResolver, revokeEditorAssetUrls }
        ] = await Promise.all([
          import("./editor-browser-store.js"),
          import("../runtime-adapter/load-world.js"),
          import("../runtime-adapter/playcanvas-context.js"),
          import("./editor-model-import.js")
        ]);
        const store = await EditorBrowserStore.open();
        const text = await store.readLatestCanonical();
        if (!text) throw new Error("R_EDITOR_WORLD_NOT_SAVED");
        const parsed = JSON.parse(text);
        const registries = createSceneRegistries();
        const objectUrls = new Set();
        const context = createPlayCanvasRuntimeContext({
          app,
          parent,
          registries,
          assetShadow,
          resolveAssetUri: createEditorAssetResolver({ store, worldId: parsed.worldId, objectUrls })
        });
        const runtime = await loadWorldDocument(text, context);
        if (runtime.state === "fatal") {
          context.dispose();
          throw new Error(runtime.diagnostics[0]?.code || "R_WORLD_FATAL");
        }
        currentStatus = {
          state: runtime.state,
          worldId: runtime.worldId,
          entities: runtime.bindings.size,
          diagnostics: runtime.diagnostics,
          registries,
          runtime
        };
        if (label) {
          label.textContent = `Saved Editor World · ${runtime.state} · ${runtime.bindings.size} entities · ${runtime.diagnostics.length} diagnostics`;
        }
        windowLike?.addEventListener?.("pagehide", () => {
          void runtime.dispose().finally(() => {
            context.dispose();
            revokeEditorAssetUrls(objectUrls);
          });
        }, { once: true });
        return currentStatus;
      })().catch(error => {
        currentStatus = { state: "fatal", error: String(error) };
        if (label) label.textContent = `Saved Editor World · fatal · ${error.message}`;
        logger.warn?.("Saved Editor World could not be loaded:", error);
        return currentStatus;
      })
    : Promise.resolve(null);

  return Object.freeze({
    ready,
    status: () => currentStatus,
    label
  });
}
