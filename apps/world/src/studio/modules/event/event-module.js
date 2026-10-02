export const eventModule = Object.freeze({
  id: "event",
  label: "Event",
  icon: "⚡",
  order: 40,
  status: "planned",
  description: "Trigger, quest and event-flow authoring is reserved for a later Studio module.",
  capabilities: ["trigger", "quest", "event"],
  contentSections: [
    { label: "EVENT", items: ["Triggers", "Quests", "Flows"] }
  ]
});
