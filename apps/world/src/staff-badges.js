// Display-only markers from the server's existing staff assignments. Never infer a
// badge from nicknames, presence payloads, or user metadata; no permissions live here.
const GM_BADGE = Object.freeze({ role: "gm", label: "GM", title: "게임 운영자" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 64;
let client = null;
let generation = 0;
let scheduled = false;
const badges = new Map();
const pending = new Map();
const rendered = new WeakMap();

// A session snapshot, reset on login/logout/guest transitions. The server is the
// authority for every result; failures leave names usable without a badge.
export function setStaffBadgeClient(next) {
  generation += 1;
  client = typeof next?.rpc === "function" ? next : null;
  badges.clear();
  for (const request of pending.values()) request.resolve(null);
  pending.clear();
}

export function staffBadgeForUser(userId) {
  return badges.get(userId) ?? null;
}

function requestBadge(userId) {
  if (!client || typeof userId !== "string" || !UUID.test(userId)) return Promise.resolve(null);
  if (badges.has(userId)) return Promise.resolve(staffBadgeForUser(userId));
  if (pending.has(userId)) return pending.get(userId).promise;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  pending.set(userId, { promise, resolve, sent: false });
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
  return promise;
}

async function flush() {
  scheduled = false;
  const session = generation;
  const transport = client;
  const waiting = [...pending].filter(([, request]) => !request.sent);
  for (const [, request] of waiting) request.sent = true;
  for (let offset = 0; offset < waiting.length; offset += MAX_BATCH) {
    const batch = waiting.slice(offset, offset + MAX_BATCH);
    const ids = batch.map(([id]) => id);
    let data;
    try {
      const result = await transport.rpc("get_world_staff_badges_v1", { p_user_ids: ids });
      if (!result?.error && Array.isArray(result?.data)) data = result.data;
    } catch { /* Display lookup must never interrupt World. */ }
    if (session !== generation) return;
    const allowed = new Set(ids);
    const confirmed = new Set((data ?? [])
      .filter((row) => row?.badge_code === "gm" && allowed.has(row.user_id))
      .map((row) => row.user_id));
    for (const [id, request] of batch) {
      const badge = confirmed.has(id) ? GM_BADGE : null;
      badges.set(id, badge);
      pending.delete(id);
      request.resolve(badge);
    }
  }
}

function draw(element, nickname, badge, doc) {
  element.textContent = nickname;
  if (!badge) return;
  const chip = doc.createElement("span");
  chip.className = "staff-badge";
  chip.textContent = badge.label;
  chip.title = badge.title;
  chip.dataset.role = badge.role;
  chip.setAttribute("aria-label", badge.title);
  element.appendChild(chip);
}

export function renderStaffName(element, nickname, userId, doc = document) {
  const badge = staffBadgeForUser(userId);
  const token = {};
  rendered.set(element, token);
  draw(element, nickname, badge, doc);
  if (client && !badges.has(userId)) {
    const session = generation;
    requestBadge(userId).then((loaded) => {
      // A delayed response must not overwrite a newer identity or a guest name.
      if (loaded && session === generation && rendered.get(element) === token) {
        draw(element, nickname, loaded, doc);
      }
    });
  }
  return badge;
}
