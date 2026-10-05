import { metersToWorld } from '../src/world-scale.js';
import { OBSERVED_TEMPLATES, observedPlace, renderObservedTemplate } from './npc-observed-templates.mjs';

export const OBSERVED_POLICY = Object.freeze({ enter: metersToWorld(8), exit: metersToWorld(12),
  pairDistance: metersToWorld(4), tripleRadius: metersToWorld(5), groupCooldown: 240,
  playerCooldown: 60, lineSeconds: 3.2, scanSeconds: .5, minAffinity: 12 });
const keyFor = ids => [...ids].sort().join('|');
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const allowed = new Set(['RESTING','READING','COFFEE','EATING','PHOTO','PHONE','WAITING','TRANSIT','WALK_BREAK','SOCIAL_MEETUP']);
export const observableNpc = npc => Boolean(npc && npc.visible === true && validPoint(npc.position) &&
  npc.phase === 'ACTING' && !npc.moving && !npc.paused && !npc.busy &&
  (!npc.interrupted || npc.meetingId) && allowed.has(npc.activity));

export function observedCandidates({ npcs, player, forward, groups = [], pairInfo }, policy = OBSERVED_POLICY) {
  if (!validPoint(player)) return [];
  const nearby = npcs.filter(n => observableNpc(n) && distance(n.position, player) <= policy.enter)
    .sort((a, b) => distance(a.position, player) - distance(b.position, player) || a.id.localeCompare(b.id))
    .slice(0, 12); // At most 286 pair/triple checks, twice per second, no route planning.
  const live = groups.filter(g => g.status !== 'DISSOLVED');
  const result = [];
  function add(members) {
    const center = { x: members.reduce((v,n) => v+n.position.x,0)/members.length,
      z: members.reduce((v,n) => v+n.position.z,0)/members.length };
    if (members.length === 2 ? distance(members[0].position,members[1].position) > policy.pairDistance
      : members.some(n => distance(n.position,center) > policy.tripleRadius)) return;
    const place = observedPlace(members[0].location);
    if (!place || members.some(n => observedPlace(n.location) !== place)) return;
    const group = live.find(g => members.every(n => g.memberNpcIds.includes(n.id)));
    const scores = [];
    for (let i=0;i<members.length;i++) for (let j=i+1;j<members.length;j++) {
      const info = pairInfo(members[i].id,members[j].id) ?? {};
      const strength = Math.max(info.affinity ?? 0, info.persistentBond ?? 0);
      if (!group && strength < policy.minAffinity) return;
      scores.push(strength);
    }
    const strength = Math.min(...scores);
    const meeting = members[0].meetingId && members.every(n => n.meetingId === members[0].meetingId);
    const commonLife = members.every(n => n.department && n.department === members[0].department) ||
      members.every(n => n.residence && n.residence !== 'commuter' && n.residence === members[0].residence);
    const d = distance(center,player);
    const facing = validPoint(forward) && d > 0
      ? ((center.x-player.x)*forward.x+(center.z-player.z)*forward.z)/(d*(Math.hypot(forward.x,forward.z)||1)) : 0;
    result.push({ members, key: keyFor(members.map(n=>n.id)), groupId: group?.groupId ?? null,
      center, place, strength, distance: d, facing,
      priority: meeting ? 0 : strength >= 24 ? 1 : commonLife ? 2 : 3,
      tone: strength >= 40 ? 'high' : strength >= policy.minAffinity ? 'medium' : 'low' });
  }
  for (let i=0;i<nearby.length;i++) for (let j=i+1;j<nearby.length;j++) {
    add([nearby[i],nearby[j]]);
    for (let k=j+1;k<nearby.length;k++) add([nearby[i],nearby[j],nearby[k]]);
  }
  // Distance bands avoid a non-transitive "roughly equal" sort comparator.
  return result.sort((a,b) => a.priority-b.priority ||
    Math.floor(a.distance/metersToWorld(2))-Math.floor(b.distance/metersToWorld(2)) ||
    b.facing-a.facing || b.strength-a.strength || b.members.length-a.members.length || a.key.localeCompare(b.key));
}

export function createObservedConversation({ policy = OBSERVED_POLICY, templates = OBSERVED_TEMPLATES } = {}) {
  let active = null, nextScan = 0, nextPlayer = 0, lastGlobal = null, previousPlayer = null;
  const cooldown = new Map(), history = new Map();
  function keys(candidate) {
    const ids = candidate.members.map(n=>n.id), keys = [candidate.key];
    if (candidate.groupId) keys.push(`group:${candidate.groupId}`);
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) keys.push(keyFor([ids[i],ids[j]]));
    return [...new Set(keys)];
  }
  function stop() { active = null; }
  function update(frame) {
    const { now, npcs = [], player, blocked = false, period } = frame;
    if (!Number.isFinite(now)) throw new TypeError('Monotonic seconds required');
    const teleported = validPoint(player) && previousPlayer && distance(player,previousPlayer) > policy.exit;
    previousPlayer = validPoint(player) ? { x: player.x, z: player.z } : null;
    if (blocked || teleported || !validPoint(player)) { stop(); nextScan = now + policy.scanSeconds; return null; }
    if (active) {
      const members = active.members.map(n=>npcs.find(current=>current.id===n.id));
      if (period !== active.period || members.some(n=>!observableNpc(n) || distance(n.position,player)>=policy.exit) ||
          now >= active.started + active.lines.length*policy.lineSeconds) stop();
      else {
        const center = { x: members.reduce((v,n)=>v+n.position.x,0)/members.length,
          z: members.reduce((v,n)=>v+n.position.z,0)/members.length };
        if (members.length === 2 ? distance(members[0].position,members[1].position)>policy.pairDistance :
          members.some(n=>distance(n.position,center)>policy.tripleRadius)) stop();
      }
    }
    if (!active && now >= nextPlayer && now >= nextScan) {
      nextScan = now + policy.scanSeconds;
      for (const [key, until] of cooldown) if (until <= now) cooldown.delete(key);
      const candidates = observedCandidates(frame,policy);
      for (const candidate of candidates) {
        const memoryKeys = keys(candidate);
        if (memoryKeys.some(k=>(cooldown.get(k)??0)>now)) continue;
        const recent = new Set(memoryKeys.flatMap(k=>history.get(k)??[]));
        const choices = templates.filter(t=>(t.places.includes('*')||t.places.includes(candidate.place)) &&
          !recent.has(t.conversation_id) && t.conversation_id !== lastGlobal);
        if (!choices.length) continue; // Silence is preferable to an immediate repeat.
        const template = choices[Math.floor(now / policy.scanSeconds) % choices.length];
        active = { ...candidate, period, conversation_id: template.conversation_id, started: now,
          lines: renderObservedTemplate(template,candidate.members,{period,tone:candidate.tone}) };
        nextPlayer = now + active.lines.length*policy.lineSeconds + policy.playerCooldown;
        for (const k of memoryKeys) {
          cooldown.set(k,now+active.lines.length*policy.lineSeconds+policy.groupCooldown);
          history.set(k,[...(history.get(k)??[]),template.conversation_id].slice(-3));
        }
        // Bound session-only history even if the future population grows.
        while (history.size > 512) history.delete(history.keys().next().value);
        lastGlobal = template.conversation_id;
        break;
      }
    }
    if (!active) return null;
    const index = Math.floor((now-active.started)/policy.lineSeconds);
    return { conversation_id: active.conversation_id, members: active.members.map(n=>n.id),
      line: active.lines[index], index, tone: active.tone };
  }
  return { update, stop, status: () => ({ active: active?.conversation_id ?? null,
    members: active?.members.map(n=>n.id) ?? [], recentGroups: history.size }) };
}
