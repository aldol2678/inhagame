export const gameplayModule = Object.freeze({
  id: "gameplay",
  label: "Gameplay",
  icon: "🎮",
  order: 50,
  status: "planned",
  description: "Reusable gameplay and minigame authoring is reserved for a later Studio module.",
  capabilities: ["gameplay", "minigame"],
  contentSections: [
    { label: "GAMEPLAY", items: ["Rules", "Minigames", "Parameters"] }
  ]
});
