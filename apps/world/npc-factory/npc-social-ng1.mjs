import { createNpcSocialSimulation, summarizeNpcSocialSnapshot } from './npc-social-sim.mjs';

const CLUSTER_LABEL = Object.freeze({
  CREATIVE: '창작',
  TECH: '기술',
  LEARNING: '학습',
  LIFESTYLE: '생활',
  EXPLORE: '탐험'
});

const STATUS_LABEL = Object.freeze({
  FORMING: '모이는 중',
  ACTIVE: '활동 중',
  DISSOLVED: '해산'
});

const EVENT_LABEL = Object.freeze({
  GROUP_CREATED: '모임 생성',
  GROUP_ACTIVATED: '정식 활동 시작',
  GROUP_MEETING_PLACE_SET: '정기 모임 장소 확정',
  GROUP_REGULAR_MEETING_COMPLETED: '정기 모임 완료',
  GROUP_REGULAR_MEETING_MISSED: '정기 모임 불발',
  MEMBER_JOINED: '가입',
  MEMBER_LEFT: '탈퇴',
  GROUP_DISSOLVED: '해산'
});

export function createNpcSocialNg1Model(batch, {
  seed = 'inkyung-ng1-preview',
  secondsPerSocialTick = 0.25,
  observationProvider,
  relationshipGraph = null,
  groupCandidateValidator = null
} = {}) {
  if (!(secondsPerSocialTick > 0)) throw new Error('NG1 social tick interval must be positive');
  const byId = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const sim = createNpcSocialSimulation(batch, {
    seed,
    observationProvider,
    meetingAffinityGain: 2,
    relationshipPreferenceProvider: relationshipGraph
      ? ({ npcA, npcB }) => Math.min(16, relationshipGraph.seedAffinity(npcA.npc_id, npcB.npc_id) * .6)
      : undefined,
    groupCandidateValidator
  });
  let elapsed = 0;
  let selectedNpcId = batch.npcs[0]?.npc_id ?? null;

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('NG1 update dt must be non-negative');
    elapsed += dt;
    let changed = false;
    while (elapsed >= secondsPerSocialTick) {
      elapsed -= secondsPerSocialTick;
      sim.step({ snapshot: false });
      changed = true;
    }
    return changed;
  }

  function snapshot() { return sim.snapshot(); }
  function viewSnapshot() { return sim.viewSnapshot(); }

  function recordGroupMeetingOutcome(groupId, outcome = 'COMPLETED', attendance = null) {
    const group = sim.viewSnapshot().groups.find(item => item.groupId === groupId) ?? null;
    const accepted = sim.recordGroupMeetingOutcome(groupId, outcome, attendance);
    if (accepted && relationshipGraph) {
      const memberNpcIds = attendance?.attendedNpcIds?.length
        ? attendance.attendedNpcIds
        : group?.memberNpcIds ?? [];
      relationshipGraph.recordMeeting(groupId, memberNpcIds, outcome, sim.viewSnapshot().tick);
    }
    return accepted;
  }

  function advanceTicks(count = 1) {
    if (!Number.isInteger(count) || count < 0) throw new Error('NG1 advance count must be a non-negative integer');
    sim.run(count, { snapshot: false });
    elapsed = 0;
    return status();
  }

  function groupForNpc(id, current = snapshot()) {
    return current.groups.find(group => group.status !== 'DISSOLVED' && group.memberNpcIds.includes(id)) ?? null;
  }

  function recentEventsForNpc(id, limit = 3, current = snapshot()) {
    const groupIds = new Set(current.groups.filter(group => group.memberNpcIds.includes(id)).map(group => group.groupId));
    return current.recentEvents
      .filter(event => event.npcId === id || event.leaderNpcId === id ||
        event.memberNpcIds?.includes(id) || groupIds.has(event.groupId))
      .slice(-limit)
      .reverse();
  }

  function closeTiesForNpc(id, limit = 3) {
    const rows = new Map();
    for (const row of sim.relationsFor(id, Math.max(limit, 6))) {
      rows.set(row.otherNpcId, {
        npcId: row.otherNpcId,
        name: byId.get(row.otherNpcId)?.identity?.name ?? row.otherNpcId,
        affinity: row.affinity,
        dynamicAffinity: row.affinity,
        encounterCount: row.encounterCount,
        sharedActivityCount: row.sharedActivityCount,
        lastInteractionTick: row.lastInteractionTick,
        persistentBond: 0,
        reasons: []
      });
    }
    for (const row of relationshipGraph?.tiesFor(id, Math.max(limit, 6)) ?? []) {
      const current = rows.get(row.otherNpcId) ?? {
        npcId: row.otherNpcId,
        name: byId.get(row.otherNpcId)?.identity?.name ?? row.otherNpcId,
        affinity: 0,
        dynamicAffinity: 0,
        encounterCount: 0,
        sharedActivityCount: 0,
        lastInteractionTick: null,
        persistentBond: 0,
        reasons: []
      };
      current.affinity = Math.round((current.dynamicAffinity + row.seedAffinity) * 1000) / 1000;
      current.persistentBond = row.persistentBond;
      current.reasons = [...row.reasons];
      rows.set(row.otherNpcId, current);
    }
    return [...rows.values()]
      .sort((a, b) => b.affinity - a.affinity ||
        b.encounterCount - a.encounterCount ||
        a.npcId.localeCompare(b.npcId))
      .slice(0, limit);
  }

  function profile(id = selectedNpcId, current = snapshot()) {
    const npc = byId.get(id);
    if (!npc) return null;
    const group = groupForNpc(id, current);
    return {
      npcId: id,
      name: npc.identity?.name ?? id,
      interests: [...(npc.interests ?? [])],
      group: group ? {
        groupId: group.groupId,
        label: `${CLUSTER_LABEL[group.primaryInterest] ?? group.primaryInterest} 모임`,
        status: group.status,
        statusLabel: STATUS_LABEL[group.status] ?? group.status,
        role: group.leaderNpcId === id ? '리더' : '회원',
        members: [...group.memberNpcIds]
      } : null,
      closeTies: closeTiesForNpc(id, 3),
      events: recentEventsForNpc(id, 3, current)
    };
  }

  function profileLine(id = selectedNpcId) {
    const value = profile(id);
    if (!value) return '';
    const tie = value.closeTies.find(item =>
      item.persistentBond > 0 || item.encounterCount >= 2 || item.affinity >= 12);
    const tieLine = tie ? ` · 가까운 사이 ${tie.name}` : '';
    if (!value.group) return `현재 소속된 NPC 모임이 없습니다.${tieLine}`;
    return `${value.group.label} · ${value.group.role} · ${value.group.statusLabel}${tieLine}`;
  }

  function relationshipLine(id = selectedNpcId) {
    const tie = closeTiesForNpc(id, 3).find(item =>
      item.persistentBond > 0 || item.encounterCount >= 2 || item.affinity >= 12);
    return tie ? `${tie.name}하고 요즘 자주 어울려요.` : '';
  }

  function status() {
    const current = viewSnapshot();
    return {
      ...summarizeNpcSocialSnapshot(current),
      selectedNpcId,
      selectedProfile: profile(selectedNpcId, current),
      groups: current.groups.filter(group => group.status !== 'DISSOLVED').map(group => ({
        groupId: group.groupId,
        label: `${CLUSTER_LABEL[group.primaryInterest] ?? group.primaryInterest} 모임`,
        status: group.status,
        statusLabel: STATUS_LABEL[group.status] ?? group.status,
        leaderNpcId: group.leaderNpcId,
        memberNpcIds: [...group.memberNpcIds],
        cohesion: group.cohesion,
        activity: group.activity,
        meetingPlaceRef: group.meetingPlaceRef ?? null,
        meetingCadenceTicks: group.meetingCadenceTicks ?? null,
        lastMeetingTick: group.lastMeetingTick ?? null,
        lastMeetingOutcome: group.lastMeetingOutcome ?? null,
        lastMeetingAttendance: group.lastMeetingAttendance ? {
          invitedNpcIds: [...group.lastMeetingAttendance.invitedNpcIds],
          attendedNpcIds: [...group.lastMeetingAttendance.attendedNpcIds],
          onTimeNpcIds: [...group.lastMeetingAttendance.onTimeNpcIds],
          lateNpcIds: [...group.lastMeetingAttendance.lateNpcIds],
          absentNpcIds: [...group.lastMeetingAttendance.absentNpcIds]
        } : null,
        nextMeetingTick: group.nextMeetingTick ?? null
      }))
    };
  }

  return {
    update,
    advanceTicks,
    snapshot,
    viewSnapshot,
    recordGroupMeetingOutcome,
    status,
    profile,
    profileLine,
    relationshipLine,
    setSelectedNpc(id) {
      if (!byId.has(id)) throw new Error('Unknown NG1 NPC');
      selectedNpcId = id;
      return profile(id);
    }
  };
}

function eventText(event, npcName) {
  const label = EVENT_LABEL[event.type] ?? event.type;
  if (event.type === 'MEMBER_JOINED' || event.type === 'MEMBER_LEFT') {
    return `${label} · ${npcName(event.npcId)}`;
  }
  return label;
}

export function mountNpcSocialNg1Panel({ model, batch, documentLike = document } = {}) {
  if (!model || !documentLike?.body) throw new Error('NG1 model and document required');
  const npcName = id => batch.npcs.find(npc => npc.npc_id === id)?.identity?.name ?? id;
  const panel = documentLike.createElement('aside');
  panel.id = 'npc-social-ng1';
  panel.setAttribute('aria-label', 'NPC 모임 관찰');
  panel.innerHTML = `
    <header>
      <div><strong>NPC 모임 관찰</strong><small>NG1 · 로컬 읽기 전용</small></div>
      <button type="button" aria-expanded="true">접기</button>
    </header>
    <div class="npc-social-ng1-body">
      <p class="npc-social-ng1-summary"></p>
      <section class="npc-social-ng1-profile"></section>
      <section class="npc-social-ng1-groups"></section>
      <section class="npc-social-ng1-events"></section>
      <p class="npc-social-ng1-note">공유 DB에 저장되지 않는 Preview 상태입니다.</p>
    </div>`;
  const style = documentLike.createElement('style');
  style.textContent = `
    #npc-social-ng1{position:fixed;left:12px;top:72px;z-index:101;width:min(330px,calc(100vw - 24px));max-height:calc(100vh - 92px);overflow:auto;border:1px solid #567989;border-radius:12px;background:#0f202af2;color:#eef8f8;box-shadow:0 10px 32px #0007;font:12px/1.45 system-ui,sans-serif}
    #npc-social-ng1 header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;border-bottom:1px solid #34515d}
    #npc-social-ng1 header div{display:grid}#npc-social-ng1 header strong{font-size:14px}#npc-social-ng1 header small{color:#93adb5}
    #npc-social-ng1 button{border:1px solid #526d78;border-radius:7px;background:#18313d;color:#e9f6f5;padding:5px 8px}
    .npc-social-ng1-body{display:grid;gap:8px;padding:10px}.npc-social-ng1-summary,.npc-social-ng1-note{margin:0;color:#adc4ca}
    .npc-social-ng1-profile,.npc-social-ng1-groups,.npc-social-ng1-events{display:grid;gap:5px;padding:8px;border:1px solid #294955;border-radius:9px;background:#132b35}
    .npc-social-ng1-group{display:grid;gap:2px;padding:6px;border-radius:7px;background:#193640}.npc-social-ng1-group small{color:#a8bec4}
    @media(max-width:650px){#npc-social-ng1{top:58px;left:8px;width:min(300px,calc(100vw - 16px));max-height:42vh}}
  `;
  documentLike.head?.appendChild(style);
  documentLike.body.appendChild(panel);

  const body = panel.querySelector('.npc-social-ng1-body');
  panel.querySelector('button').addEventListener('click', event => {
    const open = event.currentTarget.getAttribute('aria-expanded') === 'true';
    event.currentTarget.setAttribute('aria-expanded', String(!open));
    event.currentTarget.textContent = open ? '펼치기' : '접기';
    body.hidden = open;
  });

  function render() {
    const state = model.status();
    const profile = state.selectedProfile;
    panel.querySelector('.npc-social-ng1-summary').textContent =
      `Social tick ${state.tick} · 활동 모임 ${state.liveGroups} · 생성 ${state.eventCounts.GROUP_CREATED ?? 0}`;

    const profileEl = panel.querySelector('.npc-social-ng1-profile');
    profileEl.replaceChildren();
    const title = documentLike.createElement('strong');
    title.textContent = profile ? `${profile.name} 프로필` : 'NPC 프로필';
    const line = documentLike.createElement('span');
    line.textContent = profile ? model.profileLine(profile.npcId) : '선택된 NPC 없음';
    profileEl.append(title, line);

    const groupsEl = panel.querySelector('.npc-social-ng1-groups');
    groupsEl.replaceChildren();
    const groupTitle = documentLike.createElement('strong');
    groupTitle.textContent = '현재 모임';
    groupsEl.append(groupTitle);
    for (const group of state.groups) {
      const item = documentLike.createElement('div');
      item.className = 'npc-social-ng1-group';
      const leader = npcName(group.leaderNpcId);
      item.innerHTML = `<b></b><small></small>`;
      item.querySelector('b').textContent = `${group.label} · ${group.statusLabel}`;
      item.querySelector('small').textContent =
        `${group.memberNpcIds.length}명 · 리더 ${leader} · 결속 ${Math.round(group.cohesion)}`;
      groupsEl.append(item);
    }
    if (!state.groups.length) {
      const empty = documentLike.createElement('span');
      empty.textContent = '아직 만들어진 모임이 없습니다.';
      groupsEl.append(empty);
    }

    const eventsEl = panel.querySelector('.npc-social-ng1-events');
    eventsEl.replaceChildren();
    const eventTitle = documentLike.createElement('strong');
    eventTitle.textContent = '최근 사회 사건';
    eventsEl.append(eventTitle);
    const recent = model.snapshot().recentEvents.slice(-5).reverse();
    for (const event of recent) {
      const row = documentLike.createElement('span');
      row.textContent = `#${event.tick} · ${eventText(event, npcName)}`;
      eventsEl.append(row);
    }
    if (!recent.length) {
      const empty = documentLike.createElement('span');
      empty.textContent = '아직 사건이 없습니다.';
      eventsEl.append(empty);
    }
  }

  render();
  return { render, element: panel, dispose() { panel.remove(); style.remove(); } };
}
