// Pure proximity controller for the physical guestbook. It only publishes the interaction-slot
// action; the World's interaction key (F) and the mobile button both run that action's trigger.

export function distance2D(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

export function createGuestbookInteraction({
  anchor,
  radius,
  getAvailable = () => false,
  openPanel = () => false,
  priority = 255
} = {}) {
  if (!anchor || !Number.isFinite(radius) || radius <= 0) throw new Error("Guestbook interaction anchor/radius required");

  let nearby = false;
  let distance = Number.POSITIVE_INFINITY;
  let blocked = false;

  function open() {
    if (!nearby || blocked || !getAvailable()) return false;
    void openPanel();
    return true;
  }

  function observe(position, state = {}) {
    blocked = state.blocked === true;
    distance = distance2D(position, anchor);
    nearby = !blocked && distance <= radius;
    if (!nearby) return null;

    const available = getAvailable() === true;
    return {
      id: "guestbook",
      icon: available ? "📖" : "🔒",
      label: available ? "방명록 보기" : "로그인 후 방명록",
      shortcut: "F",
      priority,
      distance,
      disabled: !available,
      trigger: open
    };
  }

  return {
    observe,
    open,
    handlesUseKey() { return nearby && !blocked && getAvailable() === true; },
    get nearby() { return nearby; },
    get distance() { return distance; },
    destroy() {}
  };
}
