import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_NPC_ID, QUEST_NPC_ID, runtimePresence } from './npc-presence.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(readFileSync(join(root, 'data/repaired/INKYUNG-20-A-R1.json'), 'utf8'));
const pilotIds = new Set([MAIN_NPC_ID, QUEST_NPC_ID]);
const npcs = new Map(batch.npcs.filter(npc => pilotIds.has(npc.npc_id)).map(npc => [npc.npc_id, npc]));
const actions = new Set(['stay', 'look_at_player', 'walk_nearby', 'sit_at_bench', 'stand']);
const periods = new Set(['morning', 'class_time', 'lunch', 'evening']);
const periodLabels = { morning: '아침', class_time: '수업 시간', lunch: '점심', evening: '저녁' };
const topicLabels = { architecture: '건축', cooking: '요리', sketching: '스케치', photography: '사진', plants: '식물' };
const activityLabels = {
  idle: '잠시 쉬는 중', read: '글을 읽는 중', sit: '벤치에 앉아 쉬는 중', wait: '기다리는 중',
  walk: '길을 걷는 중', use_phone: '휴대폰 메모를 보는 중', talk_with_friend: '친구와 이야기하는 중'
};
const locationLabels = {
  main_gate: '정문',
  inkyung_spawn: '인경호 시작 지점', inkyung_waterfront: '인경호 물가',
  inkyung_bench_east: '인경호 동쪽 벤치', inkyung_bench_west: '인경호 서쪽 벤치',
  inkyung_photo_point: '인경호 사진 지점', inkyung_walkway: '인경호 산책로',
  transit_to_student_center: '학생회관 방향 길', transit_to_main_hall: '본관 방향 길',
  transit_to_building: '건물 방향 길'
};
const socialSpots = {
  [MAIN_NPC_ID]: '인경호 동쪽 벤치',
  [QUEST_NPC_ID]: '인경호 사진 지점'
};
const socialLines = {
  [MAIN_NPC_ID]: '친구와 인경호 동쪽 벤치에서 잠깐 쉬어 봐요.',
  [QUEST_NPC_ID]: '친구와 인경호 사진 지점에서 사진 한 장 남겨 봐요.'
};
const approvedTopicLines = {
  architecture: ['인경호를 걸으면 건물의 선이 눈에 들어와요.', '건물의 모양을 천천히 살펴보는 걸 좋아해요.'],
  cooking: ['간단한 요리 이야기를 나누면 즐거워요.', '요리할 때 작은 변화를 시도하는 편이에요.'],
  sketching: ['인경호 풍경을 짧게 스케치해 보고 싶어요.', '눈에 들어온 선을 스케치로 남기곤 해요.'],
  photography: ['인경호에서는 빛이 바뀌는 순간을 찍어 보고 싶어요.', '사진을 찍기 전에 구도를 잠깐 살펴봐요.'],
  plants: ['산책로의 잎 모양을 살펴보는 걸 좋아해요.', '식물의 작은 차이가 눈에 들어오곤 해요.']
};
const dialoguePersonas = {
  [MAIN_NPC_ID]: '나나율: 정문에서 사람을 맞이하는 다정하고 사려 깊은 학생. 건축의 선, 간단한 요리, 스케치에 관심이 있다. 짧고 부드러운 존댓말을 쓴다.',
  [QUEST_NPC_ID]: '가유담: 인경호 사진 지점에서 풍경을 살피는 신중하고 관찰력 있는 조교. 사진과 식물에 관심이 있다. 짧은 존댓말과 가벼운 재치를 쓴다.'
};

export function validatePilotInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_INPUT');
  const npc = npcs.get(input.npc_id);
  if (!npc || !periods.has(input.period) || !['topic', 'social'].includes(input.trigger)) throw Error('INVALID_CONTEXT');
  const { slot, dialogue } = runtimePresence(npc, input.period);
  if (slot.location === 'off_zone') throw Error('NPC_OFF_ZONE');
  if (input.trigger === 'topic' ? !npc.interests.includes(input.topic) : input.topic !== null) throw Error('INVALID_TOPIC');
  if (input.prior_topic !== null && !npc.interests.includes(input.prior_topic)) throw Error('INVALID_MEMORY');
  if (input.follow_up !== undefined && typeof input.follow_up !== 'boolean') throw Error('INVALID_FOLLOW_UP');
  if (input.follow_up && (input.trigger !== 'topic' || input.prior_topic !== input.topic)) throw Error('INVALID_FOLLOW_UP');
  if (!Array.isArray(input.available_actions) || input.available_actions.length > actions.size ||
      input.available_actions.some(action => !actions.has(action)) ||
      new Set(input.available_actions).size !== input.available_actions.length ||
      !input.available_actions.includes('stay')) throw Error('INVALID_ACTIONS');
  const allowed = input.available_actions.filter(action =>
    input.trigger === 'social' ? ['stay', 'look_at_player'].includes(action) :
      action !== 'sit_at_bench' || slot.location === 'inkyung_bench_east' || slot.location === 'inkyung_bench_west');
  return { npc, slot, dialogue, period: input.period, allowed, trigger: input.trigger, topic: input.topic,
    priorTopic: input.prior_topic, followUp: input.follow_up === true,
    socialSpot: input.trigger === 'social' ? socialSpots[npc.npc_id] : null };
}

export function groundedDialoguePrompt(context) {
  if (context.trigger !== 'topic') throw Error('INVALID_TOPIC');
  return [
    '당신은 인하월드의 가상 NPC입니다. 지정된 NPC의 말투로만 대답하세요.',
    dialoguePersonas[context.npc.npc_id],
    context.followUp
      ? `플레이어: ${topicLabels[context.topic]} 이야기를 조금 더 들려주세요. 앞 답변을 되풀이하지 말고 자신의 관찰이나 취향을 하나 더 말하세요.`
      : `플레이어: ${topicLabels[context.topic]} 이야기를 해요. 자신의 관찰이나 취향으로 답하세요.`,
    '한국어 존댓말 1~2문장, 100자 이내. 선택 주제의 단어를 그대로 넣고, 현재 시간 또는 장소를 하나 자연스럽게 언급하세요.',
    '제공한 사실 밖의 캠퍼스 시설·행사·일정·인물·약속은 만들지 마세요. 플레이어의 정보나 친분을 추측하지 마세요.',
    '퀘스트, 보상, 관계 변경, 초대, 연락처, 다른 장소로의 이동 제안은 하지 마세요. NPC 행동은 stay만 반환하세요.',
    `NPC=${context.npc.identity.name}`,
    `CURRENT=${JSON.stringify({ period: periodLabels[context.period], location: locationLabels[context.slot.location],
      activity: activityLabels[context.slot.activity] ?? context.slot.activity, hooks: context.dialogue })}`,
    `TOPIC=${topicLabels[context.topic]}`,
    `PRIOR_TOPIC=${context.priorTopic ? topicLabels[context.priorTopic] : null}`,
    'JSON={"line":"대사","action":"stay"}'
  ].join('\n');
}

export function validateGroundedDialogueOutput(output, context) {
  const result = validatePilotOutput(output, ['stay']);
  const period = periodLabels[context.period];
  const location = locationLabels[context.slot.location];
  if (!result.line.includes(topicLabels[context.topic]) ||
      ![period, location].some(cue => result.line.includes(cue)) ||
      /퀘스트|보상|포인트|친구 요청|초대|연락처|예약|확정/u.test(result.line)) {
    throw Error('INVALID_MODEL_OUTPUT');
  }
  return result;
}

export function pilotPrompt(context) {
  const { npc, slot, allowed, topic, priorTopic, trigger, socialSpot } = context;
  return [
    '당신은 인하월드의 가상 NPC입니다. 실제 학생이나 교수의 신상, 학번, 행사 정보는 만들지 마세요.',
    trigger === 'social'
      ? `플레이어가 친구와 가볍게 함께 할 일을 물었습니다. 기존 게임 장소 '${socialSpot}'를 정확히 그 이름으로 넣어, 친구와 함께 할 수 있는 일을 강요 없이 한 문장으로 제안하세요. 현재 주변에 친구가 있다고 추측하지 마세요.`
      : context.followUp
        ? '플레이어가 같은 관심사를 조금 더 물었습니다. 앞 답변을 되풀이하지 말고 현재 시간·장소·활동 중 한 가지 단서와 새 관찰을 담아 짧은 한국어 한 문장을 쓰세요.'
        : '플레이어가 선택한 관심사에 답하면서 현재 시간·장소·활동 중 한 가지 단서를 자연스럽게 반영한 짧은 한국어 한 문장을 쓰세요.',
    'NPC의 말투와 성격을 지키고, 이전 주제가 있어도 실제 친분이나 약속이 생긴 것처럼 말하지 마세요.',
    '한 문장 대사와 NPC 자신의 허용된 행동 하나만 JSON으로 제안하세요. 대사와 행동은 서로 어울려야 합니다.',
    '퀘스트, 보상, 세계 상태 변경, 관계 변경, NPC의 다른 장소 이동, 플레이어 정보 추측은 금지합니다. 친구 요청이나 채팅을 대신하지 마세요.',
    '제공한 장소·일정·대사 훅 이외의 캠퍼스 사실은 만들지 마세요. 플레이어에게 NPC를 따라오라고 요구하지 마세요.',
    `NPC=${JSON.stringify({ name: npc.identity.name, role: npc.archetype, traits: npc.personality.traits,
      tone: npc.speech.tone, interests: npc.interests.map(interest => topicLabels[interest] ?? interest) })}`,
    `CURRENT=${JSON.stringify({ period: periodLabels[context.period], location: locationLabels[slot.location],
      activity: activityLabels[slot.activity] ?? slot.activity,
      hooks: context.dialogue })}`,
    `EVENT=${JSON.stringify({ trigger, topic: topic ? topicLabels[topic] ?? topic : null,
      prior_topic: priorTopic ? topicLabels[priorTopic] ?? priorTopic : null,
      social_spot: socialSpot })}`,
    `ALLOWED_ACTIONS=${JSON.stringify(allowed)}`,
    '행동 의미: stay=현재 자세 유지, look_at_player=잠시 플레이어 쪽 보기, walk_nearby=NPC 혼자 주변 안전 경로를 짧게 걷기, sit_at_bench=현재 벤치에 앉기, stand=현재 벤치에서 일어나기.'
  ].join('\n');
}

export function validatePilotOutput(output, allowed, socialSpot = null) {
  if (!output || typeof output !== 'object' || Array.isArray(output) ||
      typeof output.line !== 'string' || typeof output.action !== 'string') throw Error('INVALID_MODEL_OUTPUT');
  const line = output.line.trim();
  if (line.length < 2 || line.length > 100 || /[<>\u0000-\u001f]/u.test(line) ||
      /https?:\/\/|www\.|학번|전화번호|이메일/u.test(line) || !allowed.includes(output.action) ||
      socialSpot && (!line.includes(socialSpot) || /친구 요청|채팅|초대/u.test(line))) {
    throw Error('INVALID_MODEL_OUTPUT');
  }
  return { line, action: output.action };
}

export function approvedChoicePrompt(context) {
  const lines = approvedTopicLines[context.topic];
  if (context.trigger !== 'topic' || !lines) throw Error('INVALID_TOPIC');
  const options = lines.map((line, index) => ({ choice: String(index), line }));
  return [
    '가상 인하월드 NPC의 현재 맥락에 어울리는 승인 대사 번호 하나만 JSON으로 고르세요. 새 대사를 쓰지 마세요.',
    `NPC=${context.npc.identity.name}`,
    `CURRENT=${JSON.stringify({ period: periodLabels[context.period], location: locationLabels[context.slot.location],
      activity: activityLabels[context.slot.activity] ?? context.slot.activity })}`,
    `TOPIC=${topicLabels[context.topic]}`,
    `PRIOR_TOPIC=${context.priorTopic ? topicLabels[context.priorTopic] : null}`,
    `APPROVED_LINES=${JSON.stringify(options)}`
  ].join('\n');
}

export function validateApprovedChoice(output, context) {
  const lines = approvedTopicLines[context.topic];
  if (context.trigger !== 'topic' || !lines || !output || typeof output !== 'object' ||
      !Object.hasOwn(output, 'choice') || !['0', '1'].includes(output.choice)) throw Error('INVALID_MODEL_OUTPUT');
  return { line: lines[Number(output.choice)], action: 'stay' };
}

export function createNpcAiPilot({ generate, mode = 'free', beforeGenerate = async () => {},
  maxCalls = 20, cooldownMs = 5000, cacheMs = 300000, now = Date.now }) {
  let calls = 0;
  const lastCall = new Map();
  const cache = new Map();
  return {
    get calls() { return calls; },
    async decide(input, userId) {
      if (typeof userId !== 'string' || !userId) throw Error('PILOT_AUTH_REQUIRED');
      const context = validatePilotInput(input);
      if (context.trigger === 'social') return { npc_id: context.npc.npc_id, line: socialLines[context.npc.npc_id], action: 'stay' };
      if (!['free', 'approved', 'grounded'].includes(mode)) throw Error('INVALID_PILOT_MODE');
      const cacheKey = JSON.stringify([userId, context.npc.npc_id, context.period, context.trigger,
        context.topic, context.priorTopic, context.followUp, context.allowed]);
      const hit = cache.get(cacheKey);
      if (hit && now() - hit.at < cacheMs) return { ...hit.result, cached: true };
      const previous = lastCall.get(context.npc.npc_id) ?? -Infinity;
      if (calls >= maxCalls) throw Error('PILOT_CALL_LIMIT');
      if (now() - previous < cooldownMs) throw Error('PILOT_COOLDOWN');
      await beforeGenerate(userId);
      calls += 1;
      lastCall.set(context.npc.npc_id, now());
      const output = await generate(mode === 'approved' ? approvedChoicePrompt(context)
        : mode === 'grounded' ? groundedDialoguePrompt(context) : pilotPrompt(context),
      mode === 'approved' ? ['0', '1'] : mode === 'grounded' ? ['stay'] : context.allowed);
      const result = { npc_id: context.npc.npc_id,
        ...(mode === 'approved' ? validateApprovedChoice(output, context)
          : mode === 'grounded' ? validateGroundedDialogueOutput(output, context)
            : validatePilotOutput(output, context.allowed, context.socialSpot)) };
      cache.set(cacheKey, { at: now(), result });
      return result;
    }
  };
}
