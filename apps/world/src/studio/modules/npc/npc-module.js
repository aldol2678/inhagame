export const npcModule = Object.freeze({
  id: "npc",
  label: "NPC",
  icon: "🤖",
  order: 30,
  status: "planned",
  description: "NPC authoring and simulation integration is reserved for a later Studio module.",
  capabilities: ["npc", "simulation"],
  contentSections: [
    { label: "NPC", items: ["Roster", "Behavior", "Simulation"] }
  ]
});
