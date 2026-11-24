// Display-only markers from the server's existing staff assignments. Never infer a
// badge from nicknames, presence payloads, or user metadata; no permissions live here.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open; snapshot import 2026-11-23): the lookup
// authenticates with the snapshot session id in the `X-Session-Id` header only — no other
// credential header is sent. The id is read lazily by readGuestSessionId()
// (activity/session-id.js: localStorage 'inhaworld-firebase-session-v1', fallback
// 'inhaworld-guest-session-v1'; null when absent — never fabricated). User ids travel as the
// `ids` query parameter, comma-joined; there is no JSON body fallback.
// Before: setStaffBadgeClient(client) took the signed-in permanent-account client and the
// lookup went through its rpc("get_world_staff_badges_v1", { p_user_ids }) with that account's
// session. That path is gone; only the transport changed — batching, caching and rendering
// are unchanged.
import { readGuestSessionId } from "./activity/session-id.js";

export const STAFF_BADGES_RPC = "get_world_staff_badges_v1";
export const STAFF_BADGES_API_PATH = "/api/world-staff-badges";
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
// Binds the session supplier for badge lookups: null clears it; an options object
// { getSessionId, fetcher, endpoint } binds it. getSessionId defaults to
// readGuestSessionId (the single source), fetcher to global fetch, endpoint to the
// same-host Tier 4 path (absolute only for isolated tests). Anything else clears.
export function setStaffBadgeClient(next) {
  generation += 1;
  client = next && typeof next === "object" && !Array.isArray(next)
    ? {
        getSessionId: typeof next.getSessionId === "function" ? next.getSessionId : readGuestSessionId,
        fetcher: typeof next.fetcher === "function" ? next.fetcher : (...args) => globalThis.fetch(...args),
        endpoint: typeof next.endpoint === "string" && next.endpoint ? next.endpoint : STAFF_BADGES_API_PATH
      }
    : null;
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
  let sessionId = null;
  try {
    const id = await transport?.getSessionId?.();
    sessionId = typeof id === "string" && id ? id : null;
  } catch { sessionId = null; }
  for (let offset = 0; offset < waiting.length; offset += MAX_BATCH) {
    const batch = waiting.slice(offset, offset + MAX_BATCH);
    const ids = batch.map(([id]) => id);
    let data;
    // No session: resolve the batch without a badge and send nothing.
    if (sessionId) {
      try {
        const url = `${transport.endpoint.replace(/\/$/, "")}?ids=${ids.map(encodeURIComponent).join(",")}`;
        const response = await transport.fetcher(url, { headers: { "X-Session-Id": sessionId } });
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload)) data = payload;
          else if (Array.isArray(payload?.badges)) data = payload.badges;
        }
        // 400 (bad ids), 401/403 and any other refusal: data stays unset and the
        // batch resolves without badges. Display lookup must never interrupt World.
      } catch { /* Display lookup must never interrupt World. */ }
    }
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
