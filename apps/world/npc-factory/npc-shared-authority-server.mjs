import { readFileSync } from 'node:fs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { mergeCampusPopulation } from './npc-campus-expansion.mjs';
import { bindSharedSchedule } from './npc-shared-schedule.mjs';
import { createSharedMeetings } from './npc-shared-meetings.mjs';
import { createSharedNpcAuthorityP0 } from './npc-shared-authority-p0.mjs';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';

export const SHARED_NPC_P0_IDS = Object.freeze([
  'INKYUNG-NPC-003',
  'INKYUNG-NPC-012'
]);

let singleton = null;

export function createCampusSharedNpcAuthorityP0() {
  if (singleton) return singleton;

  // Keep file URLs literal so serverless file tracing includes these committed authority inputs.
  const baseBatch = JSON.parse(readFileSync(
    new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
  const baseRoster = JSON.parse(readFileSync(
    new URL('./data/fixtures/public-roster.json', import.meta.url), 'utf8'));
  const expansion = JSON.parse(readFileSync(
    new URL('./data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));
  const { batch, roster: profiles } = mergeCampusPopulation(baseBatch, baseRoster, expansion);
  const navigator = createNpcNavigator(batch);
  const roster = bindSharedSchedule(
    createPurposefulRoster(batch, navigator),
    navigator,
    () => Date.now()
  );

  createSharedMeetings({
    batch,
    profiles,
    roster,
    navigator,
    now: () => Date.now()
  });

  singleton = createSharedNpcAuthorityP0({
    roster,
    pilotIds: SHARED_NPC_P0_IDS,
    getPlaceZoneId: position => getPlaceZoneAt(position)?.id ?? null
  });
  return singleton;
}
