// 좀비대학교 (event.mcm_2026) live schedule — the one client-side place for event times.
//
// Authority split:
// - The playable window (OUTBREAK start → ENDED) is owned by the database (`private.world_events`,
//   migration 20260928120000_world_mcm_2026_live_window.sql). Progress, runs and claims are gated
//   by the server `eventState` computed from the DB clock; nothing here can open them.
// - PRELUDE / WARNING / ONSITE_LIVE are presentation phases (NPC lines, HUD copy). They are
//   projected from server time (`serverNow` offset) when a server state is known, and from the
//   local clock only for signed-out presentation.
// Every boundary is an absolute instant with an explicit +09:00 offset, so the browser time zone
// never changes the result.
import { MCM_2026_EVENT_STATE, MCM_2026_PROGRESS_STAGE } from "./event-data.js";

export const MCM_2026_TIME_ZONE = "Asia/Seoul";

export const MCM_2026_SCHEDULE = Object.freeze({
  preludeStartsAt: "2026-09-28T00:00:00+09:00",
  warningStartsAt: "2026-09-29T23:00:00+09:00",
  // Mirrors private.world_events.starts_at / ends_at (the server is the authority).
  outbreakStartsAt: "2026-09-30T00:00:00+09:00",
  onsiteLiveStartsAt: "2026-09-30T18:00:00+09:00",
  endsAt: "2026-10-01T01:00:00+09:00"
});

export const MCM_2026_PHASE = Object.freeze({
  SCHEDULED: "SCHEDULED",
  PRELUDE: "PRELUDE",
  WARNING: "WARNING",
  OUTBREAK: "OUTBREAK",
  ONSITE_LIVE: "ONSITE_LIVE",
  ENDED: "ENDED",
  DISABLED: "DISABLED"
});

const P = MCM_2026_PHASE;
const S = MCM_2026_EVENT_STATE;
const at = iso => Date.parse(iso);
const bounds = schedule => ({
  prelude: at(schedule.preludeStartsAt),
  warning: at(schedule.warningStartsAt),
  outbreak: at(schedule.outbreakStartsAt),
  live: at(schedule.onsiteLiveStartsAt),
  end: at(schedule.endsAt)
});

/** Phase from time alone. Each boundary instant belongs to the phase it starts. */
export function mcm2026PhaseAt(nowMs, schedule = MCM_2026_SCHEDULE) {
  if (!Number.isFinite(nowMs)) return P.SCHEDULED;
  const b = bounds(schedule);
  if (nowMs < b.prelude) return P.SCHEDULED;
  if (nowMs < b.warning) return P.PRELUDE;
  if (nowMs < b.outbreak) return P.WARNING;
  if (nowMs < b.live) return P.OUTBREAK;
  if (nowMs < b.end) return P.ONSITE_LIVE;
  return P.ENDED;
}

/** The DB `world_event_state_v1` rule on the same window. Only the in-memory QA preview uses it. */
export function mcm2026ServerStateAt(nowMs, schedule = MCM_2026_SCHEDULE) {
  const b = bounds(schedule);
  if (!Number.isFinite(nowMs) || nowMs < b.outbreak) return S.SCHEDULED;
  return nowMs < b.end ? S.ACTIVE : S.ENDED;
}

/**
 * Presentation phase. A server `eventState` always wins for anything playable: a skewed or edited
 * local clock can relabel copy, but it can never turn SCHEDULED into OUTBREAK or ENDED into LIVE.
 */
export function resolveMcm2026Phase({ eventState = null, nowMs, schedule = MCM_2026_SCHEDULE } = {}) {
  const timed = mcm2026PhaseAt(nowMs, schedule);
  if (eventState === S.DISABLED) return P.DISABLED;
  if (eventState === S.ENDED) return P.ENDED;
  if (eventState === S.ACTIVE) return timed === P.ONSITE_LIVE ? P.ONSITE_LIVE : P.OUTBREAK;
  if (eventState === S.SCHEDULED) {
    // Time says the window opened but the server has not confirmed it yet: stay on the warning.
    return [P.OUTBREAK, P.ONSITE_LIVE, P.ENDED].includes(timed) ? P.WARNING : timed;
  }
  return timed;
}

export const isMcm2026PlayablePhase = phase => phase === P.OUTBREAK || phase === P.ONSITE_LIVE;
export const isMcm2026TeaserPhase = phase => phase === P.PRELUDE || phase === P.WARNING;

/** Milliseconds until the investigation opens (0 once it has). */
export function mcm2026MsUntilOutbreak(nowMs, schedule = MCM_2026_SCHEDULE) {
  return Math.max(0, at(schedule.outbreakStartsAt) - nowMs);
}

/** Short Korean countdown such as "1일 3시간", "2시간 5분" or "4분". */
export function formatMcm2026Countdown(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
  return `${Math.max(1, mins)}분`;
}

/**
 * Geonmulju room entry. New entries need the server window open (ACTIVE). After ENDED only an
 * account that already has a server-recorded clear may come back, to settle what it earned.
 */
export function mcm2026CanEnterVenue(state) {
  const stage = state?.progress?.stage;
  if (stage !== MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED && stage !== MCM_2026_PROGRESS_STAGE.COMPLETED) return false;
  if (state.eventState === S.ACTIVE) return true;
  return state.eventState === S.ENDED && Boolean(state.landlord?.firstClearedAt);
}

// PRELUDE → ONSITE_LIVE: all four ZUE NPCs stand in the world. ENDED/DISABLED: the event cast is fully retired.
export function mcm2026ActorVisible(_actorId, phase) {
  return isMcm2026TeaserPhase(phase) || isMcm2026PlayablePhase(phase);
}

export const MCM_2026_TALK = Object.freeze({
  TEASER: "TEASER",   // atmosphere line only
  ENDED: "ENDED",     // farewell line only
  LOGIN: "LOGIN",     // playable phase but no signed-in server state
  LOCKED: "LOCKED",   // anything else the server has not opened
  PLAY: "PLAY"        // may call the trusted progress endpoint
});

/** What an NPC talk may do. Only PLAY ever reaches the progress endpoint. */
export function mcm2026TalkMode({ phase, eventState = null } = {}) {
  if (isMcm2026TeaserPhase(phase)) return MCM_2026_TALK.TEASER;
  if (phase === P.ENDED) return MCM_2026_TALK.ENDED;
  if (!isMcm2026PlayablePhase(phase)) return MCM_2026_TALK.LOCKED;
  if (eventState === null) return MCM_2026_TALK.LOGIN;
  return eventState === S.ACTIVE ? MCM_2026_TALK.PLAY : MCM_2026_TALK.LOCKED;
}
