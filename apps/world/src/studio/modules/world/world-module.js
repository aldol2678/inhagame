export const worldModule = Object.freeze({
  id: "world",
  label: "World",
  icon: "🌎",
  order: 10,
  status: "available",
  description: "Scene, object, map-reference and runtime-preview authoring. WorldForge hosts the existing World Editor through a same-origin compatibility adapter.",
  legacyHref: "/editor/",
  legacyLabel: "Open standalone World Editor",
  capabilities: ["scene", "assets", "preview", "hosted-editor"],
  contentSections: [
    { label: "WORLD", items: ["Hosted Editor", "Scene", "Assets"] }
  ]
});
