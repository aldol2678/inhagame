export const audioModule = Object.freeze({
  id: "audio",
  label: "Audio",
  icon: "🎵",
  order: 20,
  status: "available",
  description: "Audio asset, waveform, cue, binding, runtime-audio preview and read-only campus place preview authoring. S2 hosts the existing Music Editor inside Studio.",
  legacyHref: "/editor/music/",
  legacyLabel: "Open standalone Music Editor",
  capabilities: ["audio", "waveform", "preview", "place-preview", "hosted-editor"],
  contentSections: [
    { label: "AUDIO", items: ["Hosted Editor", "Audio Assets", "Cues", "Bindings", "Place Preview"] }
  ]
});
