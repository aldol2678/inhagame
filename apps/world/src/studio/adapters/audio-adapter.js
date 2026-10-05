import { HostedEditorAdapter } from "../core/hosted-editor-adapter.js";

export const AUDIO_EDITOR_BRIDGE_CHANNEL = "inha.studio.audio/1";

export class AudioStudioAdapter extends HostedEditorAdapter {
  constructor(options = {}) {
    super({
      ...options,
      moduleId: "audio",
      channel: AUDIO_EDITOR_BRIDGE_CHANNEL,
      src: options.src ?? "/editor/music/?studioHost=1",
      frameId: "studio-audio-frame",
      frameClass: "studio-audio-frame",
      frameTitle: "INHA WORLD Music Editor",
      allow: "autoplay; clipboard-read; clipboard-write",
      errorPrefix: "E_STUDIO_AUDIO"
    });
  }
}

export function createAudioStudioAdapter(options) {
  return new AudioStudioAdapter(options);
}
