// Small, deliberately symbolic display markers. The nameplate identifies the actual owned item;
// these are not catalog award models and an empty shelf never implies an earned trophy.
export function trophyDisplayVisual(display) {
  if (!display?.itemId || !display?.name || !["BADGE", "MEMORABILIA"].includes(display.category)) return [];
  const base = { name: "display_base", at: [0, .57, -.02], size: [.3, .035, .2], color: "#544436" };
  if (display.category === "BADGE") return [base,
    { name: "owned_badge", at: [0, .70, -.02], size: [.18, .18, .035], color: "#d8b452", type: "sphere" },
    { name: "badge_ribbon", at: [0, .61, -.02], size: [.075, .07, .025], color: "#397aa2" }
  ];
  return [base,
    ...[-1, 1].flatMap(sign => [
      { name: "owned_wristband_side", at: [sign * .08, .63, -.02], size: [.025, .09, .15], color: "#62bbc3" },
      { name: "owned_wristband_edge", at: [0, .63, -.02 + sign * .075], size: [.16, .09, .025], color: "#62bbc3" }
    ])
  ];
}
