import { EVENT_ID } from '../src/events/event-registry.js';

export const MCM_2026_EVENT_ID = EVENT_ID.MCM_2026;
export const MCM_2026_EVENT_ACTIONS = Object.freeze([
  'status',
  'start',
  'investigate_staggering',
  'investigate_dancing',
  'investigate_hungry'
]);

export const MCM_2026_INVESTIGATIONS = Object.freeze({
  investigate_staggering: 'staggering',
  investigate_dancing: 'dancing',
  investigate_hungry: 'hungry'
});

export function createLocalMcm2026State() {
  return {
    eventId: MCM_2026_EVENT_ID,
    eventState: 'ACTIVE',
    startsAt: null,
    endsAt: null,
    serverNow: new Date().toISOString(),
    progress: {
      stage: 'NOT_STARTED',
      investigated: [],
      startedAt: null,
      venueUnlockedAt: null,
      completedAt: null
    },
    landlord: { firstClearedAt: null, activeRun: null }
  };
}

export function advanceLocalMcm2026State(current, action) {
  const state = structuredClone(current ?? createLocalMcm2026State());
  state.serverNow = new Date().toISOString();
  if (action === 'status') return state;
  if (!MCM_2026_EVENT_ACTIONS.includes(action)) throw Error('INVALID_QUEST_EVENT');
  if (action === 'start') {
    if (state.progress.stage === 'NOT_STARTED') {
      state.progress.stage = 'STARTED';
      state.progress.startedAt = state.serverNow;
    }
    return state;
  }
  if (state.progress.stage !== 'STARTED') return state;
  const investigation = MCM_2026_INVESTIGATIONS[action];
  if (investigation && !state.progress.investigated.includes(investigation)) {
    state.progress.investigated = [...state.progress.investigated, investigation].sort();
  }
  if (state.progress.investigated.length === 3) {
    state.progress.stage = 'VENUE_UNLOCKED';
    state.progress.venueUnlockedAt ??= state.serverNow;
  }
  return state;
}
