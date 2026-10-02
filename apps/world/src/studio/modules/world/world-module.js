export const worldModule = Object.freeze({
  id: "world",
  label: "World",
  icon: "🌎",
  order: 10,
  status: "available",
  description: "Scene, object, map-reference and runtime-preview authoring. S1 hosts the existing World Editor inside Studio through a same-origin adapter bridge.",
  legacyHref: "/editor/",
  legacyLabel: "Open standalone World Editor",
  capabilities: ["scene", "assets", "preview", "hosted-editor"],
  contentSections: [
    { label: "WORLD", items: ["Hosted Editor", "Scene", "Assets"] }
  ]
});
