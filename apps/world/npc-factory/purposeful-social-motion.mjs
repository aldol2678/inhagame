import { positionAt } from './dev-runtime-state.mjs';
import { runtimePresence } from './npc-presence.mjs';

// These coworkers share the morning waterfront, then have different class-time
// destinations. They can walk to the photo point together before splitting up.
export const SOCIAL_PAIR_IDS = Object.freeze(['INKYUNG-NPC-003', 'INKYUNG-NPC-012']);
const SOURCE_PERIOD = 'morning';
const SOCIAL_PERIOD = 'class_time';
const SOURCE_LOCATION = 'inkyung_waterfront';
const WALK_DESTINATION = 'inkyung_photo_point';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createPurposefulSocialMotion(batch, roster, navigator) {
  const members = SOCIAL_PAIR_IDS.map(id => {
    const npc = batch.npcs.find(item => item.npc_id === id);
    const purpose = roster.get(id);
    if (!npc || !purpose || runtimePresence(npc, SOURCE_PERIOD).slot.location !== SOURCE_LOCATION ||
        runtimePresence(npc, SOCIAL_PERIOD).slot.location === 'off_zone')
      throw new Error(`Missing social motion participant: ${id}`);
    return { id, npc, ...purpose };
  });
  if (!members.every(({ npc }, index) => npc.relationships.some(relation =>
    relation.target_id === members[1 - index].id && relation.type === 'coworker')))
    throw new Error('Social motion pair relationship changed');
  if (members[0].schedule[1].destination === members[1].schedule[1].destination)
    throw new Error('Social motion pair no longer separates after the walk');

  const sources = members.map(({ destinations, schedule }) => destinations[schedule[0].destination].position);
  const photoVisitors = [...roster.values()].filter(({ destinations }) =>
    Object.keys(destinations).some(key => key.includes(`.${WALK_DESTINATION}.`))).length;
  const targets = members.map(({ id }, index) => {
    // Stay clear of AI NPC 002 (slot 0) and the roster's own photo-point slots.
    const position = positionAt(WALK_DESTINATION, photoVisitors + 1 + index);
    if (!navigator.walkable(position) || !navigator.route(sources[index], position))
      throw new Error(`Unreachable social destination: ${id}`);
    return { destination: `c04.social.${WALK_DESTINATION}.${id}`, position };
  });
  let period = SOURCE_PERIOD, phase = 'INACTIVE', phaseTime = 0;
  const nearSource = () => members.every(({ controller }, index) => {
    const state = controller.status(false);
    return state.visible && !state.interrupted && distance(state.position, sources[index]) <= 3;
  });
  const atOwnGoal = () => members.every(({ controller, schedule }) => {
    const state = controller.status(false);
    return state.visible && !state.interrupted && state.scheduleIndex === 1 &&
      state.phase === 'ACTING' && state.destination === schedule[1].destination;
  });
  function setPeriod(nextPeriod) {
    if (nextPeriod === period) return;
    phase = nextPeriod === SOCIAL_PERIOD && period === SOURCE_PERIOD && nearSource()
      ? 'WAIT' : 'INACTIVE';
    period = nextPeriod;
    phaseTime = 0;
  }
  function shouldPauseForConversation(id, conversationId) {
    return Boolean(conversationId && SOCIAL_PAIR_IDS.includes(id) &&
      SOCIAL_PAIR_IDS.includes(conversationId) &&
      ['WAIT', 'JOIN', 'WALK_TOGETHER', 'SEPARATE'].includes(phase));
  }
  function shouldHoldForJoin(id) {
    return SOCIAL_PAIR_IDS.includes(id) && ['WAIT', 'JOIN'].includes(phase);
  }
  function tick(dt, conversationId = null) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid social motion tick');
    if (period !== SOCIAL_PERIOD || dt === 0 ||
        shouldPauseForConversation(SOCIAL_PAIR_IDS[0], conversationId)) return status();
    if (members.some(({ controller }) => controller.status(false).phase === 'FAILED')) {
      phase = 'FAILED'; return status();
    }
    if (phase === 'WAIT') {
      if (!nearSource()) { phase = 'INACTIVE'; phaseTime = 0; }
      else if ((phaseTime += dt) >= 2) { phase = 'JOIN'; phaseTime = 0; }
    } else if (phase === 'JOIN') {
      if (!nearSource()) { phase = 'INACTIVE'; phaseTime = 0; }
      else if ((phaseTime += dt) >= 1) {
        for (const { controller } of members) controller.resume();
        const started = members.map(({ controller }, index) => controller.beginDetour(targets[index]));
        if (started.every(Boolean)) { phase = 'WALK_TOGETHER'; phaseTime = 0; }
        else {
          for (const { controller } of members) controller.endDetour();
          phase = 'FAILED';
        }
      }
    } else if (phase === 'WALK_TOGETHER') {
      const arrived = members.every(({ controller }) => {
        const state = controller.status(false);
        return state.interrupted && state.phase === 'ACTING';
      });
      phaseTime = arrived ? phaseTime + dt : 0;
      if (phaseTime >= 2) {
        const resumed = members.map(({ controller }) => controller.endDetour());
        phase = resumed.every(Boolean) ? 'SEPARATE' : 'FAILED';
        phaseTime = 0;
      }
    } else if (phase === 'SEPARATE' && atOwnGoal()) phase = 'COMPLETE';
    return status();
  }
  function status() { return { phase, period, pairIds: [...SOCIAL_PAIR_IDS], sharedDestination: WALK_DESTINATION }; }
  return { tick, status, setPeriod, shouldPauseForConversation, shouldHoldForJoin };
}
