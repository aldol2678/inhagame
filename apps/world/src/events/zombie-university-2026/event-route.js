import { GEONMULJU_BUILDING } from "../../back-market-layout.js";
import { BACK_GATE_FRAME } from "../../back-gate-layout.js";
import { CULTURE_GATE_STATION, CULTURE_LENGTH, culturePoint } from "../../culture-street-layout.js";

const clampStation = station => Math.max(1, Math.min(CULTURE_LENGTH - 1, station));

const MCM_2026_EVENT_PREVIEW_ALIASES = Object.freeze(["mcm-2026-preview", "zombie-university-2026"]);
const MCM_2026_MINIGAME_PREVIEW_ALIASES = Object.freeze(["zombie-minigame-preview", "zombie-minigame"]);

export function isMcm2026PreviewRequest({ hostname = "", search = "" } = {}) {
  const host = String(hostname).toLowerCase();
  const allowedHost = host.endsWith(".vercel.app")
    || ["localhost", "127.0.0.1", "inhagame.example", "www.inhagame.example"].includes(host);
  if (!allowedHost) return false;
  const params = new URLSearchParams(search);
  return MCM_2026_EVENT_PREVIEW_ALIASES.includes(params.get("event"))
    || MCM_2026_MINIGAME_PREVIEW_ALIASES.includes(params.get("start"));
}

export function isMcm2026OutdoorPreviewRequest(locationLike = {}) {
  if (!isMcm2026PreviewRequest(locationLike)) return false;
  const params = new URLSearchParams(locationLike.search ?? "");
  return MCM_2026_EVENT_PREVIEW_ALIASES.includes(params.get("event"));
}

// QA preview only: `&mcmAt=2026-09-30T11:59:50+09:00` starts the in-memory preview clock at that
// instant so each live phase can be reviewed. Live play never reads this (server time decides).
export function mcm2026PreviewStartMs(locationLike = {}) {
  if (!isMcm2026PreviewRequest(locationLike)) return null;
  const raw = new URLSearchParams(locationLike.search ?? "").get("mcmAt");
  if (!raw || !/(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export const MCM_2026_ROUTE = Object.freeze({
  source: "inha_77_entrance / INHA Culture Street",
  guide: Object.freeze({ ...BACK_GATE_FRAME.at(-1.4, 5.2) }),
  staggering: Object.freeze(culturePoint(clampStation(CULTURE_GATE_STATION - 8.5), .55)),
  dancing: Object.freeze(culturePoint(clampStation(CULTURE_GATE_STATION + 5.5), .15)),
  hungry: Object.freeze(culturePoint(clampStation(CULTURE_GATE_STATION + 15.5), -.45)),
  venue: Object.freeze({
    id: "mcm_2026_venue_geonmulju",
    address: "인천 미추홀구 인하로67번길 24-31 1층",
    roadId: "culture_67_link",
    position: Object.freeze({ ...GEONMULJU_BUILDING.door })
  }),
  venueAuthority: "2026-04 street-view/map reference; game-side road approach, not a surveyed physical threshold"
});

export const MCM_2026_ROUTE_ANCHORS = Object.freeze([
  MCM_2026_ROUTE.guide,
  MCM_2026_ROUTE.staggering,
  MCM_2026_ROUTE.dancing,
  MCM_2026_ROUTE.hungry,
  MCM_2026_ROUTE.venue.position
]);
