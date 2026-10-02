// World-only staff display badges.
// These are presentation markers, not gameplay permissions. Bind by stable account id, never nickname.

const STAFF_BADGES = new Map(); // No preconfigured account identities in public source.

export function staffBadgeForUser(userId) {
  return STAFF_BADGES.get(userId) ?? null;
}

export function renderStaffName(element, nickname, userId, doc = document) {
  element.textContent = nickname;
  const badge = staffBadgeForUser(userId);
  if (!badge) return null;
  const chip = doc.createElement("span");
  chip.className = "staff-badge";
  chip.textContent = badge.label;
  chip.title = badge.title;
  chip.dataset.role = badge.role;
  chip.setAttribute("aria-label", badge.title);
  element.appendChild(chip);
  return badge;
}
