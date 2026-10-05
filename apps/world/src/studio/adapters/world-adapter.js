import { HostedEditorAdapter } from "../core/hosted-editor-adapter.js";

export const WORLD_EDITOR_BRIDGE_CHANNEL = "inha.studio.world/1";

export class WorldStudioAdapter extends HostedEditorAdapter {
  constructor(options = {}) {
    super({
      ...options,
      moduleId: "world",
      channel: WORLD_EDITOR_BRIDGE_CHANNEL,
      src: options.src ?? "/editor/?studioHost=1",
      frameId: "studio-world-frame",
      frameClass: "studio-world-frame",
      frameTitle: "INHA WORLD Editor",
      allow: "clipboard-read; clipboard-write",
      errorPrefix: "E_STUDIO_WORLD"
    });
  }
}

export function createWorldStudioAdapter(options) {
  return new WorldStudioAdapter(options);
}
